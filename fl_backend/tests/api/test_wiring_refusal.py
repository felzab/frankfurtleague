from collections.abc import Callable
from http import HTTPStatus
from typing import Any

import pytest
from bson import ObjectId

from app.api.spiele.schemas import FLPatchSpielDataPayload, FLSpielListAdapter
from app.api.spiele.services import find_wiring_refusal
from app.core.codes import Code
from app.core.exceptions import WriteRefusal
from tests.payloads import spiel_patch_body

MATCH_ID = "6890a1b2c3d4e5f60720{:04d}"

PayloadFactory = Callable[..., dict[str, Any]]
SpielFactory = Callable[..., dict[str, Any]]


def sieger(spiel_nr: int) -> dict[str, Any]:
    return {"type": "spiel", "spiel_nr": spiel_nr, "ausgang": "sieger"}


def verlierer(spiel_nr: int) -> dict[str, Any]:
    return {"type": "spiel", "spiel_nr": spiel_nr, "ausgang": "verlierer"}


def gruppenplatz(gruppe: str, platz: int) -> dict[str, Any]:
    return {"type": "gruppe", "gruppe": gruppe, "platz": platz}


@pytest.fixture
def spiel_at(spiel: PayloadFactory) -> SpielFactory:
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
def season(spiel_at: SpielFactory) -> list[dict[str, Any]]:
    """Every shape a rule reads: group fixtures, wired knockouts, a manual semi-final, and a final whose sources are taken."""

    return [
        spiel_at(1, "gruppenphase"),
        spiel_at(2, "gruppenphase"),
        spiel_at(25, "viertelfinale", team1_quelle=gruppenplatz("A", 1), team2_quelle=gruppenplatz("B", 2)),
        spiel_at(26, "viertelfinale", team1_quelle=gruppenplatz("B", 1), team2_quelle=gruppenplatz("A", 2)),
        spiel_at(29, "halbfinale", team1=None, team2=None, team1_quelle=sieger(25), team2_quelle=sieger(26)),
        spiel_at(30, "halbfinale", team1=None, team2=None, team1_quelle=None, team2_quelle=None),
        spiel_at(31, "finale", team1=None, team2=None, team1_quelle=sieger(29), team2_quelle=sieger(30)),
    ]


def refusal_for(season_docs: list[dict[str, Any]], nr: int, number_of_gruppen: int = 4, **overrides: Any) -> WriteRefusal | None:
    """Everything as stored plus `overrides`, so a case overriding nothing asserts that an unchanged save is legal."""

    stored = next(doc for doc in season_docs if doc["spiel_nr"] == nr)
    payload = FLPatchSpielDataPayload.model_validate(spiel_patch_body(stored, **overrides))

    # A real `ObjectId`, as the route convertor hands one: bson's never equals its string spelling.
    return find_wiring_refusal(
        ObjectId(stored["_id"]), payload, FLSpielListAdapter.validate_python(season_docs), number_of_gruppen=number_of_gruppen
    )


# What every arm answers: one code for every shape the season moved under, the repair being a reload.
WIRING_REFUSAL = WriteRefusal(error_code=Code.WIRING_UNSUPPORTED, status=HTTPStatus.CONFLICT)


class TestPhaseRules:
    """Where a source may point: a knockout match of a strictly earlier round, and nowhere else."""

    def test_a_group_spiel_carries_no_wiring(self, season):
        # The fixture's own team stays, so no maintained-side rule can refuse in the phase rule's place.
        assert refusal_for(season, 1, team1_quelle=gruppenplatz("C", 1)) == WIRING_REFUSAL

    def test_a_dangling_match_number_is_refused(self, season):
        """The typo the resolution could only contain after the fact is refused at the door instead."""
        assert refusal_for(season, 30, team1_quelle=sieger(27)) == WIRING_REFUSAL

    def test_a_group_match_never_feeds_a_slot(self, season):
        assert refusal_for(season, 30, team1_quelle=sieger(1)) == WIRING_REFUSAL

    def test_a_same_round_source_is_refused(self, season):
        """Also what makes a cycle inexpressible: every edge must point at a strictly earlier round."""
        assert refusal_for(season, 29, team1_quelle=verlierer(30)) == WIRING_REFUSAL

    def test_a_later_round_source_is_refused(self, season):
        assert refusal_for(season, 29, team1_quelle=sieger(31)) == WIRING_REFUSAL


# Two brackets a season can play, by qualifier count:
# `app/api/saisons/schedule.py :: knockout_phases_for` counts back from the Finale, so a different phase opens each one.
BRACKET_SHAPES: dict[int, tuple[str, ...]] = {
    16: ("achtelfinale", "viertelfinale", "halbfinale", "finale"),
    8: ("viertelfinale", "halbfinale", "finale"),
}

OPENING_ROUND = 25


@pytest.fixture
def bracket(spiel_at: SpielFactory) -> Callable[[int], list[dict[str, Any]]]:
    def make(qualifiers: int) -> list[dict[str, Any]]:
        """Two group fixtures, then one unwired fixture per round the bracket plays, numbered in playing order."""

        return [spiel_at(1, "gruppenphase"), spiel_at(2, "gruppenphase")] + [
            spiel_at(OPENING_ROUND + index, phase, team1=None, team2=None) for index, phase in enumerate(BRACKET_SHAPES[qualifiers])
        ]

    return make


class TestAGroupPlacingSeedsTheOpeningRound:
    """The group table feeds the round the season's bracket OPENS on; every later slot is fed by a match.

    Read off the rounds the season holds, never a phase name, which is wrong for three of the four
    shapes a qualifier count produces.
    """

    @pytest.mark.parametrize(
        ("qualifiers", "nr", "phase"),
        [
            pytest.param(16, 26, "viertelfinale", id="sixteen-viertelfinale"),
            pytest.param(8, 26, "halbfinale", id="eight-halbfinale"),
        ],
    )
    def test_a_later_round_is_fed_by_a_match_instead(self, bracket, qualifiers, nr, phase):
        """One round past the opening one, in two brackets opening on different phases."""

        refusal = refusal_for(bracket(qualifiers), nr, team1_quelle=gruppenplatz("A", 1))

        assert refusal is not None and refusal.error_code == Code.WIRING_SEED_PAST_THE_OPENING_ROUND


class TestOneOutcomeOneSlot:
    def test_an_outcome_already_feeding_another_spiel_is_refused(self, season):
        """Re-pointing match 30 at match 26's winner, which 29 already holds."""
        assert refusal_for(season, 30, team1_quelle=sieger(26)) == WIRING_REFUSAL

    def test_an_outcome_cannot_feed_both_sides_of_one_spiel(self, season):
        assert refusal_for(season, 30, team1_quelle=verlierer(25), team2_quelle=verlierer(25)) == WIRING_REFUSAL

    def test_a_group_placing_already_seeding_another_spiel_is_refused(self, season):
        """Same rule, `gruppe` variant: Gruppensieger A cannot open two quarter-finals."""
        assert refusal_for(season, 26, team1_quelle=gruppenplatz("A", 1)) == WIRING_REFUSAL


class TestMaintainedSides:
    """A side with a source belongs to the resolution; the write path refuses what it would revert."""

    def test_a_hand_set_team_on_a_maintained_side_is_refused(self, season, spiel_team_field):
        """A team picked onto a wired slot would otherwise get a success toast and no effect."""
        assert refusal_for(season, 29, team1=spiel_team_field()) == WIRING_REFUSAL

    def test_clearing_the_team_of_a_maintained_side_is_refused(self, season, spiel_team_field):
        """Emptying the slot by hand is the same write in the other direction — the resolution owns it."""
        occupied = [doc if doc["spiel_nr"] != 29 else {**doc, "team1": spiel_team_field()} for doc in season]
        assert refusal_for(occupied, 29, team1=None) == WIRING_REFUSAL


def stored_as(season_docs: list[dict[str, Any]], nr: int, **wiring: Any) -> list[dict[str, Any]]:
    """`saison_docs` with fixture `nr` ALREADY holding `wiring`, so a save resubmitting it changes nothing."""

    return [doc if doc["spiel_nr"] != nr else {**doc, **wiring} for doc in season_docs]


# Each shape as a fixture stores it, with a SECOND value out of the same rule beside it. A hand
# edit reaches all three; no write path repairs any.
STORED_SHAPES: dict[str, tuple[int, dict[str, Any], dict[str, Any], str]] = {
    "dangling-feeder": (30, {"team1_quelle": sieger(27)}, {"team1_quelle": sieger(28)}, Code.WIRING_UNSUPPORTED),
    "gruppenphase-feeder": (30, {"team1_quelle": sieger(1)}, {"team1_quelle": sieger(2)}, Code.WIRING_UNSUPPORTED),
    "seed-past-the-opening-round": (
        30,
        {"team1_quelle": gruppenplatz("C", 1)},
        {"team1_quelle": gruppenplatz("D", 1)},
        Code.WIRING_SEED_PAST_THE_OPENING_ROUND,
    ),
}

stored_shape_cases = pytest.mark.parametrize(("nr", "stored_wiring", "moved_to", "code"), list(STORED_SHAPES.values()), ids=list(STORED_SHAPES))


class TestAStoredShapeDoesNotLatch:
    """Every rule above judges a source this payload MOVES.

    The classes above judge the same shapes INTRODUCED, which is the step, and none of these is one.
    """

    @stored_shape_cases
    def test_moving_a_stored_shape_to_another_breach_is_refused(self, season, nr, stored_wiring, moved_to, code):
        """A second value out of the same rule is no better than the first, and choosing it IS a step."""
        refusal = refusal_for(stored_as(season, nr, **stored_wiring), nr, **moved_to)

        assert refusal is not None
        assert refusal.error_code == code

    def test_a_kept_source_is_still_taken(self, season):
        """Match 29 keeps 25's winner rather than being judged on it, and the season holds it either way."""
        assert refusal_for(season, 29, team2_quelle=sieger(25)) == WIRING_REFUSAL


class TestEveryRefusalCarriesItsCode:
    """The code travels with the refusal: a code named at a call site is a second copy nothing compares against the rule's own."""

    def test_a_group_the_season_does_not_run_carries_a_third_code(self, season):
        """Fixture 25 is the opening round, so only the group's existence separates this from the seeding refusal."""

        refusal = refusal_for(season, 25, number_of_gruppen=2, team1_quelle=gruppenplatz("C", 1))

        assert refusal is not None
        assert refusal.error_code == Code.WIRING_GRUPPE_NOT_RUN
        assert refusal.error_code != Code.WIRING_UNSUPPORTED
        assert refusal.error_code != Code.WIRING_SEED_PAST_THE_OPENING_ROUND
