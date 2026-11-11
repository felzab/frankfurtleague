from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Annotated, Any, Final, NamedTuple

from fastapi import APIRouter, Body, Depends, status
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.account.crud import press_einwilligung
from app.api.account.services import (
    changed_seat_choices,
    compose_seat_move,
    find_own_entry_refusal,
    withdrawal_line,
)
from app.api.aufstellungen.schemas import FLAufstellungMarks
from app.api.aufstellungen.services import aufstellung_marks
from app.api.identity.crud import roles_of
from app.api.identity.lookup import SubjectLookup
from app.api.identity.services import find_role_refusal, holds_a_seat, own_seats, rollen_on, seat_is_confirmed
from app.api.registrierungen.crud import pull_open_registrierungen
from app.api.registrierungen.services import registrierung_is_confirmed
from app.api.saisons.services import SPIELTAG_POSITION_LOOKUP, matchday_of
from app.api.spielbestaetigungen.crud import JUDGED_VEREIN_FIELDS
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungAppointment, FLSpielbestaetigungTeamState
from app.api.spielbestaetigungen.services import (
    AnsetzungState,
    ansetzung_digest_of,
    build_closable_filter,
    team_state_of,
    view_ansetzung_of,
)
from app.api.spiele.services import build_spiele_pipeline
from app.api.teams.panel import (
    FLTeamOverviewResponse,
    FLTeamPanelAufstellung,
    FLTeamPanelRegistrierung,
    FLTeamPanelSpiel,
    FLTeamPanelTermin,
    FLTeamSpieleResponse,
)
from app.api.teams.schemas import FLTeamSeat
from app.api.teams.services import build_team_spiele_filter
from app.core.clock import utc_stamp
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_past_the_version_in_db, refuse
from app.core.dependencies import (
    DBClient,
    RegistrierungenReadCollection,
    SaisonTeamsCollection,
    SaisonTeamsReadCollection,
    SpieleReadCollection,
    TeamsReadCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.journal import Journal
from app.core.readonly import ReadCollection
from app.core.security import PersonIdentifier, get_person_identifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_evidence import FLEinwilligungChoice
from app.shared.schemas.custom import CustomRouteObjectId
from app.shared.schemas.einwilligung import FLSeatEinwilligungPayload, by_choice
from app.shared.schemas.literals import KONTAKT_ROLLEN, FLKontaktRolle, FLSpielSide

# The person lane's identifier, as `app/api/registrierungen/person_router.py` declares it and for its reason.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/teams",
    dependencies=[Depends(verify_access_admin), Depends(get_person_identifier)],
)


def _as_seat(kontakte: Mapping[str, Any], slot: FLKontaktRolle, *, also: FLKontaktRolle | None) -> FLTeamSeat:
    person = kontakte.get(slot)
    if not isinstance(person, Mapping):
        return FLTeamSeat.model_validate({"rollen": [slot], "name": None, "confirmed": False})

    return FLTeamSeat.model_validate(
        {
            "rollen": [slot] if also is None else [slot, also],
            "name": " ".join(str(person.get(field) or "").strip() for field in ("first_name", "last_name")).strip() or None,
            "confirmed": seat_is_confirmed({"kontakte": kontakte}, slot),
        }
    )


def _seats_of(kontakte: Mapping[str, Any]) -> list[FLTeamSeat]:
    """One entry per person, in `KONTAKT_ROLLEN` order: a Trainer holding the seat `trainer_is_also` names is one entry naming both.

    Only beside a Trainer who stands: an emptied Trainer's seat names nobody whose second seat it could be.
    """

    also: FLKontaktRolle | None = kontakte.get("trainer_is_also") if isinstance(kontakte.get("trainer"), Mapping) else None

    return [_as_seat(kontakte, slot, also=also if slot == "trainer" else None) for slot in KONTAKT_ROLLEN if slot != also]


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
            # Past the row's count: the team editor saves no consent, keeping each kept seat's record as its own read in
            # session finds it, so an editor opened before this press saves around it rather than meeting a stale version.
            await patch_past_the_version_in_db(
                collection=saison_teams_collection, db_filter={"_id": row["_id"]}, update=update, session=session
            )
        choices = withdrawal_line(blocks=[seat["einwilligung"] for seat in seats.values()], chosen=chosen)
        if choices is not None:
            journal.note("withdrawal", [f"{Collection.SAISON_TEAMS}/{row['_id']}"], choices=list(choices), seats=rollen)

    async with journal:
        async with transaction_session(db) as session:
            await session.with_transaction(write)


# What a team's pages read of the confirmation rows of its fixtures: the judgement's fields, and the answer's way,
# proposal and reason, which the Übersicht states of the team's own row alone. Never who answered.
TERMIN_ROW_FIELDS: Final[Mapping[str, int]] = {
    "saison_id": 1,
    "spiel_id": 1,
    "party": 1,
    "ansetzung": 1,
    "deadline": 1,
    "answer.kind": 1,
    "answer.vorschlag": 1,
    "answer.reason": 1,
    "closed": 1,
}

TERMIN_ROWS_AS: Final = "termin_rows"
OWN_AUFSTELLUNG_AS: Final = "own_aufstellung"


def _team_spiele_pipeline(*, saison_id: str, team_id: Any) -> list[Mapping[str, Any]]:
    """The team's fixtures of the season as the public reads join them, in the draw's order.

    Each with its matchday, the team's stored line-up and every unclosed club row of the fixture.
    """

    return [
        *build_spiele_pipeline(db_filter=build_team_spiele_filter(saison_id=saison_id, team_id=team_id), sort_by=[("spiel_nr", 1)]),
        SPIELTAG_POSITION_LOOKUP,
        # Its id alone: whether one is stored is all either page reads, on the unique `(spiel_id, team_id)` key.
        {
            "$lookup": {
                "from": Collection.AUFSTELLUNGEN,
                "localField": "_id",
                "foreignField": "spiel_id",
                "pipeline": [{"$match": {"team_id": team_id}}, {"$project": {"_id": 1}}],
                "as": OWN_AUFSTELLUNG_AS,
            }
        },
        # Both clubs' rows, the other's proposal being what a still-open date of this team shows as `vorschlag`.
        {
            "$lookup": {
                "from": Collection.SPIELBESTAETIGUNGEN,
                "localField": "_id",
                "foreignField": "spiel_id",
                "pipeline": [
                    {"$match": {"saison_id": saison_id, "party.kind": "team", **build_closable_filter()}},
                    {"$project": dict(TERMIN_ROW_FIELDS)},
                ],
                "as": TERMIN_ROWS_AS,
            }
        },
    ]


class _Termin(NamedTuple):
    """The team's row about a fixture as it stands, and the state its pages show of it."""

    row: Mapping[str, Any]
    state: FLSpielbestaetigungTeamState
    # The other club's proposed date and hour while its decline stands open beside this row.
    vorschlag_open: FLSpielbestaetigungAppointment | None


def _termin_of(spiel_raw: Mapping[str, Any], *, team_id: Any, vereine: Sequence[Mapping[str, Any]], today: str) -> _Termin | None:
    """The team's unclosed row about the fixture's Ansetzung as it stands, where it asks the team anything."""

    digest = ansetzung_digest_of(spiel_raw)
    rows = [row for row in spiel_raw[TERMIN_ROWS_AS] if row["ansetzung"]["digest"] == digest]
    own = next((row for row in rows if row["party"]["team_id"] == team_id), None)
    if own is None:
        return None

    proposal = next(
        (
            (row.get("answer") or {}).get("vorschlag")
            for row in rows
            if row["party"]["team_id"] != team_id and (row.get("answer") or {}).get("kind") == "declined"
        ),
        None,
    )
    vorschlag_open = None if proposal is None else FLSpielbestaetigungAppointment.model_validate(proposal)
    state = team_state_of(
        spielbestaetigung_raw=own, ansetzung_state=AnsetzungState(spiel=spiel_raw, vereine=vereine), today=today, vorschlag_open=vorschlag_open
    )

    return None if state is None else _Termin(row=own, state=state, vorschlag_open=vorschlag_open)


def _side_of(spiel_raw: Mapping[str, Any], team_id: Any) -> FLSpielSide:
    return "team1" if (spiel_raw.get("team1") or {}).get("team_id") == team_id else "team2"


def _marks_of(spiel_raw: Mapping[str, Any], now: datetime) -> FLAufstellungMarks | None:
    return aufstellung_marks(date=spiel_raw.get("date"), time=spiel_raw.get("time"), stored=bool(spiel_raw[OWN_AUFSTELLUNG_AS]), now=now)


async def _pull_team_spiele(
    *,
    spiele_collection: ReadCollection,
    saison_teams_collection: ReadCollection,
    saison_id: str,
    team_id: Any,
    session: AsyncClientSession,
) -> tuple[list[Mapping[str, Any]], list[Mapping[str, Any]]]:
    """The team's joined fixtures, and the season rows of every club they field, whose exits judge a row's state."""

    spiele = await aggregate_many_from_db(
        collection=spiele_collection, pipeline=_team_spiele_pipeline(saison_id=saison_id, team_id=team_id), session=session
    )
    clubs = {(spiel.get(side) or {}).get("team_id") for spiel in spiele for side in ("team1", "team2")} - {None}
    vereine = await saison_teams_collection.find(
        {"saison_id": saison_id, "team_id": {"$in": sorted(clubs, key=str)}}, JUDGED_VEREIN_FIELDS, session=session
    ).to_list(length=None)

    return spiele, vereine


# `/self/...`, its own segment: the admin router serves this team and season under its own paths, and one path in both
# routers would be answered by whichever was mounted first.
@router.get(
    "/{team_id:objectid}/saisons/{saison_id}/self/overview",
    response_model=FLTeamOverviewResponse,
    summary="A team's Übersicht in one season",
)
async def get_team_overview(
    team_id: CustomRouteObjectId,
    saison_id: str,
    identifier: PersonIdentifier,
    teams_collection: TeamsReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    spiele_collection: SpieleReadCollection,
    registrierungen_collection: RegistrierungenReadCollection,
    records: SubjectLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> FLTeamOverviewResponse:
    """
    Everything a team's Übersicht shows, in one read, for a person holding any contact seat on the team in this season.

    The team's name, code, full name and colour, and the seats the signed-in person holds on it. The dates the league
    asked the team to confirm that still hold work: unanswered (`valid`, or `vorschlag` with the other club's proposed
    date and hour), unanswered past its deadline (`expired`), or declined with the team's own proposal and reason until
    the league adopts or discards it (`declined`); an agreed date is not listed. Each by its day and hour. The coming
    fixtures holding a day and an hour, neither decided nor called off, for which the team has stored no line-up and may
    still enter one, each with its marks, soonest first. The registrations awaiting the team's decision, newest first,
    each with the pupil's own position and Stufe, under the cap the team's Registrierungen page reads them by, and
    `registrierungen_complete` false where it cut some. And the team's three seats, each with its holder's name and whether that
    person confirmed it.

    No address, telephone number, birthdate or consent record of anybody is served. Refused `role_not_held` where the
    signed-in person holds no seat on this team in this season.
    """

    # A snapshot rather than a transaction, for `get_open_registrierungen`'s reason.
    async with db.start_session(snapshot=True) as session:
        subject = await roles_of(identifier, records, session=session)
        refuse(find_role_refusal(seats=subject.seats, team_id=team_id, saison_id=saison_id))

        # The seat just judged lives on this row, read in the same snapshot, so it stands.
        row = await saison_teams_collection.find_one(
            {"saison_id": saison_id, "team_id": team_id},
            [
                "name",
                "shorthand",
                "trikot_farbe",
                *(f"kontakte.{slot}.{field}" for slot in KONTAKT_ROLLEN for field in ("first_name", "last_name", "einwilligung.confirmed_at")),
            ],
            session=session,
        )
        club = await teams_collection.find_one({"_id": team_id}, ["full_name"], session=session)
        assert row is not None and club is not None
        spiele, vereine = await _pull_team_spiele(
            spiele_collection=spiele_collection,
            saison_teams_collection=saison_teams_collection,
            saison_id=saison_id,
            team_id=team_id,
            session=session,
        )
        opened = await pull_open_registrierungen(
            registrierungen_collection=registrierungen_collection, saison_id=saison_id, team_id=team_id, session=session
        )

    termine: list[FLTeamPanelTermin] = []
    aufstellungen: list[FLTeamPanelAufstellung] = []
    for spiel in sorted(spiele, key=lambda spiel: (str(spiel.get("date") or ""), str(spiel.get("time") or ""), spiel["spiel_nr"])):
        termin = _termin_of(spiel, team_id=team_id, vereine=vereine, today=today)
        if termin is not None and termin.state != "agreed":
            answer = termin.row.get("answer") or {}
            declined = termin.state == "declined"
            termine.append(
                FLTeamPanelTermin.model_validate(
                    {
                        "spielbestaetigung_id": termin.row["_id"],
                        "spiel_id": spiel["_id"],
                        "ansetzung": view_ansetzung_of(spiel),
                        "side": _side_of(spiel, team_id),
                        "state": termin.state,
                        "deadline": termin.row["deadline"],
                        "vorschlag": answer.get("vorschlag") if declined else termin.vorschlag_open if termin.state == "vorschlag" else None,
                        "reason": answer.get("reason") if declined else None,
                    }
                )
            )

        marks = _marks_of(spiel, now)
        # Open work alone: one the team can still enter, on a fixture still to be played.
        if (
            marks is not None
            and not marks.stored
            and marks.phase != "locked"
            and spiel.get("ergebnis") is None
            and spiel.get("sonderereignis") is None
        ):
            aufstellungen.append(
                FLTeamPanelAufstellung(spiel_id=spiel["_id"], ansetzung=view_ansetzung_of(spiel), side=_side_of(spiel, team_id), marks=marks)
            )

    kontakte = row.get("kontakte") or {}

    return FLTeamOverviewResponse(
        team_id=team_id,
        saison_id=saison_id,
        name=row["name"],
        shorthand=row["shorthand"],
        full_name=club["full_name"],
        trikot_farbe=row.get("trikot_farbe"),
        rollen=rollen_on(subject.seats, team_id=team_id, saison_id=saison_id),
        termine=termine,
        aufstellungen=aufstellungen,
        registrierungen=[
            FLTeamPanelRegistrierung.model_validate(
                {
                    "registrierung_id": registrierung["_id"],
                    "first_name": registrierung["first_name"],
                    "last_name": registrierung["last_name"],
                    "submitted_at": registrierung["submitted_at"],
                    "position": registrierung.get("position"),
                    "stufe": registrierung.get("stufe"),
                    "admissible": registrierung_is_confirmed(einwilligung=registrierung.get("einwilligung")),
                }
            )
            for registrierung in opened.rows
        ],
        registrierungen_complete=opened.complete,
        seats=_seats_of(kontakte),
    )


@router.get(
    "/{team_id:objectid}/saisons/{saison_id}/self/spiele",
    response_model=FLTeamSpieleResponse,
    summary="A team's fixtures in one season, with what is open on each",
)
async def get_team_spiele(
    team_id: CustomRouteObjectId,
    saison_id: str,
    identifier: PersonIdentifier,
    saison_teams_collection: SaisonTeamsReadCollection,
    spiele_collection: SpieleReadCollection,
    records: SubjectLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> FLTeamSpieleResponse:
    """
    Every fixture of the team in this season in the order the draw numbered them, for a person holding any contact seat on it.

    Each as the public reads serve a fixture, with its matchday's `position` and its phase's count of matchdays, the
    state of the date the league asked the team to confirm, and its line-up's marks: whether one is stored, the phase
    the clock puts it in, and the instants it is due and locks at. `termin` is null where no row asks the team about
    the fixture as it stands, and `aufstellung` for a fixture holding no day or no hour.

    Refused `role_not_held` where the signed-in person holds no seat on this team in this season.
    """

    # A snapshot rather than a transaction, for `get_open_registrierungen`'s reason.
    async with db.start_session(snapshot=True) as session:
        subject = await roles_of(identifier, records, session=session)
        refuse(find_role_refusal(seats=subject.seats, team_id=team_id, saison_id=saison_id))
        spiele, vereine = await _pull_team_spiele(
            spiele_collection=spiele_collection,
            saison_teams_collection=saison_teams_collection,
            saison_id=saison_id,
            team_id=team_id,
            session=session,
        )

    def served(spiel: Mapping[str, Any]) -> dict[str, Any]:
        termin = _termin_of(spiel, team_id=team_id, vereine=vereine, today=today)

        return {**spiel, **matchday_of(spiel), "termin": None if termin is None else termin.state, "aufstellung": _marks_of(spiel, now)}

    return FLTeamSpieleResponse(
        team_id=team_id, saison_id=saison_id, spiele=[FLTeamPanelSpiel.model_validate(served(spiel)) for spiel in spiele]
    )
