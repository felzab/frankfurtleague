from typing import Any

import pytest
from bson import ObjectId
from pydantic import ValidationError

from app.api.bewerbungen.services import days_after
from app.api.spielbestaetigungen.schemas import ANFRAGEN_LISTED_PER_PASS, FLSpielbestaetigungSweepAngefragtPayload
from app.api.spielbestaetigungen.services import (
    anfrage_is_due,
    compose_ansetzung,
    compose_erinnerung_update,
    frist_of,
    grund_to_close,
    link_groups,
    parteien_of,
)
from app.api.spielbestaetigungen.sweep_router import CLOSES_PER_PASS, MINTS_PER_PASS, REMINDERS_PER_PASS
from app.core.middlewares import REQUEST_DEADLINE_S
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.shared.schemas.bounds import SPIEL_ANFRAGE_VORLAUF_TAGE, SPIEL_BESTAETIGUNG_FRIST_TAGE

TODAY = "2026-04-01"
ALPHA = ObjectId("6890a1b2c3d4e5f607760001")
BETA = ObjectId("6890a1b2c3d4e5f607760002")
SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f6077600c1")
WINDOW = SPIEL_BESTAETIGUNG_FRIST_TAGE + SPIEL_ANFRAGE_VORLAUF_TAGE


def spiel(**overrides: Any) -> dict[str, Any]:
    """A fixture every condition of the mint holds for, a week out, that each case moves one thing of."""

    return {
        "_id": ObjectId("6890a1b2c3d4e5f6077600d1"),
        "datum": days_after(day=TODAY, days=7),
        "uhrzeit": "18:00:00",
        "ort": {"spielort_id": ObjectId("6890a1b2c3d4e5f6077600b1"), "name": "Sportpark", "maps_link": "Sportpark", "mietpreis": 80},
        "team1": {"team_id": ALPHA, "name": "Alpha", "shorthand": "AL", "tore": None},
        "team2": {"team_id": BETA, "name": "Beta", "shorthand": "BE", "tore": None},
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


class TestTheMintAsksInsideItsWindowAlone:
    @pytest.mark.parametrize(
        ("days", "asked"),
        [(-1, False), (0, False), (1, True), (WINDOW, True), (WINDOW + 1, False)],
        ids=["yesterday", "today, the floor's edge", "tomorrow", "the window's last day", "a day past it"],
    )
    def test_the_date(self, days: int, asked: bool):
        """The floor is a date: `has_taken_place` reads a record, so a fixture of the past nobody entered reads as open."""

        assert anfrage_is_due(spiel=spiel(datum=days_after(day=TODAY, days=days)), austritte={}, today=TODAY) is asked

    @pytest.mark.parametrize(
        "unset",
        [{"uhrzeit": None}, {"ort": None}, {"team1": None}, {"team2": None}, {"ergebnis": "1:0"}, {"sonderereignis": "ausgefallen"}],
        ids=lambda unset: next(iter(unset)),
    )
    def test_an_incomplete_or_decided_fixture_is_not_asked(self, unset: dict[str, Any]):
        assert anfrage_is_due(spiel=spiel(**unset), austritte={}, today=TODAY) is False

    @pytest.mark.parametrize(
        ("overrides", "austritte"),
        [
            pytest.param({"team1": {**spiel()["team1"], "tore": 2}}, {}, id="a lone goal count"),
            pytest.param({"elfmeterschiessen": {"team1": 4, "team2": 3}}, {}, id="a lone shoot-out"),
            pytest.param({}, {BETA: days_after(day=TODAY, days=7)}, id="the opponent gone on the day"),
        ],
    )
    def test_a_fixture_the_close_would_shut_is_not_asked(self, overrides: dict[str, Any], austritte: dict[Any, str]):
        """The mint and the close disagreeing is a request mailed every pass: each is a case the plan's own conditions admit."""

        assert anfrage_is_due(spiel=spiel(**overrides), austritte=austritte, today=TODAY) is False

    def test_a_club_gone_after_the_day_is_asked(self):
        assert anfrage_is_due(spiel=spiel(), austritte={BETA: days_after(day=TODAY, days=8)}, today=TODAY) is True


class TestTheDeadline:
    def test_a_week_before_the_fixture(self):
        assert frist_of(datum=days_after(day=TODAY, days=10), today=TODAY) == days_after(day=TODAY, days=3)

    def test_today_inside_the_notice_period(self):
        assert frist_of(datum=days_after(day=TODAY, days=3), today=TODAY) == TODAY


class TestWhyARowCloses:
    @pytest.mark.parametrize(
        ("partei", "overrides", "austritte", "grund"),
        [
            pytest.param(TEAM, {}, {}, None, id="nothing moved"),
            pytest.param(TEAM, {"uhrzeit": "19:00:00"}, {}, "ansetzung_geaendert", id="a new hour"),
            pytest.param(TEAM, {"ort": None}, {}, "ansetzung_geaendert", id="the ground gone"),
            pytest.param(TEAM, {"ergebnis": "1:0", "uhrzeit": "19:00:00"}, {}, "spiel_entschieden", id="decided and moved"),
            pytest.param(TEAM, {"sonderereignis": "ausgefallen"}, {}, "abgesagt", id="called off"),
            pytest.param(TEAM, {"sonderereignis": "nichtantreten_team2"}, {}, "spiel_entschieden", id="a no-show is played"),
            pytest.param(TEAM, {"uhrzeit": "19:00:00"}, {BETA: TODAY}, "austritt", id="the opponent gone, ahead of the move"),
            pytest.param(REFEREE, {"schiedsrichter": None}, {}, "schiedsrichter_gewechselt", id="the referee taken off"),
            pytest.param(
                REFEREE, {"schiedsrichter": None, "uhrzeit": "19:00:00"}, {}, "schiedsrichter_gewechselt", id="taken off, ahead of the move"
            ),
            pytest.param(TEAM, {"schiedsrichter": None}, {}, None, id="a club's row keeps its referee change"),
        ],
    )
    def test_the_reason(self, partei: dict[str, Any], overrides: dict[str, Any], austritte: dict[Any, str], grund: str | None):
        assert grund_to_close(row=row(partei), spiel=spiel(**overrides), austritte=austritte) == grund

    def test_an_answered_row_closes_as_an_open_one_does(self):
        """The close's reach is `geschlossen: null` alone, so a kept agreement records why it stopped applying."""

        answered = row(TEAM, antwort={"art": "zugesagt"})

        assert grund_to_close(row=answered, spiel=spiel(uhrzeit="19:00:00"), austritte={}) == "ansetzung_geaendert"


class TestWhoIsAsked:
    def test_both_sides_and_the_referee(self):
        assert parteien_of(spiel()) == [{"art": "team", "team_id": ALPHA}, {"art": "team", "team_id": BETA}, REFEREE]

    def test_never_the_ghost(self):
        """The ghost holds no address: a row for it would be minted, never mailed and never answered."""

        ghost = {"schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID, "name": None, "payment": 20}

        assert [partei["art"] for partei in parteien_of(spiel(schiedsrichter=ghost))] == ["team", "team"]


class TestOneLinkPerPerson:
    def test_a_mirrored_trainer_rides_the_seat_it_holds(self):
        kontakte = {"trainer_ist_zugleich": "stellvertretung"}

        assert link_groups(kontakte=kontakte, seats=["trainer", "ansprechperson", "stellvertretung"]) == [
            ["trainer", "stellvertretung"],
            ["ansprechperson"],
        ]

    def test_a_mirrored_trainer_alone_keeps_a_link_of_its_own(self):
        """Its partner already holds a link and is not minted again, so the Trainer is asked through one of its own."""

        assert link_groups(kontakte={"trainer_ist_zugleich": "stellvertretung"}, seats=["trainer"]) == [["trainer"]]


def test_a_reminder_appends_its_hash_and_keeps_three():
    """Every link a seat was mailed answers until the deadline: a `$set` here would kill the request link at the first reminder."""

    assert compose_erinnerung_update(hashes={"trainer": "h"}, today=TODAY) == {
        "$push": {"kontakte.trainer.token_hashes": {"$each": ["h"], "$slice": -3}, "erinnert_am": TODAY}
    }


def ids(count: int) -> list[str]:
    return [f"6890a1b2c3d4e5f6079{number:05x}" for number in range(count)]


class TestTheStampTakesOnePassList:
    """The list comes from one pass's answer, so a longer one is no caller of this sweep and would outrun the request's budget."""

    def test_a_whole_list_is_taken(self):
        FLSpielbestaetigungSweepAngefragtPayload.model_validate({"spielbestaetigung_ids": ids(ANFRAGEN_LISTED_PER_PASS)})

    def test_one_id_past_it_is_refused(self):
        with pytest.raises(ValidationError) as failure:
            FLSpielbestaetigungSweepAngefragtPayload.model_validate({"spielbestaetigung_ids": ids(ANFRAGEN_LISTED_PER_PASS + 1)})

        assert [entry["type"] for entry in failure.value.errors()] == ["too_long"]

    def test_every_row_a_pass_answers_fits_one_list(self):
        """A request goes out from the mint's share and from a reminder whose first request was never stamped.

        One list past the bound is refused whole, leaving every row the pass mailed unstamped for good.
        """

        assert MINTS_PER_PASS + REMINDERS_PER_PASS <= ANFRAGEN_LISTED_PER_PASS


# Three commands a row -- the update, its read-back, its log row -- pinned on the wire by
# `fl_backend/tests/api/test_spielbestaetigung_sweep_execution.py :: TestEachPerRowLoopCostsTheRoundTripsItsShareIsSizedAt`.
# A fresh row costs less, one insert taking its share's rows; the bound counts it at three.
ROUND_TRIPS_A_ROW = 3


# Each worst call's commands beside its rows, counted on the wire by
# `fl_backend/tests/api/test_spielbestaetigung_sweep_execution.py :: TestTheWorstCallSendsTheCommandsItsBudgetCounts`.
SWEEP_OTHER_COMMANDS = 24
ANGEFRAGT_OTHER_COMMANDS = 3

# A `getMore` apiece for the reads taking a season's rows rather than a share's, once those outrun the driver's first
# batch, pinned on the wire by
# `fl_backend/tests/api/test_spielbestaetigung_sweep_execution.py :: TestEverySeasonSizedReadSendsOneGetMore`.
SWEEP_GET_MORES = 13


# `tests/api/test_bewerbung_sweep_refusal.py`'s per-command cost, timed locally 2026-09-23.
@pytest.mark.parametrize(
    ("rows", "other_commands", "per_command_s", "round_trip_s"),
    [
        pytest.param(
            CLOSES_PER_PASS + MINTS_PER_PASS + REMINDERS_PER_PASS, SWEEP_OTHER_COMMANDS + SWEEP_GET_MORES, 0.00135, 0.036, id="the sweep"
        ),
        pytest.param(ANFRAGEN_LISTED_PER_PASS, ANGEFRAGT_OTHER_COMMANDS, 0.00101, 0.038, id="/angefragt"),
    ],
)
def test_a_full_share_finishes_inside_the_deadline_at_the_round_trip_its_comment_names(
    rows: int, other_commands: int, per_command_s: float, round_trip_s: float
):
    """A share raised past its budget passes every case that counts its own rows, and times out a whole pass in production."""

    assert (rows * ROUND_TRIPS_A_ROW + other_commands) * (round_trip_s + per_command_s) < REQUEST_DEADLINE_S
