from typing import Any

import pytest
from bson import ObjectId

from app.api.bewerbungen.services import days_after
from app.api.spielbestaetigungen.services import (
    anfrage_is_due,
    compose_ansetzung,
    compose_erinnerung_update,
    frist_of,
    grund_to_close,
    seats_link,
)
from app.api.spielbestaetigungen.system_router import CLOSES_PER_PASS, MINTS_PER_PASS, REMINDERS_PER_PASS
from app.core.middlewares import REQUEST_DEADLINE_S

TODAY = "2026-04-01"
ALPHA = ObjectId("6890a1b2c3d4e5f607760001")
BETA = ObjectId("6890a1b2c3d4e5f607760002")
SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f6077600c1")
AFTER_THE_DAY = days_after(day=TODAY, days=8)


def spiel(**overrides: Any) -> dict[str, Any]:
    """A fixture every condition of the mint holds for, a week out, that each case moves one thing of."""

    return {
        "_id": ObjectId("6890a1b2c3d4e5f6077600d1"),
        "datum": days_after(day=TODAY, days=7),
        "uhrzeit": "18:00:00",
        "ort": {"spielort_id": ObjectId("6890a1b2c3d4e5f6077600b1"), "name": "Sportpark", "maps_link": "Sportpark", "mietpreis": 80},
        "team1": {"team_id": ALPHA, "name": "Alpha", "shorthand": "ALX", "tore": None},
        "team2": {"team_id": BETA, "name": "Beta", "shorthand": "BEX", "tore": None},
        "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER, "name": "Pfiff", "payment": 20},
        "ergebnis": None,
        "elfmeterschiessen": None,
        "sonderereignis": None,
        **overrides,
    }


def row(partei: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    """A row about `spiel()`'s Ansetzung as it stands."""

    return {"partei": partei, "ansetzung": compose_ansetzung(spiel()), **overrides}


TEAM = {"art": "team", "team_id": ALPHA}
REFEREE = {"art": "schiedsrichter", "schiedsrichter_id": SCHIEDSRICHTER}


class TestTheDeadline:
    def test_a_week_before_the_fixture(self):
        assert frist_of(datum=days_after(day=TODAY, days=10), today=TODAY) == days_after(day=TODAY, days=3)

    def test_today_inside_the_notice_period(self):
        assert frist_of(datum=days_after(day=TODAY, days=3), today=TODAY) == TODAY


class TestTheMintAsksInsideItsWindowAlone:
    def test_a_fixture_today_is_not_asked(self):
        """The floor's edge: both clubs and the referee would be asked to confirm a match already under way."""

        assert anfrage_is_due(spiel=spiel(datum=TODAY), austritte={}, today=TODAY) is False


class TestWhyARowCloses:
    @pytest.mark.parametrize(
        ("partei", "overrides", "austritte", "grund"),
        [
            pytest.param(TEAM, {}, {}, None, id="nothing moved"),
            pytest.param(TEAM, {"uhrzeit": "19:00:00"}, {}, "ansetzung_geaendert", id="a new hour"),
            pytest.param(TEAM, {"ort": None}, {}, "ansetzung_geaendert", id="the ground gone"),
            pytest.param(TEAM, {"ergebnis": "1:0", "uhrzeit": "19:00:00"}, {}, "spiel_entschieden", id="decided and moved"),
            pytest.param(TEAM, {"sonderereignis": "ausgefallen"}, {}, "abgesagt", id="called off"),
            pytest.param(TEAM, {"sonderereignis": "nichtantreten_team2"}, {}, "abgesagt", id="a no-show entered before the day"),
            pytest.param(TEAM, {"sonderereignis": "nichtantreten_team2", "datum": TODAY}, {}, "spiel_entschieden", id="a no-show on the day"),
            pytest.param(TEAM, {"uhrzeit": "19:00:00"}, {BETA: TODAY}, "austritt", id="the opponent gone, ahead of the move"),
            pytest.param(REFEREE, {"schiedsrichter": None}, {}, "schiedsrichter_gewechselt", id="the referee taken off"),
            pytest.param(
                REFEREE, {"schiedsrichter": None, "uhrzeit": "19:00:00"}, {}, "schiedsrichter_gewechselt", id="taken off, ahead of the move"
            ),
            pytest.param(TEAM, {"schiedsrichter": None}, {}, None, id="a club's row keeps its referee change"),
        ],
    )
    def test_the_reason(self, partei: dict[str, Any], overrides: dict[str, Any], austritte: dict[Any, str], grund: str | None):
        assert grund_to_close(row=row(partei), spiel=spiel(**overrides), austritte=austritte, today=TODAY) == grund

    def test_an_answered_row_closes_as_an_open_one_does(self):
        """The close's reach is `geschlossen: null` alone, so a kept agreement records why it stopped applying."""

        answered = row(TEAM, antwort={"art": "zugesagt"})

        assert grund_to_close(row=answered, spiel=spiel(uhrzeit="19:00:00"), austritte={}, today=TODAY) == "ansetzung_geaendert"
        assert grund_to_close(row=answered, spiel=spiel(), austritte={}, today=AFTER_THE_DAY) == "spiel_vergangen"


def test_a_reminder_keeps_every_link_the_seat_was_mailed():
    """Every link a seat was mailed answers until the deadline: a replacing link would kill the request's at the first reminder."""

    assert seats_link(["trainer"]).ersetzt is False
    assert compose_erinnerung_update(emails={"trainer": "t@example.com"}, today=TODAY, erinnert=True) == {
        "$set": {"kontakte.trainer.email": "t@example.com"},
        "$push": {"erinnert_am": TODAY},
    }


# Three commands a row -- the update, its read-back, its log row -- pinned on the wire by
# `fl_backend/tests/api/test_spielbestaetigung_sweep_execution.py :: TestEachPerRowLoopCostsTheRoundTripsItsShareIsSizedAt`.
# A fresh row costs less, one insert taking its share's rows; the bound counts it at three.
ROUND_TRIPS_A_ROW = 3


# Each worst call's commands beside its rows, counted on the wire by
# `fl_backend/tests/api/test_spielbestaetigung_sweep_execution.py :: TestTheWorstCallSendsTheCommandsItsBudgetCounts`.
SWEEP_OTHER_COMMANDS = 32

# A `getMore` apiece for the reads taking a season's rows rather than a share's, once those outrun the driver's first
# batch, pinned on the wire by
# `fl_backend/tests/api/test_spielbestaetigung_sweep_execution.py :: TestEverySeasonSizedReadSendsOneGetMore`.
SWEEP_GET_MORES = 12


# The call's per-command cost, the widest of its whole passes at a full share timed locally: thirty closes and
# reminders on 2026-10-21.
@pytest.mark.parametrize(
    ("rows", "other_commands", "per_command_s", "round_trip_s"),
    [
        pytest.param(
            CLOSES_PER_PASS + MINTS_PER_PASS + REMINDERS_PER_PASS, SWEEP_OTHER_COMMANDS + SWEEP_GET_MORES, 0.00154, 0.037, id="the sweep"
        ),
    ],
)
def test_a_full_share_finishes_inside_the_deadline_at_the_round_trip_its_comment_names(
    rows: int, other_commands: int, per_command_s: float, round_trip_s: float
):
    """A share raised past its budget passes every case that counts its own rows, and times out a whole pass in production."""

    assert (rows * ROUND_TRIPS_A_ROW + other_commands) * (round_trip_s + per_command_s) < REQUEST_DEADLINE_S
