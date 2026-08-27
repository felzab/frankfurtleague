from typing import Any, Callable

import pytest
from bson import ObjectId

from app.api.spiele.schemas import FLPatchSpielDataPayload, FLSpielListAdapter
from app.api.spiele.services import WIRING_UNSUPPORTED, find_wiring_refusal
from app.core.exceptions import WriteRefusal
from tests.payloads import spiel_patch_body

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
    """Every shape a rule reads: group fixtures, wired knockouts, a manual semi-final, and a final whose sources are taken."""

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
    """Everything as stored plus `overrides`, so a case overriding nothing asserts that an unchanged save is legal."""

    stored = next(doc for doc in season_docs if doc["spiel_nr"] == nr)
    payload = FLPatchSpielDataPayload.model_validate(spiel_patch_body(stored, **overrides))

    # A real `ObjectId`, as the route convertor hands one: bson's never equals its string spelling.
    return find_wiring_refusal(ObjectId(stored["_id"]), payload, FLSpielListAdapter.validate_python(season_docs))


def message_for(season_docs: list[dict[str, Any]], nr: int, **overrides: Any) -> str:
    """The detail, or the empty string when there is none, so a substring assertion is one expression."""

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


# Every bracket a season can play, by qualifier count: `app/api/saisons/schedule.py ::
# knockout_phases_for` counts back from the Finale, so a different phase opens each one.
BRACKET_SHAPES: dict[int, tuple[str, ...]] = {
    16: ("achtelfinale", "viertelfinale", "halbfinale", "finale"),
    8: ("viertelfinale", "halbfinale", "finale"),
    4: ("halbfinale", "finale"),
    2: ("finale",),
}

OPENING_ROUND = 25


@pytest.fixture
def bracket(fixture_at: FixtureFactory) -> Callable[[int], list[dict[str, Any]]]:
    def make(qualifiers: int) -> list[dict[str, Any]]:
        """Two group fixtures, then one unwired fixture per round the bracket plays, numbered in playing order."""

        return [fixture_at(1, "gruppenphase"), fixture_at(2, "gruppenphase")] + [
            fixture_at(OPENING_ROUND + index, phase, team1=None, team2=None) for index, phase in enumerate(BRACKET_SHAPES[qualifiers])
        ]

    return make


class TestAGroupPlacingSeedsTheOpeningRound:
    """The group table feeds the round the season's bracket OPENS on; every later slot is fed by a match.

    Read off the rounds the season holds, never a phase name, which is wrong for three of the four
    shapes a qualifier count produces.
    """

    @pytest.mark.parametrize("qualifiers", list(BRACKET_SHAPES), ids=lambda qualifiers: f"{qualifiers}-qualifiers")
    def test_the_opening_round_is_seeded_from_the_groups(self, bracket, qualifiers):
        """The two-qualifier season included, where the opening round IS the Finale.

        Group fixtures rank below every knockout round, so a rule counting them would close the
        opening round of every shape here.
        """

        assert refusal_for(bracket(qualifiers), OPENING_ROUND, team1_quelle=gruppenplatz("A", 1)) is None

    @pytest.mark.parametrize(
        ("qualifiers", "nr", "phase"),
        [
            pytest.param(16, 26, "viertelfinale", id="sixteen-viertelfinale"),
            pytest.param(16, 27, "halbfinale", id="sixteen-halbfinale"),
            pytest.param(16, 28, "finale", id="sixteen-finale"),
            pytest.param(8, 26, "halbfinale", id="eight-halbfinale"),
            pytest.param(4, 26, "finale", id="four-finale"),
        ],
    )
    def test_a_later_round_is_fed_by_a_match_instead(self, bracket, qualifiers, nr, phase):
        """The Finale three times over: refused wherever the bracket opens earlier, and legal above in the season that opens on it."""

        message = message_for(bracket(qualifiers), nr, team1_quelle=gruppenplatz("A", 1))

        assert "only the round this season's bracket opens on" in message
        # The whole phrase: every phase name here ENDS in "finale", so a bare substring would accept
        # a message naming the wrong round.
        assert f"a {phase} slot" in message

    def test_a_match_source_on_a_later_round_stays_legal(self, bracket):
        """So the rule reaches the `gruppe` variant alone rather than every source on a later round."""

        assert refusal_for(bracket(4), 26, team1_quelle=sieger(OPENING_ROUND)) is None


class TestOneOutcomeOneSlot:
    def test_an_outcome_already_feeding_another_fixture_is_refused(self, season):
        """Re-pointing match 30 at match 26's winner, which 29 already holds."""
        assert "already feeds" in message_for(season, 30, team1_quelle=sieger(26))

    def test_an_outcome_cannot_feed_both_sides_of_one_fixture(self, season):
        assert "already feeds" in message_for(season, 30, team1_quelle=verlierer(25), team2_quelle=verlierer(25))

    def test_a_group_placing_already_seeding_another_fixture_is_refused(self, season):
        """Same rule, `gruppe` variant: Gruppensieger A cannot open two quarter-finals."""
        assert "already feeds" in message_for(season, 26, team1_quelle=gruppenplatz("A", 1))


class TestMaintainedSides:
    """A side with a source belongs to the resolution; the write path refuses what it would revert."""

    def test_a_hand_set_team_on_a_maintained_side_is_refused(self, season, spiel_team_field):
        """A team picked onto a wired slot would otherwise get a success toast and no effect."""
        assert "maintained by its quelle" in message_for(season, 29, team1=spiel_team_field())

    def test_clearing_the_team_of_a_maintained_side_is_refused(self, season, spiel_team_field):
        """Emptying the slot by hand is the same write in the other direction — the resolution owns it."""
        occupied = [doc if doc["spiel_nr"] != 29 else {**doc, "team1": spiel_team_field()} for doc in season]
        assert "maintained by its quelle" in message_for(occupied, 29, team1=None)

    def test_a_manual_side_takes_any_team(self, season, spiel_team_field):
        """The rule reaches exactly as far as a source does: match 30's sides are the admin's own."""
        assert refusal_for(season, 30, team1=spiel_team_field()) is None


class TestEveryRefusalCarriesItsCode:
    """The code travels with the refusal: a code named at a call site is a second copy nothing compares against the rule's own."""

    @pytest.mark.parametrize(
        "overrides",
        [
            pytest.param({"team1": None, "team1_quelle": {"type": "spiel", "spiel_nr": 2, "ausgang": "sieger"}}, id="group-fixture"),
            pytest.param({"team1_quelle": {"type": "spiel", "spiel_nr": 27, "ausgang": "sieger"}}, id="dangling-feeder"),
            pytest.param({"team1_quelle": {"type": "spiel", "spiel_nr": 30, "ausgang": "sieger"}}, id="not-played-first"),
            pytest.param({"team1_quelle": {"type": "spiel", "spiel_nr": 26, "ausgang": "sieger"}}, id="outcome-already-used"),
            pytest.param({"team1_quelle": {"type": "gruppe", "gruppe": "C", "platz": 1}}, id="group-placing-past-the-opening-round"),
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
