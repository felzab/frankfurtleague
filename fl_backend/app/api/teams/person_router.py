from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any, Final, NamedTuple

from fastapi import APIRouter, status
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.account.services import (
    changed_seat_choices,
    compose_seat_move,
    find_own_entry_refusal,
    press_einwilligung,
    withdrawal_line,
)
from app.api.aufstellungen.schemas import FLAufstellungMarks
from app.api.aufstellungen.services import aufstellung_marks, aufstellung_stands
from app.api.identity.crud import roles_of
from app.api.identity.lookup import SubjectLookup
from app.api.identity.services import find_role_refusal, holds_a_seat, own_seats
from app.api.registrierungen.crud import pull_open_registrierungen
from app.api.registrierungen.services import registrierung_is_confirmed
from app.api.saisons.services import SPIELTAG_POSITION_LOOKUP, matchday_of
from app.api.spielbestaetigungen.crud import JUDGED_JUNCTION_FIELDS
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungAppointment, FLSpielbestaetigungTeamState
from app.api.spielbestaetigungen.services import (
    AnsetzungState,
    ansetzung_values_of,
    austritte_of,
    build_closable_filter,
    compose_ansetzung,
    joined_decision_of,
    lapsed_on,
    reason_of,
    team_state_of,
    view_ansetzung_of,
)
from app.api.spiele.services import build_spiele_pipeline
from app.api.teams.panel import (
    FLTeamOverviewResponse,
    FLTeamPanelAufstellung,
    FLTeamPanelRegistrierung,
    FLTeamPanelSpiel,
    FLTeamPanelSpielbestaetigung,
    FLTeamSpieleResponse,
)
from app.api.teams.schemas import FLTeamSeat
from app.api.teams.services import build_team_spiele_filter
from app.core.clock import utc_stamp
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, patch_past_the_version_in_db, pull_one_from_db, pull_whole_from_db, refuse
from app.core.dependencies import (
    DBClient,
    GermanDay,
    GermanyNow,
    RegistrierungenReadCollection,
    SaisonTeamsCollection,
    SaisonTeamsReadCollection,
    SnapshotSession,
    SpieleReadCollection,
    TeamsReadCollection,
)
from app.core.journal import Journal
from app.core.readonly import ReadCollection
from app.core.routing import by_id
from app.core.security import PERSON_TIER, PersonIdentifier
from app.core.transactions import transact
from app.shared.einwilligung import seat_is_confirmed
from app.shared.einwilligung_evidence import FLEinwilligungChoice
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.einwilligung import FLSeatEinwilligungPayload, by_choice
from app.shared.schemas.literals import KONTAKT_SEATS, FLKontaktSeat, FLSpielSide

router = APIRouter(
    prefix="/teams",
    dependencies=PERSON_TIER,
)


def _as_seat(kontakte: Mapping[str, Any], seat: FLKontaktSeat, *, also: FLKontaktSeat | None) -> FLTeamSeat:
    person = kontakte.get(seat)
    if person is None:
        return FLTeamSeat.model_validate({"seats": [seat], "name": None, "confirmed": False})

    return FLTeamSeat.model_validate(
        {
            "seats": [seat] if also is None else [seat, also],
            "name": " ".join(str(person.get(field) or "").strip() for field in ("first_name", "last_name")).strip() or None,
            "confirmed": seat_is_confirmed(person),
        }
    )


def _seats_of(kontakte: Mapping[str, Any]) -> list[FLTeamSeat]:
    """One entry per person, in `KONTAKT_SEATS` order: a Trainer holding the seat `trainer_is_also` names is one entry naming both.

    Only beside a Trainer who stands: an emptied Trainer's seat names nobody whose second seat it could be.
    """

    also: FLKontaktSeat | None = kontakte.get("trainer_is_also") if kontakte.get("trainer") is not None else None

    return [_as_seat(kontakte, seat, also=also if seat == "trainer" else None) for seat in KONTAKT_SEATS if seat != also]


@router.patch(
    f"{by_id('team_id')}/saisons/{{saison_id}}/einwilligung",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change a seat holder's own WhatsApp and media consent on one team's season",
)
async def patch_einwilligung(
    team_id: CustomObjectId,
    saison_id: str,
    einwilligung_data: FLSeatEinwilligungPayload,
    identifier: PersonIdentifier,
    saison_teams_collection: SaisonTeamsCollection,
    records: SubjectLookup,
    db: DBClient,
    today: GermanDay,
    germany_now: GermanyNow,
) -> None:
    """Set the signed-in person's two consents on every seat they hold on this team's season row: WhatsApp and media.

    Each choice moves only where it differs from the row as the page served it, so seats answered apart keep their
    answers to a choice not changed.
    """

    pressed: dict[FLEinwilligungChoice, object] = {"scope": einwilligung_data.scope, "media": einwilligung_data.media}
    at = utc_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def write(session: AsyncClientSession) -> None:
        row = await saison_teams_collection.find_one(
            {"saison_id": saison_id, "team_id": team_id},
            {f"kontakte.{seat}.{field}": 1 for seat in KONTAKT_SEATS for field in ("email", "birth_date", "einwilligung")},
            session=session,
        )
        seats = [] if row is None else own_seats(row, identifier)
        refuse(find_own_entry_refusal(held=bool(seats)))
        assert row is not None
        held = {seat: row["kontakte"][seat] for seat in seats}
        chosen = changed_seat_choices(blocks=[person["einwilligung"] for person in held.values()], pressed=pressed)

        async def may_give() -> bool:
            # The panel narrowing a grant waits on: a `past` season's seat and a withdrawn team's grant none.
            subject = await roles_of(identifier, records, session=session)
            return holds_a_seat(subject.seats, team_id=team_id, saison_id=saison_id)

        await press_einwilligung(
            blocks=[person["einwilligung"] for person in held.values()],
            birth_dates=[person.get("birth_date") for person in held.values()],
            chosen=chosen,
            evidence_state=einwilligung_data.evidence_state.model_dump(),
            may_give=may_give,
            today=today,
        )

        update = compose_seat_move(
            seats={seat: person["einwilligung"] for seat, person in held.items()},
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
        choices = withdrawal_line(blocks=[person["einwilligung"] for person in held.values()], chosen=chosen)
        if choices is not None:
            journal.note("withdrawal", [f"{Collection.SAISON_TEAMS}/{row['_id']}"], choices=list(choices), seats=seats)

    async with journal:
        await transact(db, write)


# What a team's pages read of the confirmation rows of its fixtures: the judgement's fields, and the answer's way and
# proposal, which the Übersicht states of the team's own row alone. Never who answered.
SPIELBESTAETIGUNG_ROW_FIELDS: Final[Mapping[str, int]] = {
    "saison_id": 1,
    "spiel_id": 1,
    "party": 1,
    "ansetzung": 1,
    "deadline": 1,
    "answer.kind": 1,
    "answer.vorschlag": 1,
    "closed": 1,
}

SPIELBESTAETIGUNG_ROWS_AS: Final = "spielbestaetigung_rows"
OWN_AUFSTELLUNG_AS: Final = "own_aufstellung"


def _team_spiele_pipeline(*, saison_id: str, team_id: Any) -> list[Mapping[str, Any]]:
    """The team's fixtures of the season as the public reads join them, in the draw's order.

    Each with its matchday, the team's stored line-up and every unclosed club row of the fixture.
    """

    return [
        *build_spiele_pipeline(db_filter=build_team_spiele_filter(saison_id=saison_id, team_id=team_id), sort_by=[("spiel_nr", 1)]),
        SPIELTAG_POSITION_LOOKUP,
        # Its entries alone, on the unique `(spiel_id, team_id)` key: whether one stands is all either page reads.
        {
            "$lookup": {
                "from": Collection.AUFSTELLUNGEN,
                "localField": "_id",
                "foreignField": "spiel_id",
                "pipeline": [{"$match": {"team_id": team_id}}, {"$project": {"_id": 0, "spieler": 1}}],
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
                    {"$project": dict(SPIELBESTAETIGUNG_ROW_FIELDS)},
                ],
                "as": SPIELBESTAETIGUNG_ROWS_AS,
            }
        },
    ]


class _Spielbestaetigung(NamedTuple):
    """The team's row about a fixture as it stands, and the state its pages show of it."""

    row: Mapping[str, Any]
    state: FLSpielbestaetigungTeamState
    # The other club's proposed date and hour while its decline stands open beside this row.
    vorschlag_open: FLSpielbestaetigungAppointment | None
    lapsed_on: str | None


def _spielbestaetigung_of(
    spiel_raw: Mapping[str, Any], *, team_id: Any, junctions: Sequence[Mapping[str, Any]], now: datetime
) -> _Spielbestaetigung | None:
    """The team's unclosed row about the fixture's Ansetzung as it stands, where it asks the team anything."""

    current = ansetzung_values_of(compose_ansetzung(spiel_raw))
    rows = [row for row in spiel_raw[SPIELBESTAETIGUNG_ROWS_AS] if ansetzung_values_of(row["ansetzung"]) == current]
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
    ansetzung_state = AnsetzungState(spiel=spiel_raw, junctions=junctions)
    state = team_state_of(spielbestaetigung_raw=own, ansetzung_state=ansetzung_state, now=now, vorschlag_open=vorschlag_open)
    if state is None:
        return None

    reason = reason_of(spielbestaetigung_raw=own, ansetzung_state=ansetzung_state, now=now)
    return _Spielbestaetigung(
        row=own,
        state=state,
        vorschlag_open=vorschlag_open,
        lapsed_on=lapsed_on(
            spielbestaetigung_raw=own, reason=reason, spiel=spiel_raw, austritte=austritte_of(ansetzung_state.junctions), now=now
        ),
    )


def _side_of(spiel_raw: Mapping[str, Any], team_id: Any) -> FLSpielSide:
    return "team1" if (spiel_raw.get("team1") or {}).get("team_id") == team_id else "team2"


def _marks_of(spiel_raw: Mapping[str, Any], now: datetime) -> FLAufstellungMarks | None:
    # A fixture decided, called off or fielding a club out by its day owes no line-up.
    if joined_decision_of(spiel_raw) is not None:
        return None

    own = spiel_raw[OWN_AUFSTELLUNG_AS]
    stored = aufstellung_stands(own[0] if own else None)

    return aufstellung_marks(date=spiel_raw.get("date"), time=spiel_raw.get("time"), stored=stored, now=now)


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
    team_ids = {(spiel.get(side) or {}).get("team_id") for spiel in spiele for side in ("team1", "team2")} - {None}
    # Bounded by the season's clubs, far below the read's cap.
    junctions = await pull_whole_from_db(
        collection=saison_teams_collection,
        db_filter={"saison_id": saison_id, "team_id": {"$in": sorted(team_ids, key=str)}},
        projection=JUDGED_JUNCTION_FIELDS,
        session=session,
    )

    return spiele, junctions


@router.get(
    f"{by_id('team_id')}/saisons/{{saison_id}}/overview",
    summary="A team's Übersicht in one season",
)
async def get_team_overview(
    team_id: CustomObjectId,
    saison_id: str,
    identifier: PersonIdentifier,
    teams_collection: TeamsReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    spiele_collection: SpieleReadCollection,
    registrierungen_collection: RegistrierungenReadCollection,
    records: SubjectLookup,
    session: SnapshotSession,
    germany_now: GermanyNow,
) -> FLTeamOverviewResponse:
    """Everything a team's Übersicht shows in one read, for a person holding any contact seat on the team in this season.

    No address, telephone number, birthdate or consent record of anybody is served.
    """

    # A snapshot rather than a transaction: the read writes nothing, and one point in time keeps the seat and every row
    # it serves from straddling a commit.
    subject = await roles_of(identifier, records, session=session)
    refuse(find_role_refusal(seats=subject.seats, team_id=team_id, saison_id=saison_id))

    # The seat just judged lives on this row, read in the same snapshot, so it stands.
    row = await pull_one_from_db(
        collection=saison_teams_collection,
        db_filter={"saison_id": saison_id, "team_id": team_id},
        projection=[
            "shorthand",
            *(f"kontakte.{seat}.{field}" for seat in KONTAKT_SEATS for field in ("first_name", "last_name", "einwilligung.confirmed_at")),
        ],
        session=session,
    )
    team = await pull_one_from_db(collection=teams_collection, db_filter={"_id": team_id}, projection=["full_name"], session=session)
    spiele, junctions = await _pull_team_spiele(
        spiele_collection=spiele_collection,
        saison_teams_collection=saison_teams_collection,
        saison_id=saison_id,
        team_id=team_id,
        session=session,
    )
    pending = await pull_open_registrierungen(
        registrierungen_collection=registrierungen_collection, saison_id=saison_id, team_id=team_id, session=session
    )

    spielbestaetigungen: list[FLTeamPanelSpielbestaetigung] = []
    aufstellungen: list[FLTeamPanelAufstellung] = []
    for spiel in sorted(spiele, key=lambda spiel: (str(spiel.get("date") or ""), str(spiel.get("time") or ""), spiel["spiel_nr"])):
        spielbestaetigung = _spielbestaetigung_of(spiel, team_id=team_id, junctions=junctions, now=germany_now)
        if spielbestaetigung is not None and spielbestaetigung.state != "agreed":
            answer = spielbestaetigung.row.get("answer") or {}
            declined = spielbestaetigung.state == "declined"
            spielbestaetigungen.append(
                FLTeamPanelSpielbestaetigung.model_validate(
                    {
                        "spielbestaetigung_id": spielbestaetigung.row["_id"],
                        "spiel_id": spiel["_id"],
                        "ansetzung": view_ansetzung_of(spiel),
                        "side": _side_of(spiel, team_id),
                        "state": spielbestaetigung.state,
                        "deadline": spielbestaetigung.row["deadline"],
                        "lapsed_on": spielbestaetigung.lapsed_on,
                        "vorschlag": answer.get("vorschlag")
                        if declined
                        else spielbestaetigung.vorschlag_open
                        if spielbestaetigung.state == "vorschlag"
                        else None,
                    }
                )
            )

        marks = _marks_of(spiel, germany_now)
        # Open work alone: one the team can still enter, on a fixture still to be played.
        if marks is not None and not marks.stored and marks.phase != "locked":
            aufstellungen.append(FLTeamPanelAufstellung(spiel_id=spiel["_id"], ansetzung=view_ansetzung_of(spiel), marks=marks))

    kontakte = row.get("kontakte") or {}

    return FLTeamOverviewResponse(
        shorthand=row["shorthand"],
        full_name=team["full_name"],
        spielbestaetigungen=spielbestaetigungen,
        aufstellungen=aufstellungen,
        registrierungen=[
            FLTeamPanelRegistrierung.model_validate(
                {
                    "registrierung_id": registrierung["_id"],
                    "first_name": registrierung["first_name"],
                    "last_name": registrierung["last_name"],
                    "position": registrierung.get("position"),
                    "stufe": registrierung.get("stufe"),
                    "admissible": registrierung_is_confirmed(einwilligung=registrierung.get("einwilligung")),
                }
            )
            for registrierung in pending
        ],
        seats=_seats_of(kontakte),
    )


@router.get(
    f"{by_id('team_id')}/saisons/{{saison_id}}/spiele",
    summary="A team's fixtures in one season, with what is open on each",
)
async def get_team_spiele(
    team_id: CustomObjectId,
    saison_id: str,
    identifier: PersonIdentifier,
    saison_teams_collection: SaisonTeamsReadCollection,
    spiele_collection: SpieleReadCollection,
    records: SubjectLookup,
    session: SnapshotSession,
    germany_now: GermanyNow,
) -> FLTeamSpieleResponse:
    """Every fixture of the team in this season in the order the draw numbered them, for a person holding any contact seat on it.

    Each carries the state of the date the league asked the team to confirm and its line-up's marks, `spielbestaetigung` null where
    no row asks the team about the fixture as it stands.
    """

    # A snapshot rather than a transaction: the read writes nothing, and one point in time keeps the seat and every row
    # it serves from straddling a commit.
    subject = await roles_of(identifier, records, session=session)
    refuse(find_role_refusal(seats=subject.seats, team_id=team_id, saison_id=saison_id))
    spiele, junctions = await _pull_team_spiele(
        spiele_collection=spiele_collection,
        saison_teams_collection=saison_teams_collection,
        saison_id=saison_id,
        team_id=team_id,
        session=session,
    )

    def served(spiel: Mapping[str, Any]) -> dict[str, Any]:
        spielbestaetigung = _spielbestaetigung_of(spiel, team_id=team_id, junctions=junctions, now=germany_now)

        return {
            **spiel,
            **matchday_of(spiel),
            "spielbestaetigung": None if spielbestaetigung is None else spielbestaetigung.state,
            "aufstellung": _marks_of(spiel, germany_now),
        }

    return FLTeamSpieleResponse(
        team_id=team_id, saison_id=saison_id, spiele=[FLTeamPanelSpiel.model_validate(served(spiel)) for spiel in spiele]
    )
