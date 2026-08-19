"""
SPIELE · which bracket edits the season cannot hold

`find_wiring_refusal` is pure, so every case runs in the default tier. The rules are
contradictions rather than preferences — wiring on a group fixture, a source the season cannot
honour, one outcome feeding two slots, a hand-set team on a maintained side — and each case
below is one of them, plus the legal edit beside it that must keep working.

The detail is asserted by substring rather than full message, and the code is asserted separately —
`TestEveryRefusalCarriesItsCode` is what holds `REQ-WIRING-001` to the rule that decides it. The
season under test mirrors the real 2026 shape at its smallest: two group fixtures, two
quarter-finals, two semi-finals (one wired, one manual), and a final fed by both.
"""

from typing import Any, Callable

import pytest
from bson import ObjectId

from app.api.spiele.schemas import FLPatchSpielDataPayload, FLSpielListAdapter
from app.api.spiele.services import WIRING_UNSUPPORTED, find_wiring_refusal
from app.core.exceptions import WriteRefusal

MATCH_ID = "6890a1b2c3d4e5f60720{:04d}"

PayloadFactory = Callable[..., dict[str, Any]]
FixtureFactory = Callable[..., dict[str, Any]]


def sieger(spiel_nr: int) -> dict[str, Any]:
    return {"type": "spiel", "spiel_nr": spiel_nr, "ausgang": "sieger"}


def verlierer(spiel_nr: int) -> dict[str, Any]:
    return {"type": "spiel", "spiel_nr": spiel_nr, "ausgang": "verlierer"}


def gruppenplatz(gruppe: str, platz: int) -> dict[str, Any]:
    return {"type": "gruppe", "gruppe": gruppe, "platz": platz}


@pytest.fixture
def fixture_at(spiel: PayloadFactory) -> FixtureFactory:
    """One match of the season, keyed by `spiel_nr`, with an id derived from it."""

    def make(nr: int, phase: str, **overrides: Any) -> dict[str, Any]:
        return spiel(
            _id=MATCH_ID.format(nr),
            spiel_nr=nr,
            saison_phase=phase,
            ergebnis=None,
            **overrides,
        )

    return make


@pytest.fixture
def season(fixture_at: FixtureFactory) -> list[dict[str, Any]]:
    """
    The smallest season with every shape a rule reads.

    Group fixtures, wired knockouts, a manual semi-final, and a final whose sources are already taken.
    """

    return [
        fixture_at(1, "gruppenphase"),
        fixture_at(2, "gruppenphase"),
        fixture_at(25, "viertelfinale", team1_quelle=gruppenplatz("A", 1), team2_quelle=gruppenplatz("B", 2)),
        fixture_at(26, "viertelfinale", team1_quelle=gruppenplatz("B", 1), team2_quelle=gruppenplatz("A", 2)),
        fixture_at(29, "halbfinale", team1=None, team2=None, team1_quelle=sieger(25), team2_quelle=sieger(26)),
        fixture_at(30, "halbfinale", team1=None, team2=None, team1_quelle=None, team2_quelle=None),
        fixture_at(31, "finale", team1=None, team2=None, team1_quelle=sieger(29), team2_quelle=sieger(30)),
    ]


def refusal_for(season_docs: list[dict[str, Any]], nr: int, **overrides: Any) -> WriteRefusal | None:
    """
    Run the refusal for an edit of match `nr`, built as "everything as stored, plus `overrides`".

    That base is exactly what the form submits: the whole document back, with only the touched fields
    changed. It is also what makes the no-op case the default — a test overriding nothing asserts
    that saving a fixture unchanged is always legal.
    """

    stored = next(doc for doc in season_docs if doc["spiel_nr"] == nr)
    payload = FLPatchSpielDataPayload.model_validate(
        {
            "spiel_id": stored["_id"],
            "is_canceled": stored["is_canceled"],
            "team1": stored["team1"],
            "team2": stored["team2"],
            "team1_quelle": stored["team1_quelle"],
            "team2_quelle": stored["team2_quelle"],
            "elfmeterschiessen": stored["elfmeterschiessen"],
            "datum": stored["datum"],
            "uhrzeit": stored["uhrzeit"],
            "ort": stored["ort"],
            "schiedsrichter": stored["schiedsrichter"],
            "notiz": stored.get("notiz"),
            **overrides,
        }
    )

    # A real ObjectId, exactly as the route convertor hands the endpoint one — the season's own ids
    # validate to ObjectId too, and bson's ObjectId never equals its string spelling.
    return find_wiring_refusal(ObjectId(stored["_id"]), payload, FLSpielListAdapter.validate_python(season_docs))


def message_for(season_docs: list[dict[str, Any]], nr: int, **overrides: Any) -> str:
    """The refusal's detail, or the empty string when there is none, so a substring assertion is one expression."""

    refusal = refusal_for(season_docs, nr, **overrides)

    return refusal.message if refusal is not None else ""


class TestLegalEdits:
    """The edits the rules must keep working, asserted before the refusals they sit beside."""

    @pytest.mark.parametrize("nr", [1, 25, 29, 30, 31])
    def test_saving_a_fixture_unchanged_is_legal(self, season, nr):
        """A no-op save — the most common admin edit is a venue or a kick-off time, wiring untouched."""
        assert refusal_for(season, nr) is None

    def test_keeping_your_own_source_is_legal(self, season):
        """A fixture's own stored source must not read as "already used" — it is being re-submitted, not duplicated."""
        assert refusal_for(season, 29, team1_quelle=sieger(25)) is None

    def test_the_unused_outcome_of_a_used_match_is_legal(self, season):
        """Match 25's winner is taken by 29; its LOSER is a different outcome and stays available."""
        assert refusal_for(season, 30, team1_quelle=verlierer(25)) is None

    def test_taking_manual_charge_keeps_the_occupant(self, season, spiel_team_field):
        """Clearing the source while a team stands is the manual-override route and stays open."""
        occupied = [doc if doc["spiel_nr"] != 29 else {**doc, "team1": spiel_team_field()} for doc in season]
        assert refusal_for(occupied, 29, team1=spiel_team_field(), team1_quelle=None) is None

    def test_switching_a_source_keeps_the_stored_team(self, season, spiel_team_field):
        """Re-wiring a side does not count as hand-setting its team while the payload carries the stored occupant."""
        occupied = [doc if doc["spiel_nr"] != 29 else {**doc, "team1": spiel_team_field()} for doc in season]
        assert refusal_for(occupied, 29, team1=spiel_team_field(), team1_quelle=verlierer(26)) is None

    def test_an_unknown_fixture_is_not_a_wiring_problem(self, season, fixture_at):
        """A `spiel_id` the season does not hold is the write's 404, never a wiring message."""
        foreign = fixture_at(99, "halbfinale")
        payload = FLPatchSpielDataPayload.model_validate(
            {
                "spiel_id": foreign["_id"],
                "is_canceled": False,
                "team1": None,
                "team2": None,
                "team1_quelle": sieger(1),
                "team2_quelle": None,
                "elfmeterschiessen": None,
                "datum": None,
                "uhrzeit": None,
                "ort": None,
                "schiedsrichter": None,
                "notiz": None,
            }
        )
        assert find_wiring_refusal(ObjectId(foreign["_id"]), payload, FLSpielListAdapter.validate_python(season)) is None


class TestPhaseRules:
    """Where a source may point: a knockout match of a strictly earlier round, and nowhere else."""

    def test_a_group_fixture_carries_no_wiring(self, season):
        assert "Gruppenphase" in message_for(season, 1, team1=None, team1_quelle=sieger(2))

    def test_a_dangling_match_number_is_refused(self, season):
        """The typo the resolution could only contain after the fact is refused at the door instead."""
        assert "no such match" in message_for(season, 30, team1_quelle=sieger(27))

    def test_a_group_match_never_feeds_a_slot(self, season):
        assert "Gruppenphase match" in message_for(season, 30, team1_quelle=sieger(1))

    def test_a_fixture_cannot_feed_itself(self, season):
        assert "not played before" in message_for(season, 30, team1_quelle=sieger(30))

    def test_a_same_round_source_is_refused(self, season):
        """Also what makes a cycle inexpressible: every edge must point at a strictly earlier round."""
        assert "not played before" in message_for(season, 29, team1_quelle=sieger(30))

    def test_a_later_round_source_is_refused(self, season):
        assert "not played before" in message_for(season, 29, team1_quelle=sieger(31))


class TestOneOutcomeOneSlot:
    """The duplicate that motivated the rule: one match's winner feeding two fixtures of the bracket."""

    def test_an_outcome_already_feeding_another_fixture_is_refused(self, season):
        """The reported reproduction: re-pointing match 30 at match 26's winner, which 29 already holds."""
        assert "already feeds" in message_for(season, 30, team1_quelle=sieger(26))

    def test_an_outcome_cannot_feed_both_sides_of_one_fixture(self, season):
        assert "already feeds" in message_for(season, 30, team1_quelle=verlierer(25), team2_quelle=verlierer(25))

    def test_a_group_placing_already_seeding_another_fixture_is_refused(self, season):
        """Same rule, `gruppe` variant: Gruppensieger A cannot open two quarter-finals."""
        assert "already feeds" in message_for(season, 26, team1_quelle=gruppenplatz("A", 1))


class TestMaintainedSides:
    """A side with a source belongs to the resolution; the write path refuses what it would revert."""

    def test_a_hand_set_team_on_a_maintained_side_is_refused(self, season, spiel_team_field):
        """The reported reproduction: a team picked onto a wired slot got a success toast and no effect."""
        assert "maintained by its quelle" in message_for(season, 29, team1=spiel_team_field())

    def test_clearing_the_team_of_a_maintained_side_is_refused(self, season, spiel_team_field):
        """Emptying the slot by hand is the same write in the other direction — the resolution owns it."""
        occupied = [doc if doc["spiel_nr"] != 29 else {**doc, "team1": spiel_team_field()} for doc in season]
        assert "maintained by its quelle" in message_for(occupied, 29, team1=None)

    def test_a_manual_side_takes_any_team(self, season, spiel_team_field):
        """The rule reaches exactly as far as a source does: match 30's sides are the admin's own."""
        assert refusal_for(season, 30, team1=spiel_team_field()) is None


class TestEveryRefusalCarriesItsCode:
    """
    The code travels with the refusal, so no endpoint has to know it.

    A rule answering the detail alone leaves its caller to name the code, and a code named at a call site
    is a second copy: nothing compares it against the rule's own, and a rename reaches one and not the
    other. The client acts on the code and never sees the message
    (`app/core/exception_handlers.py :: error_response`), so that copy going stale is invisible until a
    form starts routing a refusal to the wrong field.
    """

    @pytest.mark.parametrize(
        "overrides",
        [
            pytest.param({"team1": None, "team1_quelle": {"type": "spiel", "spiel_nr": 2, "ausgang": "sieger"}}, id="group-fixture"),
            pytest.param({"team1_quelle": {"type": "spiel", "spiel_nr": 27, "ausgang": "sieger"}}, id="dangling-feeder"),
            pytest.param({"team1_quelle": {"type": "spiel", "spiel_nr": 30, "ausgang": "sieger"}}, id="not-played-first"),
            pytest.param({"team1_quelle": {"type": "spiel", "spiel_nr": 26, "ausgang": "sieger"}}, id="outcome-already-used"),
        ],
    )
    def test_a_wiring_refusal_answers_its_own_code(self, season, overrides):
        # Match 1 is the group fixture; every other case is a knockout edit, so the first is run apart.
        nr = 1 if "team1" in overrides else 30

        refusal = refusal_for(season, nr, **overrides)

        assert refusal is not None
        assert refusal.error_code == WIRING_UNSUPPORTED

    def test_the_maintained_side_refusal_answers_it_too(self, season, spiel_team_field):
        refusal = refusal_for(season, 29, team1=spiel_team_field())

        assert refusal is not None
        assert refusal.error_code == WIRING_UNSUPPORTED
