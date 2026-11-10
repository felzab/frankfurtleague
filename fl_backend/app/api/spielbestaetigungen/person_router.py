from collections.abc import Mapping
from http import HTTPStatus
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.account.services import find_own_entry_refusal
from app.api.identity.crud import roles_of
from app.api.identity.lookup import SubjectLookup
from app.api.spielbestaetigungen.crud import (
    OWN_ROW_FIELDS,
    pull_ansetzung_state,
    pull_own_states,
    pull_spielorte_public,
)
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAnswerResponse,
    FLSpielbestaetigungenSelfResponse,
    FLSpielbestaetigungSchiedsrichterAnswerPayload,
    FLSpielbestaetigungSchiedsrichterAnswerResponse,
    FLSpielbestaetigungSelf,
    FLSpielbestaetigungTeamAnswerPayload,
)
from app.api.spielbestaetigungen.services import (
    ansetzung_left_refusal,
    build_answerable_filter,
    build_current_rows_pipeline,
    clubs_without_a_season_row,
    compose_schiedsrichter_answer_update,
    entered_of,
    find_foreign_row_refusal,
    find_spent_link_refusal,
    first_press_refusal,
    own_reason_of,
    schiedsrichter_state_of,
    stand_moved,
    view_ansetzung_of,
    view_snapshot_of,
)
from app.api.teams.crud import pull_team_names
from app.core.codes import Code
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
from app.core.exceptions import APIError, DocumentNotFoundError
from app.core.recording import ACT_BY_SCHIEDSRICHTER, record_act
from app.core.routing import by_id
from app.core.security import PersonIdentifier, get_person_identifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.schemas.bounds import LIST_LIMIT_MAX
from app.shared.schemas.custom import CustomRouteObjectId

# A person's own router beside the link's and the pass's, binding its own actor at router level:
# every write is recorded under the referee's Funktion.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielbestaetigungen",
    dependencies=[Depends(verify_access_admin), Depends(get_person_identifier)],
)


@router.get("/self", response_model=FLSpielbestaetigungenSelfResponse, summary="A signed-in referee's own fixture assignments")
async def get_self(
    identifier: PersonIdentifier,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spiele_collection: SpieleCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spielorte_collection: SpielorteCollection,
    teams_collection: TeamsCollection,
    records: SubjectLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSpielbestaetigungenSelfResponse:
    """
    Answer each fixture's newest confirmation row naming one of the signed-in address's live, confirmed referee records.

    One row per fixture in an `active` season: a fixture moved, reinstated or booked to them again answers its fresh
    request alone.

    Open, answered and closed rows alike, each with the fixture as it stands -- or, where the fixture moved since, the
    Ansetzung the row asked about -- its state, `cancelled` once the fixture is called off, the referee's own decline
    reason, whether the league recorded the answer for them, naming nobody, and whether its day is past. No deadline is
    served: a referee answers until the fixture's day. Ordered with the days still to come first, rows still open
    ahead, each by its day; then the days gone by, the latest first. Nobody's address or seat is served, and no reason an
    administrator entered on the row.

    Refuses an address holding no live, confirmed referee record (`role_not_held`).
    """

    # A snapshot, so every row is judged against the fixture and clubs of its own moment; never a transaction, which a
    # read writing nothing has no conflict to retry.
    async with db.start_session(snapshot=True) as session:
        subject = await roles_of(identifier, records, session=session)
        refuse(find_own_entry_refusal(held=bool(subject.schiedsrichter)))

        # The seasons the pass mints in, as `app/api/spielbestaetigungen/system_router.py :: get_sweep_saisons` lists them.
        saisons = await pull_many_from_db(
            collection=saisons_collection, db_filter={"status": "active"}, projection=["_id"], limit=LIST_LIMIT_MAX, session=session
        )
        rows = await aggregate_many_from_db(
            collection=spielbestaetigungen_collection,
            pipeline=[
                *build_current_rows_pipeline(
                    saison_ids=[str(saison["_id"]) for saison in saisons],
                    schiedsrichter_ids=[entry.schiedsrichter_id for entry in subject.schiedsrichter],
                    projection=OWN_ROW_FIELDS,
                ),
                {"$limit": LIST_LIMIT_MAX + 1},
            ],
            session=session,
        )
        # Raised rather than cut: a capped list would read as a referee booked onto fewer fixtures.
        if len(rows) > LIST_LIMIT_MAX:
            raise ValueError("a referee's fixtures in the active seasons outrun one read")

        ansetzung_states = await pull_own_states(
            spiele_collection=spiele_collection, saison_teams_collection=saison_teams_collection, spielbestaetigungen_raw=rows, session=session
        )
        moved = [row for row in rows if stand_moved(spielbestaetigung_raw=row, ansetzung_state=ansetzung_states[row["_id"]])]
        moved_ids = {row["_id"] for row in moved}
        spielorte = await pull_spielorte_public(
            spielorte_collection=spielorte_collection, spielort_ids=[row["ansetzung"]["spielort_id"] for row in moved], session=session
        )
        vereinsnamen = await pull_team_names(
            teams_collection=teams_collection,
            team_ids=[
                team_id
                for row in moved
                for team_id in clubs_without_a_season_row(spielbestaetigung_raw=row, ansetzung_state=ansetzung_states[row["_id"]])
            ],
            session=session,
        )

    def entry_of(row: Mapping[str, Any]) -> FLSpielbestaetigungSelf:
        ansetzung_state = ansetzung_states[row["_id"]]
        ansetzung = (
            view_snapshot_of(
                spielbestaetigung_raw=row,
                ansetzung_state=ansetzung_state,
                vereinsnamen=vereinsnamen,
                spielort=spielorte.get(row["ansetzung"]["spielort_id"]),
            )
            if row["_id"] in moved_ids
            else view_ansetzung_of(ansetzung_state.spiel)
        )

        return FLSpielbestaetigungSelf.model_validate(
            {
                "_id": row["_id"],
                "spiel_id": row["spiel_id"],
                "schiedsrichter_id": row["party"]["schiedsrichter_id"],
                "ansetzung": ansetzung,
                "state": schiedsrichter_state_of(spielbestaetigung_raw=row, ansetzung_state=ansetzung_state, today=today),
                "reason": own_reason_of(row),
                "entered": entered_of(row),
                "past": ansetzung.date < today,
            }
        )

    entries = list(map(entry_of, rows))
    upcoming = sorted((e for e in entries if not e.past), key=lambda e: (e.state != "valid", e.ansetzung.date, str(e.id)))
    past = sorted((e for e in entries if e.past), key=lambda e: (e.ansetzung.date, str(e.id)), reverse=True)

    return FLSpielbestaetigungenSelfResponse(spielbestaetigungen=[*upcoming, *past])


@router.post(
    f"{by_id('spielbestaetigung_id')}/answer",
    response_model=FLSpielbestaetigungSchiedsrichterAnswerResponse,
    summary="Accept or decline one of the signed-in referee's own fixture assignments",
)
async def post_schiedsrichter_answer(
    spielbestaetigung_id: CustomRouteObjectId,
    answer_data: Annotated[FLSpielbestaetigungSchiedsrichterAnswerPayload, Body()],
    identifier: PersonIdentifier,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spiele_collection: SpieleCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    records: SubjectLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSpielbestaetigungSchiedsrichterAnswerResponse:
    """
    Record the signed-in referee's answer about one fixture they are booked on: they accept it, or decline it giving a reason.

    The first answer binds, as a club's does. A decline also takes the referee off the fixture, writing its referee
    null and nothing else of it -- no other fixture is resolved again and no club is told -- and closes the row, so
    booking the same referee again asks them afresh. The reason is stored as typed, for the administrator, and goes at
    the season's end. Answering is open until the fixture's day, whatever deadline a club's row of the same fixture
    carries.

    Refuses, in this order: an address holding no live, confirmed referee record (`role_not_held`); an id naming no
    row of an `active` season, or a row naming none of those records (`ansetzung_foreign_row`, one answer for both); a row
    already answered, by them or by the league for them (`ansetzung_answered`); one closed unanswered
    (`ansetzung_closed`); a fixture decided, called off or left by a club (`ansetzung_decided`), then one whose date,
    time, ground or sides moved since the row, or which books another referee or none (`ansetzung_changed`); and a
    fixture whose day has gone by (`ansetzung_deadline_past`). An acceptance is judged again outside the transaction just
    before answering, so a move or a reassignment landing mid-answer refuses it rather than letting it stand.

    **The caller drops the cached fixture list after a successful answer**: an acceptance can put the referee's name
    on the public fixture, and a decline takes it off.
    """

    async def answer(session: AsyncClientSession) -> FLSpielbestaetigungSchiedsrichterAnswerResponse:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it."""

        subject = await roles_of(identifier, records, session=session)
        refuse(find_own_entry_refusal(held=bool(subject.schiedsrichter)))

        # The seasons the panel lists: a row of a season ended since is no booking left to answer, its slot the archive's.
        saisons = await pull_many_from_db(
            collection=saisons_collection, db_filter={"status": "active"}, projection=["_id"], limit=LIST_LIMIT_MAX, session=session
        )
        # `find_one` rather than `pull_one_from_db`, whose 404 would tell the caller which ids exist.
        row = await spielbestaetigungen_collection.find_one(
            {"_id": spielbestaetigung_id, "saison_id": {"$in": [str(saison["_id"]) for saison in saisons]}},
            projection=OWN_ROW_FIELDS,
            session=session,
        )
        refuse(
            find_foreign_row_refusal(
                spielbestaetigung_raw=row, schiedsrichter_ids=[entry.schiedsrichter_id for entry in subject.schiedsrichter]
            )
        )
        assert row is not None

        ansetzung_state = await pull_ansetzung_state(
            spiele_collection=spiele_collection,
            saison_teams_collection=saison_teams_collection,
            spielbestaetigung_raw=row,
            spiel_projection=None,
            verein_projection={"_id": 0, "team_id": 1, "austritt.date": 1},
            session=session,
        )
        # One snapshot with the row, and the fixture is removed with its rows in one transaction.
        assert ansetzung_state is not None
        refuse(find_spent_link_refusal(spielbestaetigung_raw=row, ansetzung_state=ansetzung_state, today=today))

        try:
            await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": spielbestaetigung_id, **build_answerable_filter()},
                update=compose_schiedsrichter_answer_update(answer=answer_data.answer, reason=answer_data.reason, today=today),
                session=session,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )
        except DocumentNotFoundError:
            refuse(first_press_refusal())

        await record_act(
            collection=spielbestaetigungen_collection,
            action="spielbestaetigung.answered",
            by=ACT_BY_SCHIEDSRICHTER,
            record_id=spielbestaetigung_id,
            label=str(row["saison_id"]),
            session=session,
        )

        if answer_data.answer == "declined":
            # Never `PATCH /spiele/{spiel_id}`, which re-resolves the season's bracket: a person's press moves this one
            # block. A rival save of the fixture writes this document too, so the two conflict and one retries.
            try:
                await patch_one_in_db(
                    collection=spiele_collection,
                    db_filter={"_id": row["spiel_id"], "schiedsrichter.schiedsrichter_id": row["party"]["schiedsrichter_id"]},
                    update={"$set": {"schiedsrichter": None}},
                    session=session,
                    expected_version=None,
                    return_document=ReturnDocument.BEFORE,
                )
            except DocumentNotFoundError:
                # Unreachable: the snapshot judged above books them, and a write since conflicts rather than missing.
                # Mapped to that judgement's refusal, so no `document_not_found` is published for a miss no caller meets.
                refuse(ansetzung_left_refusal())
        else:
            # The acceptance writes no fixture, so a move, a reassignment or a club's exit landing under this transaction
            # raises no conflict: all judged again outside it before answering.
            current = await pull_ansetzung_state(
                spiele_collection=spiele_collection,
                saison_teams_collection=saison_teams_collection,
                spielbestaetigung_raw=row,
                spiel_projection=None,
                verein_projection={"_id": 0, "team_id": 1, "austritt.date": 1},
                session=None,
            )
            # An undraw removing the fixture deletes this row in its transaction, a write conflict while this one holds it.
            assert current is not None
            refuse(find_spent_link_refusal(spielbestaetigung_raw=row, ansetzung_state=current, today=today))

        return FLSpielbestaetigungSchiedsrichterAnswerResponse(spielbestaetigung_id=spielbestaetigung_id, state=answer_data.answer)

    async with transaction_session(db) as session:
        return await session.with_transaction(answer)


@router.post(
    f"{by_id('spielbestaetigung_id')}/answer/team",
    response_model=FLSpielbestaetigungAnswerResponse,
    summary="Confirm a fixture's Ansetzung as the team's seat holder, or decline it proposing another date",
)
async def post_team_answer(
    spielbestaetigung_id: CustomRouteObjectId,
    answer_data: Annotated[FLSpielbestaetigungTeamAnswerPayload, Body()],
    identifier: PersonIdentifier,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
) -> FLSpielbestaetigungAnswerResponse:
    """
    Record one club's answer about one Ansetzung, from whichever of its confirmed seats presses first, and the seat it came from.

    The first press binds: a second seat pressing at once conflicts with it, and its retry finds the row answered
    (`ansetzung_answered`). Writes no fixture: a proposal is the administrator's to act on. The seat recorded is the
    signed-in person's own on the row's team, the first in order where they hold two.

    Refuses, in this order: an id naming no team's row, or the row of a team the signed-in person holds no seat on in
    its season (`ansetzung_foreign_row`, one answer for both); a row already answered, closed since or not (`ansetzung_answered`); one closed
    unanswered (`ansetzung_closed`); a fixture decided, called off or left by a club (`ansetzung_decided`), then one
    whose date, time, ground or sides moved since the row was asked (`ansetzung_changed`); an answer after the
    deadline's day (`ansetzung_deadline_past`); a proposal dated before today (`ansetzung_vorschlag_past`); one naming
    the day and hour the fixture already holds (`ansetzung_vorschlag_unchanged`, on both boxes); and a proposal the
    administrator's own save of that date would be refused: on or after a club's exit (`eligibility_disqualified`),
    outside the matchday (`spiel_outside_spieltag`), or within four hours of the ground's or the referee's other
    fixture (`spiel_double_booked`). The reason is stored as typed.
    """

    # Session 8: the answer judges the caller's seat on the row's team and then the row as the mailed link's answer
    # judged it (`app/api/spielbestaetigungen/public_router.py :: post_spielbestaetigung`, which this replaces).
    raise APIError(HTTPStatus.NOT_IMPLEMENTED, Code.UNHANDLED_CRASH)
