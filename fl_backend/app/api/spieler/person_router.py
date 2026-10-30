from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.identitaet.crud import funktionen_of, refuse_without_a_seat
from app.api.identitaet.lookup import SubjektLookup
from app.api.identitaet.services import ist_eigener_spieler, may_grant_on_spieler
from app.api.konto.crud import press_einwilligung
from app.api.konto.services import (
    KONTO_SEITE_SPIELER,
    compose_person_move,
    compose_spieler_self,
    find_eigener_eintrag_refusal,
    widerruf_line,
)
from app.api.saisons.schemas import FLSaisonRules
from app.api.sperrliste.guard import PERSON_ACTOR_BINDERS, KontaktIdentifier, SpielerIdentifier
from app.api.spieler.crud import refuse_a_taken_rolle
from app.api.spieler.schemas import (
    FLKaderResponse,
    FLKaderZeile,
    FLPatchKaderZeilePayload,
    FLSpielerKontoEinwilligungResponse,
    FLSpielerSelfResponse,
)
from app.api.spieler.services import (
    build_kader_pipeline,
    build_self_pupil_filter,
    build_self_pupil_pipeline,
    find_kader_stufe_refusal,
    mark_shared_nummern,
)
from app.core.collections import Collection
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import GERMAN_COLLATION, aggregate_many_from_db, patch_one_in_db, pull_one_from_db, refuse, set_inactive_since
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonSpielerCollection,
    SpielerCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.journal import Journal
from app.core.recording import log_stamp
from app.core.routing import by_id
from app.core.security import loeschung_journal_hash, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_nachweis import FLEinwilligungWahl, nachweis_stand_of
from app.shared.schemas.custom import CustomObjectId, CustomRouteObjectId
from app.shared.schemas.einwilligung import FLKontoEinwilligungPayload
from app.shared.schemas.literals import FLSpielerStufe

# The person lane's binder IN PLACE of `bind_actor` and the grants check, which a seat holder holding
# no grant would fail; the binder refuses a barred person on every method, so no handler asks again.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieler/kader",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["kontakt"])],
)


SQUAD_PATH = f"{by_id('team_id')}/{{saison_id}}"
ROW_PATH = f"{SQUAD_PATH}{by_id('spieler_id')}"


def _live_row(*, team_id: CustomObjectId, saison_id: str, spieler_id: CustomObjectId) -> Mapping[str, Any]:
    """The team in the filter, so another team's pupil named under this path matches nothing; live, so an ausgetragen row is read-only."""

    return {"spieler_id": spieler_id, "saison_id": saison_id, "team_id": team_id, "inactive_since": None}


async def _read_the_squad(
    *, saison_spieler_collection: AsyncCollection, team_id: CustomObjectId, saison_id: str, session: AsyncClientSession
) -> list[FLKaderZeile]:
    """The whole squad, each row's shirt marker judged against every other: no single row carries what it is compared with."""

    rows = await aggregate_many_from_db(
        collection=saison_spieler_collection,
        pipeline=build_kader_pipeline(saison_id=saison_id, team_id=team_id),
        collation=GERMAN_COLLATION,
        session=session,
    )

    return [FLKaderZeile.model_validate(row) for row in mark_shared_nummern(rows)]


async def _erlaubte_stufen(*, saisons_collection: AsyncCollection, saison_id: str, session: AsyncClientSession) -> list[FLSpielerStufe]:
    # `find_one` rather than `pull_one_from_db`: every caller passed `refuse_without_a_seat` first on this
    # session, which read this season for the seat, and no season is ever deleted, so a miss is a broken
    # invariant rather than a 404.
    saison_raw = await saisons_collection.find_one({"_id": saison_id}, projection={"rules": 1}, session=session)
    assert saison_raw is not None

    # Through the model the rules are written under, as `refuse_a_full_squad` reads the cap: a list
    # that model refuses, an empty one included, fails here rather than reaching the page.
    return FLSaisonRules.model_validate(saison_raw["rules"]).erlaubte_stufen


async def _the_row_as_written(
    *,
    saison_spieler_collection: AsyncCollection,
    team_id: CustomObjectId,
    saison_id: str,
    spieler_id: CustomObjectId,
    session: AsyncClientSession,
) -> FLKaderZeile:
    """Read back inside the write's own transaction, so the shirt marker is the squad's after this write and before any other."""

    kader = await _read_the_squad(saison_spieler_collection=saison_spieler_collection, team_id=team_id, saison_id=saison_id, session=session)
    [zeile] = [zeile for zeile in kader if zeile.spieler_id == spieler_id]

    return zeile


@router.get(SQUAD_PATH, response_model=FLKaderResponse, summary="Read a team's squad as its seat holder")
async def get_kader(
    team_id: CustomRouteObjectId,
    saison_id: str,
    identifier: KontaktIdentifier,
    saison_spieler_collection: SaisonSpielerCollection,
    saisons_collection: SaisonsCollection,
    records: SubjektLookup,
    db: DBClient,
) -> FLKaderResponse:
    """
    The squad of one team in one season, for a person holding any contact seat on it.

    Every row, ausgetragen ones included and marked by `inactive_since`; each surname whole, and no
    e-mail address or telephone number of anybody. `nummer_doppelt` marks a live row whose number
    another live row of the squad wears, compared as stored. `erlaubte_stufen` is what the season's
    rules offer an edit. Refused `funktion_nicht_gehalten` where the signed-in person holds no seat on this
    team in this season, a seat on a `past` season holding none.
    """

    # A snapshot, so the squad served is the one the seat was judged against; never a transaction,
    # which a read writing nothing has no conflict to retry and no anchor to take.
    async with db.start_session(snapshot=True) as session:
        await refuse_without_a_seat(identifier, records, team_id=team_id, saison_id=saison_id, session=session)

        return FLKaderResponse(
            team_id=team_id,
            saison_id=saison_id,
            erlaubte_stufen=await _erlaubte_stufen(saisons_collection=saisons_collection, saison_id=saison_id, session=session),
            kader=await _read_the_squad(
                saison_spieler_collection=saison_spieler_collection, team_id=team_id, saison_id=saison_id, session=session
            ),
        )


@router.patch(
    ROW_PATH,
    response_model=FLKaderZeile,
    summary="Update a squad entry as its team's seat holder",
)
async def patch_kader_zeile(
    team_id: CustomRouteObjectId,
    saison_id: str,
    spieler_id: CustomRouteObjectId,
    zeile_data: Annotated[FLPatchKaderZeilePayload, Body()],
    identifier: KontaktIdentifier,
    saison_spieler_collection: SaisonSpielerCollection,
    saisons_collection: SaisonsCollection,
    records: SubjektLookup,
    db: DBClient,
) -> FLKaderZeile:
    """
    Replace a live squad row's `nummer`, `position`, `stufe` and `rolle`, as any contact seat of its team may.

    The team and the Nachnominierung flag stay the stored row's. 404 where this team holds no live
    row for the player in this season: another team's pupil and an ausgetragen row answer alike, and
    nothing is written. Refused `funktion_nicht_gehalten` without a seat, `kader_stufe_nicht_erlaubt` for a `stufe` the
    season's `erlaubte_stufen` does not offer unless the row already holds it, and `kader_rolle_taken`
    for a `rolle` another live row of the squad holds. A shared `nummer` is permitted.
    """

    row = _live_row(team_id=team_id, saison_id=saison_id, spieler_id=spieler_id)

    async def edit_the_row(session: AsyncClientSession) -> FLKaderZeile:
        """Judge, then rewrite the row. Everything judged is read in-session."""

        await refuse_without_a_seat(identifier, records, team_id=team_id, saison_id=saison_id, session=session)

        # The 404 before any rule: a rule judged on a row this team does not hold would tell the
        # caller something about another team's squad.
        stored_raw = await pull_one_from_db(collection=saison_spieler_collection, db_filter=row, projection=["stufe"], session=session)

        refuse(
            find_kader_stufe_refusal(
                stufe=zeile_data.stufe,
                stored_stufe=stored_raw.get("stufe"),
                erlaubte_stufen=await _erlaubte_stufen(saisons_collection=saisons_collection, saison_id=saison_id, session=session),
            )
        )

        # The captaincy alone and never the cap: a live row edited inside its own squad leaves the
        # squad's size where it was.
        await refuse_a_taken_rolle(
            saison_spieler_collection=saison_spieler_collection,
            saisons_collection=saisons_collection,
            saison_id=saison_id,
            team_id=team_id,
            spieler_id=spieler_id,
            rolle=zeile_data.rolle,
            session=session,
        )

        # `BEFORE`: the answer is read back below with the whole squad, so the driver's image is discarded.
        await patch_one_in_db(
            collection=saison_spieler_collection,
            db_filter=row,
            update={"$set": zeile_data.model_dump(mode="json")},
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

        return await _the_row_as_written(
            saison_spieler_collection=saison_spieler_collection, team_id=team_id, saison_id=saison_id, spieler_id=spieler_id, session=session
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(edit_the_row)


@router.delete(
    ROW_PATH,
    response_model=FLKaderZeile,
    summary="Take a Spieler out of the squad as its team's seat holder (austragen)",
)
async def delete_kader_zeile(
    team_id: CustomRouteObjectId,
    saison_id: str,
    spieler_id: CustomRouteObjectId,
    identifier: KontaktIdentifier,
    saison_spieler_collection: SaisonSpielerCollection,
    records: SubjektLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLKaderZeile:
    """
    Take a player out of this team's squad for the season, as any contact seat of the team may. SOFT: the row stays.

    Stamps the row's `inactive_since`; the person stays in the league, and only an administrator
    brings the row back. 404 where this team holds no live row for the player in this season,
    another team's pupil and an ausgetragen row alike. Refused `funktion_nicht_gehalten` without a seat.
    """

    async def take_the_row_out(session: AsyncClientSession) -> FLKaderZeile:
        """Judge the seat, then stamp the row: the live-row filter is the write's own, so an ausgetragen row is a 404 here."""

        await refuse_without_a_seat(identifier, records, team_id=team_id, saison_id=saison_id, session=session)

        await set_inactive_since(
            collection=saison_spieler_collection,
            db_filter=_live_row(team_id=team_id, saison_id=saison_id, spieler_id=spieler_id),
            when=today,
            session=session,
        )

        return await _the_row_as_written(
            saison_spieler_collection=saison_spieler_collection, team_id=team_id, saison_id=saison_id, spieler_id=spieler_id, session=session
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(take_the_row_out)


# A router of its own, binding the pupil's Funktion: `router` binds `kontakt` at ROUTER level, and a
# second binder on one of its routes would record these writes under the wrong Funktion, nothing
# failing.
spieler_router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieler",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["spieler"])],
)


@spieler_router.get("/self", response_model=FLSpielerSelfResponse, summary="A signed-in pupil's own record")
async def get_self(identifier: SpielerIdentifier, spieler_collection: SpielerCollection) -> FLSpielerSelfResponse:
    """
    Answer the signed-in address's own pupil record's stored data with every squad row it holds.

    PERSON TIER: the whole surname and the birthdate, never masked, and never the sign-in address itself. A retired
    record is served too. Its consent is the account page's (`GET /konto/einwilligungen`), so none is served here.

    Refuses an address holding no confirmed pupil record (`funktion_nicht_gehalten`).
    """

    rows = await aggregate_many_from_db(collection=spieler_collection, pipeline=build_self_pupil_pipeline(identifier))
    row = rows[0] if rows else None
    refuse(find_eigener_eintrag_refusal(gehalten=row is not None and ist_eigener_spieler(row)))
    assert row is not None

    return FLSpielerSelfResponse.model_validate({"spieler": compose_spieler_self(row)})


@spieler_router.patch(
    "/konto/einwilligung",
    response_model=FLSpielerKontoEinwilligungResponse,
    summary="Change a signed-in pupil's own publication and media consent",
)
async def patch_einwilligung(
    einwilligung_data: Annotated[FLKontoEinwilligungPayload, Body()],
    identifier: SpielerIdentifier,
    spieler_collection: SpielerCollection,
    records: SubjektLookup,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLSpielerKontoEinwilligungResponse:
    """
    Set the two choices of the signed-in address's own pupil consent record: the publication scope and the media consent.

    Writes those two on this one record, each moved choice with its evidence (`nachweis.<choice>`), and nothing else:
    the confirmation day, the day given and the wording they confirmed stand, and no other document is written. A
    PATCH moving neither choice writes nothing. A GRANT (`umfang` to `kader_oeffentlich` or `medien` to `true`) is
    taken on a live record alone; a withdrawal on a retired one too.

    Refuses, in this order: an address holding no confirmed pupil record (`funktion_nicht_gehalten`); a `nachweis_stand`
    other than the record's own, either choice having moved since the page was served (`fassung_unzulaessig`); a
    grant on a retired record (`erteilung_nicht_zugelassen`); a `text_version` naming no version of the account page's pupil
    control, or a grant naming any but the page's running one (`fassung_unzulaessig`); `medien` moving to `true` where
    the stored birthdate does not reach `MEDIEN_MIN_AGE_YEARS` today or is missing (`medien_alter`). Each
    refusal writes nothing.

    **The caller drops the cached squad lists after a successful answer**: the publication scope decides whether a
    name is served, and nothing here can.
    """

    eigener_eintrag = build_self_pupil_filter(identifier)
    gewaehlt: dict[FLEinwilligungWahl, object] = {"umfang": einwilligung_data.umfang, "medien": einwilligung_data.medien}
    # One instant for the evidence and its journal line, so a replay stamps the moment the person pressed.
    am = log_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def write(session: AsyncClientSession) -> FLSpielerKontoEinwilligungResponse:
        row = await spieler_collection.find_one(eigener_eintrag, projection={"einwilligung": 1, "geburtsdatum": 1}, session=session)
        refuse(find_eigener_eintrag_refusal(gehalten=row is not None and ist_eigener_spieler(row)))
        assert row is not None
        gespeichert = row["einwilligung"]

        async def darf_erteilen() -> bool:
            return may_grant_on_spieler(await funktionen_of(identifier, records, session=session), row["_id"])

        await press_einwilligung(
            bloecke=[gespeichert],
            geburtsdaten=[row.get("geburtsdatum")],
            gewaehlt=gewaehlt,
            nachweis_stand=einwilligung_data.nachweis_stand.model_dump(),
            text_version=einwilligung_data.text_version,
            seite=KONTO_SEITE_SPIELER,
            darf_erteilen=darf_erteilen,
            today=today,
        )

        update = compose_person_move(gespeichert=gespeichert, gewaehlt=gewaehlt, am=am, text_version=einwilligung_data.text_version)
        updated = (
            None
            if update is None
            else await patch_one_in_db(
                collection=spieler_collection,
                db_filter={"_id": row["_id"]},
                update=update,
                session=session,
                return_document=ReturnDocument.AFTER,
            )
        )
        line = widerruf_line(
            person_hash=loeschung_journal_hash(identifier, schluessel=config.sperrliste_schluessel),
            collection=Collection.SPIELER,
            record_id=row["_id"],
            bloecke=[gespeichert],
            gewaehlt=gewaehlt,
            am=am,
            text_version=einwilligung_data.text_version,
        )
        if line is not None:
            journal.note(line)
        # A press moving neither choice is no act, so nothing was written and the record answers as stored.
        einwilligung = gespeichert if updated is None else updated["einwilligung"]

        return FLSpielerKontoEinwilligungResponse.model_validate(
            {"spieler_id": row["_id"], "einwilligung": einwilligung, "nachweis_stand": nachweis_stand_of(bloecke=[einwilligung])}
        )

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(write)
