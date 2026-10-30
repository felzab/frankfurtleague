from collections.abc import Mapping
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.identitaet.crud import funktionen_of
from app.api.identitaet.lookup import SubjektLookup
from app.api.konto.services import find_eigener_eintrag_refusal
from app.api.spielbestaetigungen.crud import (
    EIGENE_ZEILE_FIELDS,
    pull_ansetzung_lage,
    pull_eigene_lagen,
    pull_spielorte_public,
)
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungenSelbstResponse,
    FLSpielbestaetigungSchiedsrichterAntwortPayload,
    FLSpielbestaetigungSchiedsrichterAntwortResponse,
    FLSpielbestaetigungSelbst,
)
from app.api.spielbestaetigungen.services import (
    ansetzung_verlassen_refusal,
    ansicht_ansetzung_of,
    ansicht_snapshot_of,
    build_answerable_filter,
    build_current_rows_pipeline,
    clubs_without_a_season_row,
    compose_schiedsrichter_antwort_update,
    eigene_begruendung_of,
    eingetragen_of,
    find_fremde_zeile_refusal,
    find_spent_link_refusal,
    first_press_refusal,
    schiedsrichter_zustand_of,
    stand_moved,
)
from app.api.teams.crud import pull_team_names
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_one_in_db, pull_many_from_db, refuse
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonTeamsCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    SpielorteCollection,
    TeamsCollection,
    get_german_date_str,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.routing import by_id
from app.core.security import PERSON_ACTOR_BINDERS, SchiedsrichterIdentifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.schemas.bounds import LIST_LIMIT_MAX
from app.shared.schemas.custom import CustomRouteObjectId

# A person's own router beside the link's and the pass's, binding its own actor at router level:
# every write is recorded under the referee's Funktion.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielbestaetigungen",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["schiedsrichter"])],
)


@router.get("/selbst", response_model=FLSpielbestaetigungenSelbstResponse, summary="A signed-in referee's own fixture assignments")
async def get_eigene_spielbestaetigungen(
    identifier: SchiedsrichterIdentifier,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spiele_collection: SpieleCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spielorte_collection: SpielorteCollection,
    teams_collection: TeamsCollection,
    records: SubjektLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSpielbestaetigungenSelbstResponse:
    """
    Answer each fixture's newest confirmation row naming one of the signed-in address's live, confirmed referee records.

    One row per fixture in an `active` season: a fixture moved, reinstated or booked to them again answers its fresh
    request alone.

    Open, answered and closed rows alike, each with the fixture as it stands -- or, where the fixture moved since, the
    Ansetzung the row asked about -- its state, `abgesagt` once the fixture is called off, the referee's own decline
    reason, whether the league recorded the answer for them, naming nobody, and whether its day is past. No deadline is
    served: a referee answers until the fixture's day. Ordered with the days still to come first, rows still open
    ahead, each by its day; then the days gone by, the latest first. Nobody's address or seat is served, and no reason an
    administrator entered on the row.

    Refuses an address holding no live, confirmed referee record (`REQ-FUNKTION-001`).
    """

    # A snapshot, so every row is judged against the fixture and clubs of its own moment; never a transaction, which a
    # read writing nothing has no conflict to retry.
    async with db.start_session(snapshot=True) as session:
        subjekt = await funktionen_of(identifier, records, session=session)
        refuse(find_eigener_eintrag_refusal(gehalten=bool(subjekt.schiedsrichter)))

        # The seasons the pass mints in, as `app/api/spielbestaetigungen/sweep_router.py :: get_spiel_sweep_saisons` lists them.
        saisons = await pull_many_from_db(
            collection=saisons_collection, db_filter={"status": "active"}, projection=["_id"], limit=LIST_LIMIT_MAX, session=session
        )
        rows = await aggregate_many_from_db(
            collection=spielbestaetigungen_collection,
            pipeline=[
                *build_current_rows_pipeline(
                    saison_ids=[str(saison["_id"]) for saison in saisons],
                    schiedsrichter_ids=[eintrag.schiedsrichter_id for eintrag in subjekt.schiedsrichter],
                    projection=EIGENE_ZEILE_FIELDS,
                ),
                {"$limit": LIST_LIMIT_MAX + 1},
            ],
            session=session,
        )
        # Raised rather than cut: a capped list would read as a referee booked onto fewer fixtures.
        if len(rows) > LIST_LIMIT_MAX:
            raise ValueError("a referee's fixtures in the active seasons outrun one read")

        lagen = await pull_eigene_lagen(
            spiele_collection=spiele_collection, saison_teams_collection=saison_teams_collection, spielbestaetigungen_raw=rows, session=session
        )
        moved = [row for row in rows if stand_moved(spielbestaetigung_raw=row, lage=lagen[row["_id"]])]
        moved_ids = {row["_id"] for row in moved}
        spielorte = await pull_spielorte_public(
            spielorte_collection=spielorte_collection, spielort_ids=[row["ansetzung"]["spielort_id"] for row in moved], session=session
        )
        vereinsnamen = await pull_team_names(
            teams_collection=teams_collection,
            team_ids=[team_id for row in moved for team_id in clubs_without_a_season_row(spielbestaetigung_raw=row, lage=lagen[row["_id"]])],
            session=session,
        )

    def eintrag_of(row: Mapping[str, Any]) -> FLSpielbestaetigungSelbst:
        lage = lagen[row["_id"]]
        ansetzung = (
            ansicht_snapshot_of(
                spielbestaetigung_raw=row, lage=lage, vereinsnamen=vereinsnamen, spielort=spielorte.get(row["ansetzung"]["spielort_id"])
            )
            if row["_id"] in moved_ids
            else ansicht_ansetzung_of(lage.spiel)
        )

        return FLSpielbestaetigungSelbst.model_validate(
            {
                "_id": row["_id"],
                "spiel_id": row["spiel_id"],
                "schiedsrichter_id": row["partei"]["schiedsrichter_id"],
                "ansetzung": ansetzung,
                "zustand": schiedsrichter_zustand_of(spielbestaetigung_raw=row, lage=lage, today=today),
                "begruendung": eigene_begruendung_of(row),
                "eingetragen": eingetragen_of(row),
                "vergangen": ansetzung.datum < today,
            }
        )

    eintraege = list(map(eintrag_of, rows))
    kommend = sorted((e for e in eintraege if not e.vergangen), key=lambda e: (e.zustand != "gueltig", e.ansetzung.datum, str(e.id)))
    vergangen = sorted((e for e in eintraege if e.vergangen), key=lambda e: (e.ansetzung.datum, str(e.id)), reverse=True)

    return FLSpielbestaetigungenSelbstResponse(spielbestaetigungen=[*kommend, *vergangen])


@router.post(
    f"{by_id('spielbestaetigung_id')}/antwort",
    response_model=FLSpielbestaetigungSchiedsrichterAntwortResponse,
    summary="Accept or decline one of the signed-in referee's own fixture assignments",
)
async def post_schiedsrichter_antwort(
    spielbestaetigung_id: CustomRouteObjectId,
    antwort_data: Annotated[FLSpielbestaetigungSchiedsrichterAntwortPayload, Body()],
    identifier: SchiedsrichterIdentifier,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spiele_collection: SpieleCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    records: SubjektLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSpielbestaetigungSchiedsrichterAntwortResponse:
    """
    Record the signed-in referee's answer about one fixture they are booked on: they accept it, or decline it giving a reason.

    The first answer binds, as a club's does. A decline also takes the referee off the fixture, writing its referee
    null and nothing else of it -- no other fixture is resolved again and no club is told -- and closes the row, so
    booking the same referee again asks them afresh. The reason is stored as typed, for the administrator, and goes at
    the season's end. Answering is open until the fixture's day, whatever deadline a club's row of the same fixture
    carries.

    Refuses, in this order: an address holding no live, confirmed referee record (`REQ-FUNKTION-001`); an id naming no
    row of an `active` season, or a row naming none of those records (`REQ-ANSETZUNG-015`, one answer for both); a row
    already answered, by them or by the league for them (`REQ-ANSETZUNG-002`); one closed unanswered
    (`REQ-ANSETZUNG-009`); a fixture decided, called off or left by a club (`REQ-ANSETZUNG-005`), then one whose date,
    time, ground or sides moved since the row, or which books another referee or none (`REQ-ANSETZUNG-004`); and a
    fixture whose day has gone by (`REQ-ANSETZUNG-003`). An acceptance is judged again outside the transaction just
    before answering, so a move or a reassignment landing mid-answer refuses it rather than letting it stand.

    **The caller drops the cached fixture list after a successful answer**: an acceptance can put the referee's name
    on the public fixture, and a decline takes it off.
    """

    async def answer(session: AsyncClientSession) -> FLSpielbestaetigungSchiedsrichterAntwortResponse:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it."""

        subjekt = await funktionen_of(identifier, records, session=session)
        refuse(find_eigener_eintrag_refusal(gehalten=bool(subjekt.schiedsrichter)))

        # The seasons the panel lists: a row of a season ended since is no booking left to answer, its slot the archive's.
        saisons = await pull_many_from_db(
            collection=saisons_collection, db_filter={"status": "active"}, projection=["_id"], limit=LIST_LIMIT_MAX, session=session
        )
        # `find_one` rather than `pull_one_from_db`, whose 404 would tell the caller which ids exist.
        row = await spielbestaetigungen_collection.find_one(
            {"_id": spielbestaetigung_id, "saison_id": {"$in": [str(saison["_id"]) for saison in saisons]}},
            projection=EIGENE_ZEILE_FIELDS,
            session=session,
        )
        refuse(
            find_fremde_zeile_refusal(
                spielbestaetigung_raw=row, schiedsrichter_ids=[eintrag.schiedsrichter_id for eintrag in subjekt.schiedsrichter]
            )
        )
        assert row is not None

        lage = await pull_ansetzung_lage(
            spiele_collection=spiele_collection,
            saison_teams_collection=saison_teams_collection,
            spielbestaetigung_raw=row,
            spiel_projection=None,
            verein_projection={"_id": 0, "team_id": 1, "austritt.datum": 1},
            session=session,
        )
        # One snapshot with the row, and the fixture is removed with its rows in one transaction.
        assert lage is not None
        refuse(find_spent_link_refusal(spielbestaetigung_raw=row, lage=lage, today=today))

        try:
            await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": spielbestaetigung_id, **build_answerable_filter()},
                update=compose_schiedsrichter_antwort_update(antwort=antwort_data.antwort, begruendung=antwort_data.begruendung, today=today),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )
        except DocumentNotFoundError:
            refuse(first_press_refusal())

        if antwort_data.antwort == "abgelehnt":
            # Never `PATCH /spiele/{spiel_id}`, which re-resolves the season's bracket: a person's press moves this one
            # block. A rival save of the fixture writes this document too, so the two conflict and one retries.
            try:
                await patch_one_in_db(
                    collection=spiele_collection,
                    db_filter={"_id": row["spiel_id"], "schiedsrichter.schiedsrichter_id": row["partei"]["schiedsrichter_id"]},
                    update={"$set": {"schiedsrichter": None}},
                    session=session,
                    return_document=ReturnDocument.BEFORE,
                )
            except DocumentNotFoundError:
                # Unreachable: the snapshot judged above books them, and a write since conflicts rather than missing.
                # Mapped to that judgement's refusal, so no `DB-COMMON-001` is published for a miss no caller meets.
                refuse(ansetzung_verlassen_refusal())
        else:
            # The acceptance writes no fixture, so a move, a reassignment or a club's exit landing under this transaction
            # raises no conflict: all judged again outside it before answering.
            jetzt = await pull_ansetzung_lage(
                spiele_collection=spiele_collection,
                saison_teams_collection=saison_teams_collection,
                spielbestaetigung_raw=row,
                spiel_projection=None,
                verein_projection={"_id": 0, "team_id": 1, "austritt.datum": 1},
                session=None,
            )
            # An undraw removing the fixture deletes this row in its transaction, a write conflict while this one holds it.
            assert jetzt is not None
            refuse(find_spent_link_refusal(spielbestaetigung_raw=row, lage=jetzt, today=today))

        return FLSpielbestaetigungSchiedsrichterAntwortResponse(spielbestaetigung_id=spielbestaetigung_id, zustand=antwort_data.antwort)

    async with transaction_session(db) as session:
        return await session.with_transaction(answer)
