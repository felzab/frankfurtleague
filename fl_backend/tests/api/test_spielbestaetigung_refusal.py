from collections.abc import Iterator, Mapping
from datetime import datetime, timedelta
from typing import Any

import pytest
from bson import ObjectId
from pydantic import BaseModel, ValidationError

from app.api.spielbestaetigungen.crud import JUDGED_SPIEL_FIELDS, JUDGED_VEREIN_FIELDS
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAppointment,
    FLSpielbestaetigungSchiedsrichterAnswerPayload,
    FLSpielbestaetigungTeamAnswerPayload,
)
from app.api.spielbestaetigungen.services import (
    AnsetzungState,
    compose_ansetzung,
    due_by_of,
    find_unanswerable_refusal,
    lapsed_on,
    proposal_payload,
    reason_of,
    state_of,
    view_ansetzung_of,
)
from app.api.spiele.schemas import SPIEL_PATCH_WRITTEN_FIELDS, FLSpiel
from app.core import clock
from app.core.codes import Code

TEAM1 = ObjectId("650000000000000000000101")
TEAM2 = ObjectId("650000000000000000000102")
SPIELORT = ObjectId("650000000000000000000103")
SCHIEDSRICHTER = ObjectId("650000000000000000000104")
SPIELTAG = ObjectId("650000000000000000000105")

NOW = datetime(2027, 5, 1, 12, tzinfo=clock.GERMANY)
DEADLINE = "2027-05-07"
DATE = "2027-05-14"

SEATS = {
    TEAM1: {"trainer": ("Ida", "Albers"), "ansprechperson": ("Jonas", "Brandt"), "stellvertretung": ("Klara", "Cordes")},
    TEAM2: {"trainer": ("Lea", "Dietz"), "ansprechperson": ("Mats", "Ernst"), "stellvertretung": ("Nora", "Funke")},
}
REFEREE = "Otto Gruber"


def spiel(**overrides: Any) -> dict[str, Any]:
    """A fixture as the name join serves it: dated, both sides, a ground and a referee; `FLSpiel` reads it as stored."""

    return {
        "_id": ObjectId("650000000000000000000109"),
        "spiel_nr": 7,
        "saison_id": "2027",
        "saison_phase": "gruppenphase",
        "spieltag_id": SPIELTAG,
        "date": DATE,
        "time": "18:30:00",
        "spielort": {"spielort_id": SPIELORT, "name": "Halle Ost", "maps_link": "Halle Ost, Frankfurt", "mietpreis": 40},
        "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER, "name": REFEREE, "payment": 20},
        "team1": {"team_id": TEAM1, "name": "Adler", "shorthand": "ADX", "tore": None},
        "team2": {"team_id": TEAM2, "name": "Biber", "shorthand": "BIX", "tore": None},
        "team1_quelle": None,
        "team2_quelle": None,
        "ergebnis": None,
        "elfmeterschiessen": None,
        "sonderereignis": None,
        "note": "Flutlicht",
        **overrides,
    }


def verein(team_id: ObjectId, *, austritt: str | None = None) -> dict[str, Any]:
    kontakte = {
        seat: {"first_name": first_name, "last_name": last_name, "email": f"{first_name.lower()}@example.com"}
        for seat, (first_name, last_name) in SEATS[team_id].items()
    }

    return {
        "team_id": team_id,
        "name": "Adler" if team_id == TEAM1 else "Biber",
        "austritt": None if austritt is None else {"date": austritt},
        "kontakte": kontakte,
    }


def ansetzung_state(*, spiel_overrides: dict[str, Any] | None = None, austritt: str | None = None) -> AnsetzungState:
    return AnsetzungState(spiel=spiel(**(spiel_overrides or {})), vereine=[verein(TEAM1, austritt=austritt), verein(TEAM2)])


def row(**overrides: Any) -> dict[str, Any]:
    """An open row of TEAM1's about `spiel()`'s Ansetzung."""

    return {
        "_id": ObjectId("650000000000000000000110"),
        "saison_id": "2027",
        "spiel_id": spiel()["_id"],
        "party": {"kind": "team", "team_id": TEAM1},
        "ansetzung": compose_ansetzung(spiel()),
        "deadline": DEADLINE,
        "answer": None,
        "closed": None,
        **overrides,
    }


class TestADecidedSpielTakesNoAnswer:
    """`ansetzung_decided`, which nothing else refuses: an answered row, a move and a lapsed deadline each have a route case."""

    @pytest.mark.parametrize(
        "situation",
        [
            pytest.param({"spiel_overrides": {"ergebnis": "2:1"}}, id="a-result"),
            pytest.param({"spiel_overrides": {"sonderereignis": "ausgefallen"}}, id="called-off"),
            pytest.param({"austritt": DATE}, id="a-club-left-by-the-day"),
        ],
    )
    def test_the_answer_is_refused(self, situation: dict[str, Any]):
        """Let through, a press tells its seat holder the answer counted on a fixture already settled, and stores it, with nothing failing."""

        refusal = find_unanswerable_refusal(spielbestaetigung_raw=row(), ansetzung_state=ansetzung_state(**situation), now=NOW)

        assert refusal is not None and refusal.error_code == Code.ANSETZUNG_DECIDED


class Recorded(Mapping[str, Any]):
    """A stored document noting every dotted path read off it, a key it lacks included."""

    def __init__(self, document: Mapping[str, Any], seen: set[str], prefix: str = "") -> None:
        self._document, self._seen, self._prefix = document, seen, prefix

    def __getitem__(self, key: str) -> Any:
        path = f"{self._prefix}.{key}" if self._prefix else key
        self._seen.add(path)
        value = self._document[key]
        return Recorded(value, self._seen, path) if isinstance(value, Mapping) else value

    def __iter__(self) -> Iterator[str]:
        return iter(self._document)

    def __len__(self) -> int:
        return len(self._document)


def loaded_by(projection: Mapping[str, Any], path: str) -> bool:
    """Whether a read through this projection holds the path, or the block a projected path sits under."""

    return any(path == key or path.startswith(f"{key}.") or key.startswith(f"{path}.") for key, kept in projection.items() if kept != 0)


class TestTheProjectionsHoldEverythingTheJudgesRead:
    """A path a judge reads that a projection drops reads as null.

    So a decided fixture would show `valid`, with nothing failing.
    """

    def test_a_rows_state_reads_nothing_its_projections_leave_out(self):
        spiel_seen: set[str] = set()
        vereine_seen: set[str] = set()
        # Undecided, unmoved and open, so every judge reads to its end; the exit after the fixture's day, so its date is read.
        situation = AnsetzungState(
            spiel=Recorded(spiel(), spiel_seen),
            vereine=[Recorded(verein(TEAM1, austritt="2027-06-01"), vereine_seen), Recorded(verein(TEAM2), vereine_seen)],
        )

        assert state_of(spielbestaetigung_raw=row(), ansetzung_state=situation, now=NOW, vorschlag_open=None) == "valid"
        view_ansetzung_of(situation.spiel)

        # The premise: `decision_of` read the fixture to its last test.
        assert {"ergebnis", "sonderereignis", "team2.tore", "austritt.date"} <= spiel_seen | vereine_seen
        assert [path for path in sorted(spiel_seen) if not loaded_by(JUDGED_SPIEL_FIELDS, path)] == []
        assert [path for path in sorted(vereine_seen) if not loaded_by(JUDGED_VEREIN_FIELDS, path)] == []

    def test_the_answer_reads_nothing_of_the_clubs_its_projection_leaves_out(self):
        """The fixture it reads whole, a proposal being judged as the stored fixture on a new date."""

        vereine_seen: set[str] = set()
        situation = AnsetzungState(
            spiel=spiel(), vereine=[Recorded(verein(TEAM1, austritt="2027-06-01"), vereine_seen), Recorded(verein(TEAM2), vereine_seen)]
        )

        assert find_unanswerable_refusal(spielbestaetigung_raw=row(), ansetzung_state=situation, now=NOW) is None

        assert "austritt.date" in vereine_seen
        assert [path for path in sorted(vereine_seen) if not loaded_by(JUDGED_VEREIN_FIELDS, path)] == []


class TestTheProposalIsTheSpielOnItsNewDate:
    @pytest.mark.parametrize(
        "stored_raw",
        [
            # Played before the hourly pass closed the decline, the shoot-out is the one field the plain fixture leaves null.
            pytest.param(
                spiel(
                    saison_phase="achtelfinale",
                    team1={"team_id": TEAM1, "name": "Adler", "shorthand": "ADX", "tore": 1},
                    team2={"team_id": TEAM2, "name": "Biber", "shorthand": "BIX", "tore": 1},
                    ergebnis="1:1",
                    elfmeterschiessen={"team1": 4, "team2": 3},
                ),
                id="a knockout decided on penalties",
            ),
        ],
    )
    def test_only_the_day_and_the_hour_move(self, stored_raw: dict[str, Any]):
        """Every field the save writes is kept but the slot.

        A field dropped is a claim the judges weigh that the move does not make, and the adoption, saving this payload,
        would erase it, the note among them.
        """

        stored = FLSpiel.model_validate(stored_raw)
        proposed = proposal_payload(stored, FLSpielbestaetigungAppointment(date="2027-05-15", time="17:00:00"))
        kept = set(SPIEL_PATCH_WRITTEN_FIELDS - {"date", "time"})

        assert (proposed.date, proposed.time) == ("2027-05-15", "17:00:00")
        assert proposed.model_dump(include=kept) == stored.model_dump(include=kept)
        assert proposed.version == stored.version


@pytest.mark.parametrize(
    ("model", "body", "refused"),
    [
        (
            FLSpielbestaetigungTeamAnswerPayload,
            {"answer": "declined", "vorschlag": None, "reason": None},
            ("vorschlag", "decline_without_proposal"),
        ),
        (
            FLSpielbestaetigungSchiedsrichterAnswerPayload,
            {"answer": "declined", "reason": None},
            ("reason", "decline_without_reason"),
        ),
    ],
    ids=[
        "club-decline-without-date",
        "referee-decline-without-reason",
    ],
)
def test_an_answers_shape_rule_is_refused_on_the_box_it_names(model: type[BaseModel], body: Mapping[str, Any], refused: tuple[str, str]):
    """Each rule is the project's own validator, reached by a stale page or a scripted client: a decline without a date sits in no queue.

    At the body root, or as a bare `ValueError`, the page can place the refusal on no box and words no reason.
    """

    with pytest.raises(ValidationError) as failure:
        model.model_validate(body)

    assert [(error["loc"], error["type"]) for error in failure.value.errors()] == [((refused[0],), refused[1])]


# `spiel()`'s kick-off, on the zone the request's clock reads, as the report's own rule converts it.
KICK_OFF = clock.german_instant(DATE, spiel()["time"]).astimezone(clock.GERMANY)


class TestARefereeAnswersUntilTheKickOff:
    """The Einteilung names no deadline, so the kick-off alone ends a referee's answer: the report is theirs from then."""

    def test_a_minute_before_it_the_answer_is_taken_and_from_it_refused(self):
        referees = row(party={"kind": "schiedsrichter", "schiedsrichter_id": SCHIEDSRICHTER})

        before, at = (
            find_unanswerable_refusal(spielbestaetigung_raw=referees, ansetzung_state=ansetzung_state(), now=now)
            for now in (KICK_OFF - timedelta(minutes=1), KICK_OFF)
        )

        assert before is None
        assert at is not None and at.error_code == Code.ANSETZUNG_DEADLINE_PAST

    def test_a_minute_before_it_the_booking_reads_open_and_from_it_lapsed(self):
        """Read by the day instead, the referee's list would offer „Zusagen“ and „Ablehnen“ until midnight beside the report it owes."""

        referees = row(party={"kind": "schiedsrichter", "schiedsrichter_id": SCHIEDSRICHTER})

        before, at = (
            state_of(spielbestaetigung_raw=referees, ansetzung_state=ansetzung_state(), now=now, vorschlag_open=None)
            for now in (KICK_OFF - timedelta(minutes=1), KICK_OFF)
        )

        assert (before, at) == ("valid", "expired")


REFEREES = {"party": {"kind": "schiedsrichter", "schiedsrichter_id": SCHIEDSRICHTER}}
# The day after the clubs' deadline, the fixture still to come.
PAST_THE_DEADLINE = datetime(2027, 5, 8, 12, tzinfo=clock.GERMANY)


class TestTheDayARowLapsed:
    """The day a page dates a lapse by: never a deadline that binds nobody, nor a row that ended without lapsing."""

    @pytest.mark.parametrize(
        ("fields", "situation", "now", "lapsed"),
        [
            pytest.param({}, {}, PAST_THE_DEADLINE, DEADLINE, id="a club past its deadline"),
            pytest.param({}, {}, NOW, None, id="a club before its deadline"),
            pytest.param({}, {}, KICK_OFF, DEADLINE, id="a club at the kick-off"),
            # The referee answers until the kick-off, whatever the clubs' deadline.
            pytest.param(REFEREES, {}, PAST_THE_DEADLINE, None, id="a referee past the clubs' deadline"),
            pytest.param(REFEREES, {}, KICK_OFF, DATE, id="a referee at the kick-off"),
            # Ended by an exit before the deadline it would otherwise show as the day.
            pytest.param({}, {"austritt": "2027-05-01"}, PAST_THE_DEADLINE, None, id="a club out by the day"),
            pytest.param({"closed": {"reason": "austritt"}}, {}, PAST_THE_DEADLINE, None, id="a row closed by an exit"),
            pytest.param({"closed": {"reason": "spiel_decided"}}, {}, KICK_OFF, None, id="a row closed by a decision"),
            pytest.param({"answer": {"kind": "agreed", "vorschlag": None}}, {}, PAST_THE_DEADLINE, None, id="a club that answered"),
        ],
    )
    def test_only_a_lapse_is_dated(self, fields: dict[str, Any], situation: dict[str, Any], now: datetime, lapsed: str | None):
        raw = row(**fields)
        reason = reason_of(spielbestaetigung_raw=raw, ansetzung_state=ansetzung_state(**situation), now=now)

        assert lapsed_on(spielbestaetigung_raw=raw, reason=reason, now=now) == lapsed

    def test_a_referee_is_due_by_the_slot_and_a_club_by_its_deadline(self):
        assert (due_by_of(row(**REFEREES)), due_by_of(row())) == (DATE, DEADLINE)


AGREED = {"kind": "agreed", "at": "2027-05-02", "by": {"kind": "kontakt", "rolle": "trainer"}, "vorschlag": None, "reason": None}
DECLINED = {
    "kind": "declined",
    "at": "2027-05-02",
    "by": {"kind": "kontakt", "rolle": "trainer"},
    "vorschlag": {"date": "2027-05-15", "time": "17:00:00"},
    "reason": None,
}
# The fixture a week on: every row about `spiel()`'s slot speaks for one it has left.
MOVED = {"spiel_overrides": {"date": "2027-05-21"}}
RETIMED = {"spiel_overrides": {"time": "18:45:00", "ergebnis": "2:1"}}
PLAYED = {"spiel_overrides": {"ergebnis": "2:1"}}
# A discard the pass closed again, as its close writes it.
ENDED_AT_KICK_OFF = {"reason": "spiel_past", "discarded": True}
ENDED_BY_A_DECISION = {"reason": "spiel_decided", "discarded": True}


class TestAClosedRowReadsAsThePublicFixtureCountsIt:
    """The match editor reads every closed row: one reading otherwise than the fixture's confirmation tells the league two things."""

    @pytest.mark.parametrize(
        ("fields", "situation", "state"),
        [
            # Closed at its kick-off, the agreement binds the slot it answered, and no pass asks about the new one yet.
            pytest.param({"answer": AGREED, "closed": {"reason": "spiel_past"}}, {}, "agreed", id="an agreement at its slot"),
            pytest.param({"answer": AGREED, "closed": {"reason": "spiel_past"}}, MOVED, "invalid", id="an agreement the match left"),
            # The league kept the date: the fixture counts the club as agreed, and its mail told it the date stands.
            pytest.param({"answer": DECLINED, "closed": {"reason": "discarded"}}, {}, "agreed", id="a discard at its slot"),
            pytest.param({"answer": DECLINED, "closed": {"reason": "discarded"}}, MOVED, "invalid", id="a discard the match left"),
            # The kick-off's time corrected as the result is entered: the agreement was to the match that was played.
            pytest.param({"answer": AGREED, "closed": {"reason": "spiel_past"}}, RETIMED, "agreed", id="an agreement whose time is corrected"),
            # Ended where the agreement beside it ends, the discard still reads as the agreement the fixture counted.
            pytest.param({"answer": DECLINED, "closed": ENDED_AT_KICK_OFF}, {}, "agreed", id="a discard ended at its kick-off"),
            pytest.param({"answer": DECLINED, "closed": ENDED_AT_KICK_OFF}, MOVED, "invalid", id="a discard ended about a slot left"),
            pytest.param({"answer": DECLINED, "closed": ENDED_BY_A_DECISION}, PLAYED, "agreed", id="a discard ended by a decision"),
        ],
    )
    def test_each_reads_by_the_slot_it_answered(self, fields: dict[str, Any], situation: dict[str, Any], state: str):
        assert (
            state_of(spielbestaetigung_raw=row(**fields), ansetzung_state=ansetzung_state(**situation), now=NOW, vorschlag_open=None) == state
        )
