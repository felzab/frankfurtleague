from typing import Any

import pytest
from bson import ObjectId

from app.api.bewerbungen.services import days_after
from app.api.spielbestaetigungen.services import (
    compose_ansetzung,
    deadline_of,
    reason_to_close,
    request_is_due,
)

TODAY = "2026-04-01"
ALPHA = ObjectId("6890a1b2c3d4e5f607760001")
BETA = ObjectId("6890a1b2c3d4e5f607760002")
SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f6077600c1")
AFTER_THE_DAY = days_after(day=TODAY, days=8)


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
        """The floor's edge: both clubs and the referee would be asked to confirm a match already under way."""

        assert request_is_due(spiel=spiel(date=TODAY), austritte={}, today=TODAY) is False


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
        assert reason_to_close(row=row(party), spiel=spiel(**overrides), austritte=austritte, today=TODAY) == reason

    def test_an_answered_row_closes_as_an_open_one_does(self):
        """The close's reach is `closed: null` alone, so a kept agreement records why it stopped applying."""

        answered = row(TEAM, answer={"kind": "zugesagt"})

        assert reason_to_close(row=answered, spiel=spiel(time="19:00:00"), austritte={}, today=TODAY) == "ansetzung_changed"
        assert reason_to_close(row=answered, spiel=spiel(), austritte={}, today=AFTER_THE_DAY) == "spiel_past"
