"""
The playoff bracket: resolving a season's slots from the references its fixtures carry.

`resolve_bracket` is the whole of auto-advance's logic and it is pure, so every case below runs in the
default tier with no container — the walks that matter (a bracket nobody has propagated, a corrected
quarter-final reaching the final) are proven here rather than against a database (ADR-0042).

Ids are built from a fixed prefix plus the match or team number, so a failing case names the fixture it
came from. Both prefixes are 20 hex characters and the suffix is decimal, so every result is a valid
24-character ObjectId.
"""

from typing import Any, Callable

import pytest

from app.api.spiele.schemas import FLSpielListAdapter
from app.api.spiele.services import resolve_bracket

MATCH_ID = "6890a1b2c3d4e5f60718{:04d}"
BRACKET_TEAM_ID = "6890a1b2c3d4e5f60719{:04d}"

# Spelled here rather than imported from `tests/conftest.py`: `--import-mode=importlib` is why that
# module shares helpers as fixtures rather than as imports, and one alias is not worth the exception.
PayloadFactory = Callable[..., dict[str, Any]]
SideFactory = Callable[..., dict[str, Any]]
FixtureFactory = Callable[..., dict[str, Any]]


def sieger(spiel_nr: int) -> dict[str, Any]:
    """The reference a knockout slot after the first round carries: the winner of one earlier match."""
    return {"type": "spiel", "spiel_nr": spiel_nr, "ausgang": "sieger"}


def resolved(documents: list[dict[str, Any]]) -> dict[int, tuple[str | None, str | None]]:
    """
    Run the resolver and describe each advancement as `{spiel_nr: (team1 name, team2 name)}`.

    Names rather than ids, because a failed assertion then reads as the bracket does. Goals are
    asserted separately in the cases that turn on them.
    """

    advancements = resolve_bracket(FLSpielListAdapter.validate_python(documents))

    return {
        advancement.spiel_nr: (
            advancement.team1.name if advancement.team1 is not None else None,
            advancement.team2.name if advancement.team2 is not None else None,
        )
        for advancement in advancements
    }


@pytest.fixture
def side(spiel_team_field: PayloadFactory) -> SideFactory:
    """One fixture side for team `seed`. Seeds stay single-digit: `shorthand` is exactly two characters."""

    def make(seed: int, tore: int | None = None) -> dict[str, Any]:
        return spiel_team_field(team_id=BRACKET_TEAM_ID.format(seed), name=f"Team {seed}", shorthand=f"T{seed}", tore=tore)

    return make


@pytest.fixture
def fixture_at(spiel: PayloadFactory) -> FixtureFactory:
    """One playoff match, keyed by `spiel_nr`, with both sides and both sources given explicitly."""

    def make(
        nr: int,
        *,
        team1: dict[str, Any] | None = None,
        team2: dict[str, Any] | None = None,
        quelle1: dict[str, Any] | None = None,
        quelle2: dict[str, Any] | None = None,
        ergebnis: str | None = None,
        **overrides: Any,
    ) -> dict[str, Any]:
        return spiel(
            _id=MATCH_ID.format(nr),
            spiel_nr=nr,
            saison_phase="viertelfinale",
            team1=team1,
            team2=team2,
            team1_quelle=quelle1,
            team2_quelle=quelle2,
            ergebnis=ergebnis,
            **overrides,
        )

    return make


class TestResolveBracket:
    """The season-wide fixed point, walked over the shapes a real bracket actually reaches."""

    def test_advances_every_played_match_at_once(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        A bracket nobody has propagated resolves itself in full, whatever edit triggered it.

        Two quarter-finals played and their semi-final slots never filled: both fill on the next save of
        any match in the season, and the unplayed pair moves nothing.
        """

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(26, team1=side(3), team2=side(4)),
            fixture_at(27, team1=side(5), team2=side(6)),
            fixture_at(28, team1=side(7, 0), team2=side(8, 2), ergebnis="0:2"),
            fixture_at(29, quelle1=sieger(25), quelle2=sieger(27)),
            fixture_at(30, quelle1=sieger(26), quelle2=sieger(28)),
            fixture_at(31, quelle1=sieger(29), quelle2=sieger(30)),
        ]

        assert resolved(spiele) == {29: ("Team 1", None), 30: (None, "Team 8")}

    def test_the_advanced_team_arrives_with_no_goals(self, fixture_at: FixtureFactory, side: SideFactory):
        """Three goals were scored in the quarter-final, not in the semi-final the winner moves into."""

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, quelle1=sieger(25)),
        ]
        advancement = resolve_bracket(FLSpielListAdapter.validate_python(spiele))[0]

        assert advancement.team1 is not None
        assert advancement.team1.tore is None

    def test_a_corrected_result_reaches_the_final(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        The cascade. Match 25 is corrected after the semi-final it feeds has already been played.

        The semi-final gains the team that actually won, and loses the 2:0 with it — those goals were
        scored by a side no longer in the fixture, and leaving them would credit the incoming team with
        a win it never played, straight into the derived league table (ADR-0026). The semi-final then
        has no winner, so the final's slot empties too.
        """

        spiele = [
            fixture_at(25, team1=side(1, 1), team2=side(2, 3), ergebnis="1:3"),
            fixture_at(27, team1=side(5, 4), team2=side(6, 0), ergebnis="4:0"),
            fixture_at(29, team1=side(1, 2), team2=side(5, 0), quelle1=sieger(25), quelle2=sieger(27), ergebnis="2:0"),
            fixture_at(31, team1=side(1), quelle1=sieger(29)),
        ]

        assert resolved(spiele) == {29: ("Team 2", "Team 5"), 31: (None, None)}

    def test_the_voided_fixture_keeps_neither_sides_goals(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        Both sides are stripped, not only the one that moved.

        The side that stayed scored its goals against the occupant being replaced, and goals standing
        against a fixture with no result is the shape `patch_spiel_data` refuses on its own write path.
        """

        spiele = [
            fixture_at(25, team1=side(1, 1), team2=side(2, 3), ergebnis="1:3"),
            fixture_at(27, team1=side(5, 4), team2=side(6, 0), ergebnis="4:0"),
            fixture_at(29, team1=side(1, 2), team2=side(5, 0), quelle1=sieger(25), quelle2=sieger(27), ergebnis="2:0"),
        ]
        advancement = resolve_bracket(FLSpielListAdapter.validate_python(spiele))[0]

        assert advancement.team1 is not None and advancement.team1.tore is None
        assert advancement.team2 is not None and advancement.team2.tore is None

    def test_a_deleted_result_empties_the_slot_again(self, fixture_at: FixtureFactory, side: SideFactory):
        """The slot IS the winner of the match it names, so it empties when there is no winner."""

        spiele = [
            fixture_at(25, team1=side(1), team2=side(2)),
            fixture_at(29, team1=side(1), quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {29: (None, None)}

    def test_writes_nothing_when_the_bracket_already_agrees(self, fixture_at: FixtureFactory, side: SideFactory):
        """The resolution runs on every admin save, so a bracket that already agrees must stay silent."""

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(27, team1=side(5, 4), team2=side(6, 0), ergebnis="4:0"),
            fixture_at(29, team1=side(1), team2=side(5), quelle1=sieger(25), quelle2=sieger(27)),
        ]

        assert resolved(spiele) == {}

    def test_a_second_pass_over_its_own_output_writes_nothing(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        Idempotence, proven by running the resolver twice rather than by asserting on a hand-built state.

        The first pass fills 29 and empties 31; applying those writes exactly as `crud.py` does — both
        sides plus `ergebnis: None` — and re-running must produce nothing. A version that appended
        rather than recomputed would pass the previous test and fail this one.
        """

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, quelle1=sieger(25)),
            fixture_at(31, team1=side(2), quelle1=sieger(29)),
        ]
        by_nr = {document["spiel_nr"]: document for document in spiele}

        first = resolve_bracket(FLSpielListAdapter.validate_python(spiele))
        assert [advancement.spiel_nr for advancement in first] == [29, 31]

        for advancement in first:
            document = by_nr[advancement.spiel_nr]
            for slot, team in (("team1", advancement.team1), ("team2", advancement.team2)):
                document[slot] = None if team is None else team.model_dump(mode="json")
            document["ergebnis"] = None

        assert resolved(list(by_nr.values())) == {}

    def test_a_resolved_fixture_keeps_its_own_result(self, fixture_at: FixtureFactory, side: SideFactory):
        """A semi-final that has been played is not disturbed, which is what lets the final read it."""

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(27, team1=side(5, 4), team2=side(6, 0), ergebnis="4:0"),
            fixture_at(29, team1=side(1, 2), team2=side(5, 0), quelle1=sieger(25), quelle2=sieger(27), ergebnis="2:0"),
            fixture_at(31, quelle1=sieger(29)),
        ]

        assert resolved(spiele) == {31: ("Team 1", None)}

    def test_a_drawn_knockout_advances_nobody(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        A level knockout has no winner and no way to record how it was actually settled.

        There is no penalties field, so the fixture stalls here rather than guessing a side. The escape
        hatch is the source: clearing it hands the slot to the admin (ADR-0042, open item FB-8).
        """

        spiele = [
            fixture_at(25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2"),
            fixture_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {}

    def test_a_cancelled_match_with_a_result_still_advances_its_winner(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        A cancelled match carrying a result is a forfeit, and it counts (ADR-0026, invariant I1a).

        `is_canceled` is not consulted anywhere in the resolution. Consulting it would put advancement
        and the league table at odds about the same match.
        """

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 0), ergebnis="3:0", is_canceled=True),
            fixture_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {29: ("Team 1", None)}

    def test_goals_without_an_ergebnis_are_not_a_result(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        The same conjunction the league table counts on, for a shape only a hand edit produces.

        Matches are still created in Compass, and no `$jsonSchema` validator may hold a cross-field rule
        (ADR-0027) — so goals with no `ergebnis` is reachable, and advancing a winner from a match the
        table does not count would make the two derivations disagree.
        """

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis=None),
            fixture_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {}

    def test_a_group_seeded_slot_is_left_alone(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        The first knockout round is fed by the standings, and nothing resolves that yet (open item FB-10).

        It is stored and displayed, and the resolution passes over it — so an admin fills it by hand
        today and the eventual automatic seeding writes exactly what that hand writes.
        """

        spiele = [fixture_at(25, team1=side(1), quelle1={"type": "gruppe", "gruppe": "A", "platz": 1})]

        assert resolved(spiele) == {}

    def test_a_slot_with_no_source_is_never_touched(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        Clearing the source is the manual override, and it is the ONLY one.

        A team an admin entered into a slot carrying no `quelle` survives every later save — which is
        how a knockout decided on penalties is recorded until FB-8 gives it a field.
        """

        spiele = [
            fixture_at(25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2"),
            fixture_at(29, team1=side(1), quelle1=None),
        ]

        assert resolved(spiele) == {}

    def test_a_source_naming_no_match_leaves_the_slot_alone(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        A reference to a match the season does not have resolves to nothing, and nothing is no instruction.

        The stored side stays. A number that cannot be looked up is a data-entry mistake, and erasing a
        team over one would destroy more than it reports — unlike a match that exists and has no winner
        yet, which genuinely means the slot is empty.
        """

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, team1=side(1), quelle1=sieger(99)),
        ]

        assert resolved(spiele) == {}

    def test_a_cyclic_chain_leaves_both_fixtures_alone(self, fixture_at: FixtureFactory, side: SideFactory):
        """A contradiction states no outcome, and it must not send the resolution round the loop either."""

        spiele = [
            fixture_at(29, team1=side(1), quelle1=sieger(30)),
            fixture_at(30, team1=side(2), quelle1=sieger(29)),
        ]

        assert resolved(spiele) == {}

    def test_a_fixture_naming_itself_leaves_its_slot_alone(self, fixture_at: FixtureFactory, side: SideFactory):
        """The shortest cycle there is."""

        assert resolved([fixture_at(29, team1=side(1), quelle1=sieger(29))]) == {}

    def test_a_fixture_downstream_of_a_cycle_is_left_alone_too(self, fixture_at: FixtureFactory, side: SideFactory):
        """Nothing derived from a contradiction is derivable, however many hops away it sits."""

        spiele = [
            fixture_at(29, quelle1=sieger(30)),
            fixture_at(30, quelle1=sieger(29)),
            fixture_at(31, team1=side(1), quelle1=sieger(29)),
        ]

        assert resolved(spiele) == {}

    def test_the_sibling_slot_of_an_unresolvable_one_still_resolves(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        One unusable reference costs its own slot, not the fixture — the guard is per side, not per match.

        The unusable side here is genuinely cyclic rather than merely dangling, because that is the
        branch the per-side guard exists for.
        """

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, quelle1=sieger(30), quelle2=sieger(25)),
            fixture_at(30, quelle1=sieger(29)),
        ]

        assert resolved(spiele) == {29: (None, "Team 1")}

    def test_a_fixture_never_becomes_a_team_against_itself(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        Two sources naming the same match and the same outcome would put one team on both sides.

        Nothing downstream would refuse it — a `$jsonSchema` validator may carry no cross-field rule
        (ADR-0027) — so the resolution writes nothing at all and the fixture reports as unmoved.
        """

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, quelle1=sieger(25), quelle2=sieger(25)),
        ]

        assert resolved(spiele) == {}

    def test_a_group_phase_fixture_is_never_touched(self, spiel: PayloadFactory):
        """Both sources null is most of the season, and the resolver has nothing to say about any of it."""

        assert resolved([spiel()]) == {}

    def test_a_renamed_club_is_not_re_fanned_out_here(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        The occupant is compared by id alone, so a stale display copy is not an advancement.

        `name` and `shorthand` are maintained by `PATCH /teams/{team_id}`'s fan-out (ADR-0028, rule 3).
        Comparing them here would make result entry a second, partial rename fan-out covering only the
        matches a reference happens to point at.
        """

        stale = side(1)
        stale["name"] = "Team 1, as it was called last season"

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, team1=stale, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {}
