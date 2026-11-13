from datetime import date, datetime, time, timedelta
from typing import Any

import pytest
from bson import ObjectId

from app.api.bewerbungen.services import days_after
from app.api.spielbestaetigungen.services import (
    AnsetzungState,
    compose_ansetzung,
    deadline_of,
    notice_owed,
    parties_told_of_the_change,
    reason_to_close,
    reason_to_end,
    request_is_due,
    team_state_of,
)
from app.core import clock

TODAY = "2026-04-01"
ALPHA = ObjectId("6890a1b2c3d4e5f607760001")
BETA = ObjectId("6890a1b2c3d4e5f607760002")
GAMMA = ObjectId("6890a1b2c3d4e5f607760003")
SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f6077600c1")


def noon(day: str) -> datetime:
    """Midday of a German day, on the zone the request's clock reads."""

    return datetime.combine(date.fromisoformat(day), time(12), tzinfo=clock.GERMANY)


NOW = noon(TODAY)


def spiel(**overrides: Any) -> dict[str, Any]:
    """A fixture every condition of the mint holds for, a week out, that each case moves one thing of."""

    return {
        "_id": ObjectId("6890a1b2c3d4e5f6077600d1"),
        "date": days_after(day=TODAY, days=7),
        "time": "18:00:00",
        "spielort": {"spielort_id": ObjectId("6890a1b2c3d4e5f6077600b1"), "mietpreis": 80},
        "team1": {"team_id": ALPHA, "tore": None},
        "team2": {"team_id": BETA, "tore": None},
        "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER, "payment": 20},
        "ergebnis": None,
        "elfmeterschiessen": None,
        "sonderereignis": None,
        **overrides,
    }


def row(party: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    """A row about `spiel()`'s Ansetzung as it stands."""

    return {"party": party, "ansetzung": compose_ansetzung(spiel()), **overrides}


TEAM = {"kind": "team", "team_id": ALPHA}
REFEREE = {"kind": "schiedsrichter", "schiedsrichter_id": SCHIEDSRICHTER}


class TestTheDeadline:
    def test_a_week_before_the_spiel(self):
        assert deadline_of(date=days_after(day=TODAY, days=10), today=TODAY) == days_after(day=TODAY, days=3)

    def test_today_inside_the_notice_period(self):
        assert deadline_of(date=days_after(day=TODAY, days=3), today=TODAY) == TODAY


class TestTheMintAsksInsideItsWindowAlone:
    def test_a_spiel_today_is_not_asked(self):
        """The floor's edge, a day and not the kick-off: a match today is asked of nobody, though it kicks off hours from now.

        A request asks ahead of the day, its deadline lying before it.
        """

        assert request_is_due(spiel=spiel(date=TODAY), austritte={}, now=NOW) is False

    def test_a_club_gone_after_the_spiel_is_still_asked(self):
        """Its exit the day after the fixture, the club still plays it: only an exit by the fixture's day shuts the row."""

        assert request_is_due(spiel=spiel(), austritte={ALPHA: days_after(day=spiel()["date"], days=1)}, now=NOW) is True


class TestWhyARowCloses:
    @pytest.mark.parametrize(
        ("party", "overrides", "austritte", "reason"),
        [
            pytest.param(TEAM, {"time": "19:00:00"}, {}, "ansetzung_changed", id="a new hour"),
            pytest.param(TEAM, {"ergebnis": "1:0", "time": "19:00:00"}, {}, "spiel_decided", id="decided and moved"),
            pytest.param(TEAM, {"sonderereignis": "ausgefallen"}, {}, "cancelled", id="called off"),
            pytest.param(TEAM, {"sonderereignis": "nichtantreten_team2"}, {}, "cancelled", id="a no-show entered before the day"),
            pytest.param(TEAM, {"sonderereignis": "nichtantreten_team2", "date": TODAY}, {}, "spiel_decided", id="a no-show on the day"),
            pytest.param(TEAM, {"time": "19:00:00"}, {BETA: TODAY}, "austritt", id="the opponent gone, ahead of the move"),
            pytest.param(REFEREE, {"schiedsrichter": None}, {}, "schiedsrichter_switched", id="the referee taken off"),
            pytest.param(
                REFEREE, {"schiedsrichter": None, "time": "19:00:00"}, {}, "schiedsrichter_switched", id="taken off, ahead of the move"
            ),
            pytest.param(TEAM, {"schiedsrichter": None}, {}, None, id="a club's row keeps its referee change"),
            # A call-off's notice promises its party the next request, which a party taken off never receives.
            pytest.param(
                REFEREE,
                {"schiedsrichter": None, "sonderereignis": "ausgefallen"},
                {},
                "schiedsrichter_switched",
                id="the referee taken off, ahead of the call-off",
            ),
            pytest.param(
                TEAM,
                {"team1": {"team_id": GAMMA, "tore": None}, "sonderereignis": "ausgefallen"},
                {},
                "ansetzung_changed",
                id="the club taken off, ahead of the call-off",
            ),
            # Told it no longer plays or officiates the match, never that it was decided, which reaches nobody.
            pytest.param(
                REFEREE,
                {"schiedsrichter": None, "team1": {"team_id": ALPHA, "tore": 2}, "team2": {"team_id": BETA, "tore": 1}},
                {},
                "schiedsrichter_switched",
                id="the referee taken off, ahead of the decision",
            ),
            pytest.param(
                TEAM,
                {"team1": {"team_id": GAMMA, "tore": 2}, "team2": {"team_id": BETA, "tore": 1}},
                {},
                "ansetzung_changed",
                id="the club taken off, ahead of the decision",
            ),
            # The early no-show's call-off promises a new Einteilung, which a referee taken off never receives.
            pytest.param(
                REFEREE,
                {"schiedsrichter": None, "sonderereignis": "nichtantreten_team1"},
                {},
                "schiedsrichter_switched",
                id="the referee taken off, ahead of a no-show before the day",
            ),
        ],
    )
    def test_the_reason(self, party: dict[str, Any], overrides: dict[str, Any], austritte: dict[Any, str], reason: str | None):
        assert reason_to_close(row=row(party), spiel=spiel(**overrides), austritte=austritte, now=NOW) == reason


# A club's decline the administrator discarded: its row closed, the decline its answer to the Ansetzung.
DISCARDED = row(TEAM, answer={"kind": "declined"}, closed={"reason": "discarded"})

THE_DAY_AFTER = noon(days_after(day=spiel()["date"], days=1))


class TestADiscardEndsWhereAnAgreementWouldEnd:
    """Kept, the discard would count as its club's agreement in the public verdict where an agreement no longer counts."""

    @pytest.mark.parametrize(
        ("overrides", "now", "reason"),
        [
            pytest.param({"team1": {"team_id": ALPHA, "tore": 2}}, NOW, "spiel_decided", id="decided"),
            pytest.param({}, THE_DAY_AFTER, "spiel_past", id="its day gone by"),
        ],
    )
    def test_the_close_ends_it(self, overrides: dict[str, Any], now: datetime, reason: str):
        assert reason_to_end(row=DISCARDED, spiel=spiel(**overrides), austritte={}, now=now) == reason

    def test_one_about_a_slot_the_fixture_left_ends_once_its_own_day_has_passed(self):
        """The move keeps it, the club's answer to that Ansetzung; kept past its day it would be read by every pass for good."""

        moved = spiel(time="19:00:00")

        assert [reason_to_end(row=DISCARDED, spiel=moved, austritte={}, now=now) for now in (NOW, THE_DAY_AFTER)] == [None, "spiel_past"]


# `spiel()`'s kick-off, on the zone the request's clock reads, as the report's own rule converts it.
KICK_OFF = clock.german_instant(spiel()["date"], spiel()["time"]).astimezone(clock.GERMANY)

A_MINUTE_BEFORE_AND_AT_THE_KICK_OFF = (KICK_OFF - timedelta(minutes=1), KICK_OFF)


class TestANoticeIsAboutASlotStillToCome:
    """Judged by the day instead, a party would be told of a match already under way, or not, by the hour the next pass ran."""

    def test_a_call_off_entered_after_the_kick_off_tells_nobody(self):
        asked = row(TEAM, asked_at=TODAY)
        called_off = spiel(sonderereignis="ausgefallen")

        owed = [notice_owed(row=asked, reason="cancelled", spiel=called_off, now=now) for now in A_MINUTE_BEFORE_AND_AT_THE_KICK_OFF]

        assert owed == [True, False]

    @pytest.mark.parametrize(
        ("now", "moved_to"),
        [
            pytest.param(THE_DAY_AFTER, days_after(day=spiel()["date"], days=7), id="off a day gone by"),
            pytest.param(NOW, days_after(day=TODAY, days=-1), id="onto a day gone by"),
        ],
    )
    def test_a_move_is_told_while_either_day_is_to_come(self, now: datetime, moved_to: str):
        """Its slot left void and the fixture's asked afresh, a party is told of either while it still lies ahead."""

        asked = row(TEAM, asked_at=TODAY)

        assert notice_owed(row=asked, reason="ansetzung_changed", spiel=spiel(date=moved_to), now=now) is True

    def test_a_closing_other_than_a_move_is_about_the_slot_its_row_asked(self):
        """The fixture moved a week on and its referee taken off, both after the kick-off: the referee is told nothing.

        Only a move's notice names the slot moved to. The referee change ranks ahead of the move, so its notice would be
        about the slot gone by, and the referee was never asked about the new one.
        """

        asked = row(REFEREE, asked_at=TODAY)
        moved_and_taken_off = spiel(schiedsrichter=None, date=days_after(day=spiel()["date"], days=7))

        # The premise: the close shuts the row for the referee change, not the move.
        assert reason_to_close(row=asked, spiel=moved_and_taken_off, austritte={}, now=KICK_OFF) == "schiedsrichter_switched"
        assert notice_owed(row=asked, reason="schiedsrichter_switched", spiel=moved_and_taken_off, now=KICK_OFF) is False


class TestASaveNamesOnlyThoseItsOwnChangeTells:
    def test_a_second_move_before_the_pass_names_nobody_the_first_already_tells(self):
        """A row the first move already closes is that move's mail: named again, the editor's question would promise a second one.

        The pass sends one notice per row, at the close, whichever save left the fixture where it stands.
        """

        asked = [row(TEAM, asked_at=TODAY)]
        first, second = spiel(time="19:00:00"), spiel(time="20:00:00")

        told = [
            parties_told_of_the_change(rows=asked, stored=stored, changed=changed, austritte={}, now=NOW)
            for stored, changed in ((spiel(), first), (first, second))
        ]

        assert told == [[TEAM], []]


class TestATeamsPagesDropARowItsMatchDecided:
    @pytest.mark.parametrize(
        "decided",
        [pytest.param({"ergebnis": "2:1"}, id="a result"), pytest.param({"sonderereignis": "nichtantreten_team2"}, id="a no-show")],
    )
    @pytest.mark.parametrize("answer", [pytest.param(None, id="unanswered"), pytest.param({"kind": "agreed"}, id="agreed")])
    def test_before_the_pass_closes_it(self, decided: dict[str, Any], answer: dict[str, Any] | None):
        """Kept until the hourly close, an unanswered row reads „Abgelaufen“ and „Die Liga entscheidet“ about a match decided."""

        unclosed = row(TEAM, deadline=TODAY, answer=answer, closed=None)
        state = AnsetzungState(spiel=spiel(**decided), vereine=[])

        assert (
            team_state_of(spielbestaetigung_raw=unclosed, ansetzung_state=state, now=KICK_OFF + timedelta(hours=2), vorschlag_open=None) is None
        )
