from collections.abc import Mapping
from datetime import datetime
from http import HTTPStatus
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.account.crud import press_einwilligung
from app.api.account.services import (
    changed_seat_choices,
    compose_seat_move,
    find_own_entry_refusal,
    withdrawal_line,
)
from app.api.identity.crud import refuse_without_a_seat, roles_of
from app.api.identity.lookup import SubjectLookup
from app.api.identity.services import holds_a_seat, own_seats, seat_is_confirmed
from app.api.teams.panel import FLTeamOverviewResponse, FLTeamSpieleResponse
from app.api.teams.schemas import FLTeamSeat, FLTeamSeatsResponse
from app.core.clock import utc_stamp
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, refuse
from app.core.dependencies import (
    DBClient,
    SaisonTeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exceptions import APIError
from app.core.journal import Journal
from app.core.security import PersonIdentifier, get_person_identifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_evidence import FLEinwilligungChoice
from app.shared.schemas.custom import CustomRouteObjectId
from app.shared.schemas.einwilligung import FLSeatEinwilligungPayload, by_choice
from app.shared.schemas.literals import KONTAKT_ROLLEN

# The person lane's identifier, as `app/api/registrierungen/person_router.py` declares it and for its reason.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/teams",
    dependencies=[Depends(verify_access_admin), Depends(get_person_identifier)],
)


def _as_seat(kontakte: Mapping[str, Any], slot: str) -> FLTeamSeat:
    person = kontakte.get(slot)
    if not isinstance(person, Mapping):
        return FLTeamSeat.model_validate({"rolle": slot, "name": None, "confirmed": False})

    return FLTeamSeat.model_validate(
        {
            "rolle": slot,
            "name": " ".join(str(person.get(field) or "").strip() for field in ("first_name", "last_name")).strip() or None,
            "confirmed": seat_is_confirmed({"kontakte": kontakte}, slot),
        }
    )


# `/self/seats`, its own segment: the admin router serves this team and season under its own paths,
# and one path in both routers would be answered by whichever was mounted first.
@router.get("/{team_id:objectid}/saisons/{saison_id}/self/seats", response_model=FLTeamSeatsResponse, summary="A team's seats in one season")
async def get_team_seats(
    team_id: CustomRouteObjectId,
    saison_id: str,
    identifier: PersonIdentifier,
    saison_teams_collection: SaisonTeamsCollection,
    records: SubjectLookup,
    db: DBClient,
) -> FLTeamSeatsResponse:
    """
    The team's three seats in this season, each with its holder's name and whether that person has confirmed it.

    Always three lines, an empty slot answered with no name. No seat's address, telephone number, birthdate or
    confirmation date is served, whoever asks.
    """

    # A snapshot rather than a transaction, for `get_open_registrierungen`'s reason.
    async with db.start_session(snapshot=True) as session:
        await refuse_without_a_seat(identifier, records, team_id=team_id, saison_id=saison_id, session=session)

        # The seat just judged lives on this row, read in the same snapshot, so it stands and no 404 is owed.
        row = await saison_teams_collection.find_one(
            {"saison_id": saison_id, "team_id": team_id},
            [f"kontakte.{slot}.{field}" for slot in KONTAKT_ROLLEN for field in ("first_name", "last_name", "einwilligung.confirmed_at")],
            session=session,
        )
        kontakte = (row or {}).get("kontakte") or {}

    return FLTeamSeatsResponse(team_id=team_id, saison_id=saison_id, seats=[_as_seat(kontakte, slot) for slot in KONTAKT_ROLLEN])


@router.patch(
    "/{team_id:objectid}/saisons/{saison_id}/account/einwilligung",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change a seat holder's own WhatsApp and media consent on one team's season",
)
async def patch_einwilligung(
    team_id: CustomRouteObjectId,
    saison_id: str,
    einwilligung_data: Annotated[FLSeatEinwilligungPayload, Body()],
    identifier: PersonIdentifier,
    saison_teams_collection: SaisonTeamsCollection,
    records: SubjectLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> None:
    """
    Set the signed-in person's two consents on every seat they hold on this team's season row: WhatsApp and media.

    One answer for all of them: a person holding two of the row's slots answers once, each choice moving only where it
    differs from the row as the page served it, so seats answered apart keep their answers to a choice not changed. No
    other slot of the row and no other row is written, each choice moving with its own evidence and leaving the
    other standing; a press moving no seat writes nothing. A GRANT (`scope` to `kontakt_data_whatsapp` or `media`
    to `true`) is taken on a row of an `active` or `future` season its team has not left; a withdrawal on any row the
    person confirmed a seat on, a past season's included.

    Refuses, in this order: a row on which the address holds no confirmed seat (`role_not_held`); a
    `evidence_state` other than the held seats' own, either choice having moved since the page was served
    (`choices_stale`); a grant where the row grants no panel (`giving_not_allowed`); a choice moving onto a grant
    under a label other than its current wording's, the page loaded before a rewording (`grant_wording_stale`);
    `media` moving to `true` where a held seat's stored birthdate does not reach `MEDIA_MIN_AGE_YEARS` today or is
    missing (`media_age`). Each refusal writes nothing.
    """

    pressed: dict[FLEinwilligungChoice, object] = {"scope": einwilligung_data.scope, "media": einwilligung_data.media}
    at = utc_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def write(session: AsyncClientSession) -> None:
        row = await saison_teams_collection.find_one(
            {"saison_id": saison_id, "team_id": team_id},
            {f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in ("email", "birth_date", "einwilligung")},
            session=session,
        )
        rollen = [] if row is None else own_seats(row, identifier)
        refuse(find_own_entry_refusal(held=bool(rollen)))
        assert row is not None
        seats = {slot: row["kontakte"][slot] for slot in rollen}
        chosen = changed_seat_choices(blocks=[seat["einwilligung"] for seat in seats.values()], pressed=pressed)

        async def may_give() -> bool:
            # The panel narrowing a grant waits on: a `past` season's seat and a withdrawn team's grant none.
            subject = await roles_of(identifier, records, session=session)
            return holds_a_seat(subject.seats, team_id=team_id, saison_id=saison_id)

        await press_einwilligung(
            blocks=[seat["einwilligung"] for seat in seats.values()],
            birth_dates=[seat.get("birth_date") for seat in seats.values()],
            chosen=chosen,
            evidence_state=einwilligung_data.evidence_state.model_dump(),
            text_versions=einwilligung_data.text_versions,
            may_give=may_give,
            today=today,
        )

        update = compose_seat_move(
            seats={slot: seat["einwilligung"] for slot, seat in seats.items()},
            chosen=chosen,
            at=at,
            text_versions=by_choice(einwilligung_data.text_versions),
        )
        if update is not None:
            await patch_one_in_db(
                collection=saison_teams_collection,
                db_filter={"_id": row["_id"]},
                update=update,
                session=session,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )
        choices = withdrawal_line(blocks=[seat["einwilligung"] for seat in seats.values()], chosen=chosen)
        if choices is not None:
            journal.note("withdrawal", [f"{Collection.SAISON_TEAMS}/{row['_id']}"], choices=list(choices), seats=rollen)

    async with journal:
        async with transaction_session(db) as session:
            await session.with_transaction(write)


@router.get(
    "/{team_id:objectid}/saisons/{saison_id}/self/overview",
    response_model=FLTeamOverviewResponse,
    summary="A team's Übersicht in one season",
)
async def get_team_overview(team_id: CustomRouteObjectId, saison_id: str, identifier: PersonIdentifier) -> FLTeamOverviewResponse:
    """
    Everything a team's Übersicht shows, in one read, for a person holding any contact seat on the team in this season.

    The team's name, code, full name and colour, and the seats the signed-in person holds on it. The dates the league
    asked the team to confirm that still hold work: unanswered (`valid`, or `vorschlag` with the other club's proposed
    date and hour), unanswered past its deadline (`expired`), or declined with the team's own proposal and reason until
    the league adopts or discards it (`declined`); an agreed date is not listed. The coming fixtures holding a day and
    an hour for which the team has stored no line-up, each with its marks. The registrations awaiting the team's
    decision, newest first. And the team's three seats, each with its holder's name and whether that person confirmed it.

    No address, telephone number, birthdate or consent record of anybody is served. Refused `role_not_held` where the
    signed-in person holds no seat on this team in this season.
    """

    # Session 8: the read joins the team's season row, its open confirmation rows, its coming fixtures with their
    # line-ups, and its pending registrations in one snapshot.
    raise APIError(HTTPStatus.NOT_IMPLEMENTED, Code.UNHANDLED_CRASH)


@router.get(
    "/{team_id:objectid}/saisons/{saison_id}/self/spiele",
    response_model=FLTeamSpieleResponse,
    summary="A team's fixtures in one season, with what is open on each",
)
async def get_team_spiele(team_id: CustomRouteObjectId, saison_id: str, identifier: PersonIdentifier) -> FLTeamSpieleResponse:
    """
    Every fixture of the team in this season in the order the draw numbered them, for a person holding any contact seat on it.

    Each as the public reads serve a fixture, with its matchday's `position` and its phase's count of matchdays, the
    state of the date the league asked the team to confirm, and its line-up's marks: whether one is stored, the phase
    the clock puts it in, and the instants it is due and locks at. `aufstellung` is null for a fixture holding no day or
    no hour.

    Refused `role_not_held` where the signed-in person holds no seat on this team in this season.
    """

    # Session 8: the read joins the team's fixtures to its newest confirmation row and its line-up for each.
    raise APIError(HTTPStatus.NOT_IMPLEMENTED, Code.UNHANDLED_CRASH)
