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
    request_is_due,
    team_state_of,
)
from app.core import clock

TODAY = "2026-04-01"
ALPHA = ObjectId("6890a1b2c3d4e5f607760001")
BETA = ObjectId("6890a1b2c3d4e5f607760002")
SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f6077600c1")
AFTER_THE_DAY = days_after(day=TODAY, days=8)


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


class TestWhyARowCloses:
    @pytest.mark.parametrize(
        ("party", "overrides", "austritte", "reason"),
        [
            pytest.param(TEAM, {}, {}, None, id="nothing moved"),
            pytest.param(TEAM, {"time": "19:00:00"}, {}, "ansetzung_changed", id="a new hour"),
            pytest.param(TEAM, {"spielort": None}, {}, "ansetzung_changed", id="the ground gone"),
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
        ],
    )
    def test_the_reason(self, party: dict[str, Any], overrides: dict[str, Any], austritte: dict[Any, str], reason: str | None):
        assert reason_to_close(row=row(party), spiel=spiel(**overrides), austritte=austritte, now=NOW) == reason

    def test_an_answered_row_closes_as_an_open_one_does(self):
        """The close's reach is `closed: null` alone, so a kept agreement records why it stopped applying."""

        answered = row(TEAM, answer={"kind": "agreed"})

        assert reason_to_close(row=answered, spiel=spiel(time="19:00:00"), austritte={}, now=NOW) == "ansetzung_changed"
        assert reason_to_close(row=answered, spiel=spiel(), austritte={}, now=noon(AFTER_THE_DAY)) == "spiel_past"


# `spiel()`'s kick-off, on the zone the request's clock reads, as the report's own rule converts it.
KICK_OFF = clock.german_instant(spiel()["date"], spiel()["time"]).astimezone(clock.GERMANY)


class TestARowClosesAtItsKickOff:
    @pytest.mark.parametrize("party", [pytest.param(TEAM, id="a club's"), pytest.param(REFEREE, id="a referee's")])
    def test_open_a_minute_before_and_closed_from_it(self, party: dict[str, Any]):
        """Open until midnight instead, a referee's decline pressed after the match unbooks them from the match just played."""

        before, at = (
            reason_to_close(row=row(party), spiel=spiel(), austritte={}, now=now) for now in (KICK_OFF - timedelta(minutes=1), KICK_OFF)
        )

        assert (before, at) == (None, "spiel_past")


A_MINUTE_BEFORE_AND_AT_THE_KICK_OFF = (KICK_OFF - timedelta(minutes=1), KICK_OFF)


class TestANoticeIsAboutASlotStillToCome:
    """Judged by the day instead, a party would be told of a match already under way, or not, by the hour the next pass ran."""

    def test_a_call_off_entered_after_the_kick_off_tells_nobody(self):
        asked = row(TEAM, asked_at=TODAY)
        called_off = spiel(sonderereignis="ausgefallen")

        owed = [notice_owed(row=asked, reason="cancelled", spiel=called_off, now=now) for now in A_MINUTE_BEFORE_AND_AT_THE_KICK_OFF]

        assert owed == [True, False]

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
