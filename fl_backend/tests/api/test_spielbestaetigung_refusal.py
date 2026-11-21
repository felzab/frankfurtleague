from collections.abc import Iterator, Mapping
from datetime import datetime, timedelta
from typing import Any

import pytest
from bson import ObjectId
from pydantic import BaseModel, ValidationError

from app.api.outbox.schemas import FLSpielMailAppointment
from app.api.spielbestaetigungen.crud import JUDGED_JUNCTION_FIELDS, JUDGED_SPIEL_FIELDS, OWN_ROW_FIELDS
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAppointment,
    FLSpielbestaetigungSchiedsrichterAnswerPayload,
    FLSpielbestaetigungTeamAnswerPayload,
)
from app.api.spielbestaetigungen.services import (
    AnsetzungState,
    austritt_recipients_of,
    austritte_of,
    compose_ansetzung,
    due_by_of,
    find_enter_refusal,
    find_unanswerable_refusal,
    holds_an_open_proposal,
    lapsed_on,
    moved_notice_of,
    proposal_payload,
    reason_of,
    schiedsrichter_state_of,
    spiel_mail_ansetzung_from_spiel,
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
        "spielort": {"spielort_id": SPIELORT, "name": "Halle Ost", "maps_query": "Halle Ost, Frankfurt", "mietpreis": 40},
        "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER, "name": REFEREE, "payment": 20},
        "team1": {"team_id": TEAM1, "name": "Adler", "shorthand": "ADX", "tore": None},
        "team2": {"team_id": TEAM2, "name": "Biber", "shorthand": "BIX", "tore": None},
        "team1_quelle": None,
        "team2_quelle": None,
        "ergebnis": None,
        "elfmeterschiessen": None,
        "sonderereignis": None,
        "note": "Flutlicht",
        "version": 0,
        **overrides,
    }


def junction(team_id: ObjectId, *, austritt: str | None = None) -> dict[str, Any]:
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
    return AnsetzungState(spiel=spiel(**(spiel_overrides or {})), junctions=[junction(TEAM1, austritt=austritt), junction(TEAM2)])


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
    """An open row in time on a decided fixture, which the close's judgement alone refuses.

    An answered row, a move and a lapsed deadline each have a route case.
    """

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

        assert refusal is not None and refusal.error_code == Code.ANSETZUNG_UNANSWERABLE


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
        junctions_seen: set[str] = set()
        # Undecided, unmoved and open, so every judge reads to its end; the exit after the fixture's day, so its date is read.
        situation = AnsetzungState(
            spiel=Recorded(spiel(), spiel_seen),
            junctions=[Recorded(junction(TEAM1, austritt="2027-06-01"), junctions_seen), Recorded(junction(TEAM2), junctions_seen)],
        )

        assert state_of(spielbestaetigung_raw=row(), ansetzung_state=situation, now=NOW, vorschlag_open=None) == "valid"
        view_ansetzung_of(situation.spiel)

        # The premise: `decision_of` read the fixture to its last test.
        assert {"ergebnis", "sonderereignis", "team2.tore", "austritt.date"} <= spiel_seen | junctions_seen
        assert [path for path in sorted(spiel_seen) if not loaded_by(JUDGED_SPIEL_FIELDS, path)] == []
        assert [path for path in sorted(junctions_seen) if not loaded_by(JUDGED_JUNCTION_FIELDS, path)] == []

    def test_the_answer_reads_nothing_of_the_teams_its_projection_leaves_out(self):
        """The fixture it reads whole, a proposal being judged as the stored fixture on a new date."""

        junctions_seen: set[str] = set()
        situation = AnsetzungState(
            spiel=spiel(),
            junctions=[Recorded(junction(TEAM1, austritt="2027-06-01"), junctions_seen), Recorded(junction(TEAM2), junctions_seen)],
        )

        assert find_unanswerable_refusal(spielbestaetigung_raw=row(), ansetzung_state=situation, now=NOW) is None

        assert "austritt.date" in junctions_seen
        assert [path for path in sorted(junctions_seen) if not loaded_by(JUDGED_JUNCTION_FIELDS, path)] == []

    @pytest.mark.parametrize("answer", [None, {"kind": "agreed", "at": "2027-05-02T10:00:00+00:00"}], ids=["open", "agreed"])
    def test_a_referees_list_and_answer_read_nothing_of_the_row_their_projection_leaves_out(self, answer: dict[str, Any] | None):
        """The referee's own list and answer read the row through `OWN_ROW_FIELDS`, which keeps of the answer its kind alone."""

        row_seen: set[str] = set()
        referees_row = row(party={"kind": "schiedsrichter", "schiedsrichter_id": SCHIEDSRICHTER}, answer=answer)
        recorded = Recorded(referees_row, row_seen)

        schiedsrichter_state_of(spielbestaetigung_raw=recorded, ansetzung_state=ansetzung_state(), now=NOW)
        find_unanswerable_refusal(spielbestaetigung_raw=recorded, ansetzung_state=ansetzung_state(), now=NOW)

        # The premise: the judges read the row's party, and an answered row's answer.
        assert {"party.kind", "closed"} | (set() if answer is None else {"answer.kind"}) <= row_seen
        assert [path for path in sorted(row_seen) if not loaded_by(OWN_ROW_FIELDS, path)] == []


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
        assert at is not None and at.error_code == Code.ANSETZUNG_UNANSWERABLE

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
ON_THE_DEADLINE = datetime(2027, 5, 7, 23, 59, tzinfo=clock.GERMANY)


# A no-show entered ten minutes after the kick-off, the hourly pass not yet run since.
AFTER_THE_KICK_OFF = KICK_OFF + timedelta(minutes=10)
DECIDED = {"spiel_overrides": {"sonderereignis": "nichtantreten_team2", "ergebnis": "3:0"}}


class TestTheDayARowLapsed:
    """The day a page dates a lapse by: never a deadline that binds nobody, nor a row that ended before its answer was due.

    The same whether the pass closed the row first or the administrator's act ended it first.
    """

    @pytest.mark.parametrize(
        ("fields", "situation", "now", "lapsed"),
        [
            pytest.param({}, {}, PAST_THE_DEADLINE, DEADLINE, id="a club past its deadline"),
            pytest.param({}, {}, NOW, None, id="a club before its deadline"),
            # An answer is taken on its deadline's own day.
            pytest.param({}, {}, ON_THE_DEADLINE, None, id="a club on its deadline day"),
            pytest.param({}, {}, KICK_OFF, DEADLINE, id="a club at the kick-off"),
            # The referee answers until the kick-off, whatever the clubs' deadline.
            pytest.param(REFEREES, {}, PAST_THE_DEADLINE, None, id="a referee past the clubs' deadline"),
            pytest.param(REFEREES, {}, KICK_OFF, DATE, id="a referee at the kick-off"),
            # An exit ends the row from its own day: before the deadline nothing lapsed, after it a lapse did.
            pytest.param({}, {"austritt": "2027-05-01"}, PAST_THE_DEADLINE, None, id="a club out before its deadline"),
            pytest.param({}, {"austritt": "2027-05-10"}, PAST_THE_DEADLINE, DEADLINE, id="a club out after its deadline"),
            pytest.param({"closed": {"reason": "austritt"}}, {"austritt": "2027-05-10"}, KICK_OFF, DEADLINE, id="a row closed by a late exit"),
            # The pass closed the row at the kick-off before the exit was entered: the exit still ended it first.
            pytest.param(
                {**REFEREES, "closed": {"reason": "spiel_past"}}, {"austritt": DATE}, KICK_OFF, None, id="a referee whose club left by the day"
            ),
            # A decision entered before the pass reads as the pass's own close would have dated it.
            pytest.param({}, DECIDED, AFTER_THE_KICK_OFF, DEADLINE, id="a club, the decision entered first"),
            pytest.param({"closed": {"reason": "spiel_decided"}}, DECIDED, AFTER_THE_KICK_OFF, DEADLINE, id="a row closed by a decision"),
            pytest.param({"closed": {"reason": "spiel_past"}}, DECIDED, AFTER_THE_KICK_OFF, DEADLINE, id="a club, the pass first"),
            pytest.param(REFEREES, DECIDED, AFTER_THE_KICK_OFF, DATE, id="a referee, the decision entered first"),
            # Brought forward and played before the deadline the row named.
            pytest.param(
                {"closed": {"reason": "spiel_decided"}},
                {"spiel_overrides": {**DECIDED["spiel_overrides"], "date": "2027-05-05"}},
                PAST_THE_DEADLINE,
                None,
                id="a decision before the deadline",
            ),
            pytest.param({"closed": {"reason": "cancelled"}}, {}, PAST_THE_DEADLINE, None, id="a row a call-off closed"),
            pytest.param({"answer": {"kind": "agreed", "vorschlag": None}}, {}, PAST_THE_DEADLINE, None, id="a club that answered"),
        ],
    )
    def test_only_a_lapse_is_dated(self, fields: dict[str, Any], situation: dict[str, Any], now: datetime, lapsed: str | None):
        raw, state = row(**fields), ansetzung_state(**situation)
        reason = reason_of(spielbestaetigung_raw=raw, ansetzung_state=state, now=now)

        assert (
            lapsed_on(spielbestaetigung_raw=raw, reason=reason, spiel=state.spiel, austritte=austritte_of(state.junctions), now=now) == lapsed
        )

    def test_a_referee_is_due_by_the_slot_and_a_team_by_its_deadline(self):
        assert (due_by_of(row(**REFEREES)), due_by_of(row())) == (DATE, DEADLINE)


AGREED = {"kind": "agreed", "at": "2027-05-02", "by": {"kind": "kontakt", "seat": "trainer"}, "vorschlag": None, "reason": None}
DECLINED = {
    "kind": "declined",
    "at": "2027-05-02",
    "by": {"kind": "kontakt", "seat": "trainer"},
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
            # Closed at its kick-off with no judgement stored: the agreement binds the slot it answered, and no pass asks
            # about the new one yet.
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
            # The result entered with a corrected kick-off before the pass ran: judged as the pass's close will store it.
            pytest.param({"answer": AGREED}, RETIMED, "agreed", id="an agreement retimed as it is decided, the pass to come"),
            # Ended by the pass, a row reads by what its close stored, whatever the fixture was corrected to since.
            pytest.param(
                {"answer": DECLINED, "closed": {**ENDED_AT_KICK_OFF, "matched": True}}, RETIMED, "agreed", id="a discard retimed once ended"
            ),
            pytest.param(
                {"answer": DECLINED, "closed": {**ENDED_AT_KICK_OFF, "matched": False}},
                {},
                "invalid",
                id="a discard ended about a slot left, moved back",
            ),
            pytest.param(
                {"answer": AGREED, "closed": {"reason": "spiel_decided", "matched": True}},
                MOVED,
                "agreed",
                id="an agreement redated once ended",
            ),
        ],
    )
    def test_each_reads_by_the_slot_it_answered(self, fields: dict[str, Any], situation: dict[str, Any], state: str):
        assert (
            state_of(spielbestaetigung_raw=row(**fields), ansetzung_state=ansetzung_state(**situation), now=NOW, vorschlag_open=None) == state
        )


class TestATeamAnswersUntilItsDeadline:
    def test_on_its_deadline_the_answer_is_taken_and_the_day_after_refused(self):
        on, after = (
            find_unanswerable_refusal(spielbestaetigung_raw=row(), ansetzung_state=ansetzung_state(), now=now)
            for now in (ON_THE_DEADLINE, PAST_THE_DEADLINE)
        )

        assert on is None
        assert after is not None and after.error_code == Code.ANSETZUNG_UNANSWERABLE


# The two ways a save or an exit overtakes a row the pass has yet to shut: the match called off, a club gone by its day.
CALLED_OFF = {"spiel_overrides": {"sonderereignis": "ausgefallen"}}
GONE_BY_ITS_DAY = {"austritt": DATE}


class TestTheAdministratorSettlesAnOpenRowAlone:
    """Recorded on any other row, the league's record would hold an agreement nobody can still give."""

    @pytest.mark.parametrize(
        ("fields", "situation", "now", "refused"),
        [
            pytest.param({}, {}, NOW, False, id="an open row"),
            # The triage queue lists such a row for the administrator to settle.
            pytest.param({}, {}, PAST_THE_DEADLINE, False, id="an open row past its deadline"),
            pytest.param({"answer": AGREED}, {}, NOW, True, id="an answered row"),
            pytest.param({"closed": {"reason": "cancelled"}}, {}, NOW, True, id="a closed row"),
            pytest.param({}, CALLED_OFF, NOW, True, id="a row the pass would close for a call-off"),
            pytest.param({}, GONE_BY_ITS_DAY, NOW, True, id="a row the pass would close for a club gone by its day"),
        ],
    )
    def test_the_settle(self, fields: dict[str, Any], situation: dict[str, Any], now: datetime, refused: bool):
        refusal = find_enter_refusal(spielbestaetigung_raw=row(**fields), ansetzung_state=ansetzung_state(**situation), now=now)

        assert (None if refusal is None else refusal.error_code) == (Code.ANSETZUNG_NOT_ACTIONABLE if refused else None)


class TestADiscardAndAnAdoptionActOnAnOpenProposalAlone:
    """Acted on any other row, a club would be told the date stands, or every party asked about a date, for a question gone."""

    @pytest.mark.parametrize(
        ("fields", "situation", "holds"),
        [
            pytest.param({"answer": DECLINED}, {}, True, id="a club's decline with a proposal"),
            pytest.param({}, {}, False, id="an unanswered row"),
            pytest.param({"answer": AGREED}, {}, False, id="an agreement"),
            pytest.param({"answer": {**DECLINED, "vorschlag": None}}, {}, False, id="a decline proposing nothing"),
            pytest.param({**REFEREES, "answer": DECLINED}, {}, False, id="a referee's decline"),
            pytest.param({"answer": DECLINED, "closed": {"reason": "discarded"}}, {}, False, id="a decline already discarded"),
            pytest.param({"answer": DECLINED}, MOVED, False, id="a decline about a slot the fixture left"),
            pytest.param({"answer": DECLINED}, CALLED_OFF, False, id="a decline the pass would close for a call-off"),
            pytest.param({"answer": DECLINED}, GONE_BY_ITS_DAY, False, id="a decline the pass would close for a club gone by its day"),
        ],
    )
    def test_the_proposal_is_open(self, fields: dict[str, Any], situation: dict[str, Any], holds: bool):
        assert holds_an_open_proposal(spielbestaetigung_raw=row(**fields), ansetzung_state=ansetzung_state(**situation), now=NOW) is holds


# --- What a move's notice says, and whom a club's exit mails.


def test_a_move_s_notice_names_the_ground_the_fixture_moved_to():
    """Unnamed, a ground changed at the same hour reads „Bisher“ and „Neu“ alike, and the parties go to the old ground."""

    ansetzung = spiel_mail_ansetzung_from_spiel(spiel())

    assert ansetzung is not None and ansetzung.spielort == "Halle Ost"


def test_a_move_off_its_ground_tells_the_parties_of_no_ground():
    """A ground read off a fixture holding none raises inside the pass, which then tells nobody the fixture moved."""

    appointment = FLSpielMailAppointment(team1="Adler", team2="Biber", date=DATE, time="18:30:00")

    notice = moved_notice_of(
        party_kind="team", appointment=appointment, moved_to=spiel_mail_ansetzung_from_spiel(spiel(spielort=None)), stays=True
    )

    assert notice.moved_to is not None and notice.moved_to.spielort is None


# Read ahead of `a_fixture`'s day, so an exit then reaches it.
EXIT_READ = datetime(2026, 4, 20, 12, tzinfo=clock.GERMANY)
CONFIRMED_SEAT = {"trainer": {"email": "theo@example.com", "einwilligung": {"confirmed_at": "2026-03-01"}}}


def a_fixture(**fields: Any) -> dict[str, Any]:
    """The departed club `TEAM1` against `TEAM2`, booked to `SCHIEDSRICHTER`, still to come at `EXIT_READ`, as stored."""

    return {
        "_id": ObjectId(),
        "date": "2026-05-02",
        "time": "10:00:00",
        "team1": {"team_id": TEAM1, "tore": None},
        "team2": {"team_id": TEAM2, "tore": None},
        "spielort": {"spielort_id": SPIELORT},
        "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER},
        "ergebnis": None,
        "sonderereignis": None,
        **fields,
    }


@pytest.mark.parametrize(
    ("spiel", "kontakte", "asked_at", "named"),
    [
        pytest.param(a_fixture(), CONFIRMED_SEAT, "2026-04-10", ["team", "schiedsrichter"], id="a seated opponent and an asked referee"),
        pytest.param(a_fixture(), {}, "2026-04-10", ["schiedsrichter"], id="an opponent no confirmed seat reaches"),
        pytest.param(a_fixture(), CONFIRMED_SEAT, None, ["team"], id="a referee booked and never asked"),
        pytest.param(a_fixture(ergebnis="1:0"), CONFIRMED_SEAT, "2026-04-10", [], id="a fixture decided"),
        # One act tells both alike, about a slot still to come: a match kicked off unrecorded is told to nobody.
        pytest.param(a_fixture(date="2026-04-18"), CONFIRMED_SEAT, "2026-04-10", [], id="a fixture kicked off, its result not yet in"),
    ],
)
def test_an_exit_names_whom_its_write_and_the_pass_mail(spiel: dict[str, Any], kontakte: Any, asked_at: str | None, named: list[str]):
    """Named by fixed words, the exit's question promised a mail to a club no seat reaches and a referee nobody asked."""

    junctions = {
        TEAM1: {"team_id": TEAM1, "name": "Adler", "kontakte": CONFIRMED_SEAT, "austritt": None},
        TEAM2: {"team_id": TEAM2, "name": "Biber", "kontakte": kontakte, "austritt": None},
    }
    referee_row = {
        "saison_id": "2026",
        "spiel_id": spiel["_id"],
        "party": {"kind": "schiedsrichter", "schiedsrichter_id": SCHIEDSRICHTER},
        "ansetzung": compose_ansetzung(spiel),
        "asked_at": asked_at,
        "closed": None,
    }

    reached = austritt_recipients_of(team_id=TEAM1, spiele=[spiel], junctions=junctions, rows=[referee_row], now=EXIT_READ)

    assert [(day, party["kind"]) for day, party in reached] == [(spiel["date"], kind) for kind in named]
