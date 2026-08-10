"""
SPIELE · resolving a season's bracket slots from the references its fixtures carry

`resolve_bracket` is the whole of auto-advance's logic and it is pure, so every case runs in the
default tier with no container — the walks that matter (a bracket nobody has propagated, a
corrected quarter-final reaching the final) are proven here rather than against a database
(ADR-0034).

Ids are a fixed prefix plus the match or team number, so a failing case names the fixture it came
from; both prefixes are 20 hex characters and the suffix is decimal, so every result is a valid
24-character ObjectId.
"""

from typing import Any, Callable

import pytest

from app.api.spiele.schemas import FLBracketFaultQuelle, FLSpielListAdapter
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

    No standings are supplied, so every case in this module is about the MATCH-fed half of the bracket.
    Seeding from a group placing is `test_standings.py`'s.
    """

    resolution = resolve_bracket(FLSpielListAdapter.validate_python(documents), {})

    return {
        advancement.spiel_nr: (
            advancement.team1.name if advancement.team1 is not None else None,
            advancement.team2.name if advancement.team2 is not None else None,
        )
        for advancement in resolution.advancements
    }


def faults(documents: list[dict[str, Any]]) -> list[tuple[int, str]]:
    """
    Run the resolver and describe each reported fault as `(spiel_nr, reason)`, in report order.

    The variant-specific fields are asserted only where a case turns on them, because the pair above is
    what an admin acts on: which fixture, and what is wrong with it.
    """

    return [(fault.spiel_nr, fault.reason) for fault in resolve_bracket(FLSpielListAdapter.validate_python(documents), {}).bracket_faults]


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
        # Declared rather than left to `**overrides`, which would collide with the default below. Every
        # case here is a knockout fixture except the one asserting that a group draw settles nothing.
        saison_phase: str = "viertelfinale",
        **overrides: Any,
    ) -> dict[str, Any]:
        return spiel(
            _id=MATCH_ID.format(nr),
            spiel_nr=nr,
            saison_phase=saison_phase,
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
        advancement = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements[0]

        assert advancement.team1 is not None
        assert advancement.team1.tore is None

    def test_a_corrected_result_reaches_the_final(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        The cascade. Match 25 is corrected after the semi-final it feeds has already been played.

        The semi-final gains the team that actually won, and loses the 2:0 with it — those goals were
        scored by a side no longer in the fixture, and leaving them would credit the incoming team with
        a win it never played, straight into the derived league table (ADR-0019). The semi-final then
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
        advancement = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements[0]

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
        sides, `ergebnis: None` and `elfmeterschiessen: None` — and re-running must produce nothing. A
        version that appended rather than recomputed would pass the previous test and fail this one.
        """

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, quelle1=sieger(25)),
            fixture_at(31, team1=side(2), quelle1=sieger(29)),
        ]
        by_nr = {document["spiel_nr"]: document for document in spiele}

        first = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements
        assert [advancement.spiel_nr for advancement in first] == [29, 31]

        for advancement in first:
            document = by_nr[advancement.spiel_nr]
            for slot, team in (("team1", advancement.team1), ("team2", advancement.team2)):
                document[slot] = None if team is None else team.model_dump(mode="json")
            document["ergebnis"] = None
            document["elfmeterschiessen"] = None

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

    def test_a_drawn_knockout_with_no_shootout_advances_nobody(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        A level knockout has no winner until something records how it was settled.

        The goals cannot decide it and nothing else in the fixture claims to, so the slot it feeds stays
        empty rather than being handed a guess (ADR-0036).
        """

        spiele = [
            fixture_at(25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2"),
            fixture_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {}

    def test_a_shootout_decides_a_level_knockout(self, fixture_at: FixtureFactory, side: SideFactory):
        """The fixture a shoot-out exists for: level on goals, settled on penalties, and the bracket moves on (ADR-0036)."""

        spiele = [
            fixture_at(25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2", elfmeterschiessen={"team1": 4, "team2": 3}),
            fixture_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {29: ("Team 1", None)}

    def test_a_shootout_also_decides_the_loser(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        `verlierer` resolves to the side that lost the shoot-out, as a third-place play-off would want.

        Asserted separately from the winner because the two spellings take different branches, and a
        version reading only the shoot-out's higher count would pass the test above and fail this one.
        """

        spiele = [
            fixture_at(25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2", elfmeterschiessen={"team1": 4, "team2": 3}),
            fixture_at(29, quelle1={"type": "spiel", "spiel_nr": 25, "ausgang": "verlierer"}),
        ]

        assert resolved(spiele) == {29: ("Team 2", None)}

    def test_a_shootout_carries_through_a_whole_round(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        Two level quarter-finals settled on penalties feed one semi-final, which fills on BOTH sides.

        An end-to-end case rather than one more branch of `_outcome_of`, because a slot a drawn knockout
        leaves empty empties everything downstream of it in turn, and that is the failure this field
        exists to remove (ADR-0036).
        """

        spiele = [
            fixture_at(25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2", elfmeterschiessen={"team1": 4, "team2": 3}),
            fixture_at(27, team1=side(5, 0), team2=side(6, 0), ergebnis="0:0", elfmeterschiessen={"team1": 2, "team2": 5}),
            fixture_at(29, quelle1=sieger(25), quelle2=sieger(27)),
        ]

        assert resolved(spiele) == {29: ("Team 1", "Team 6")}

    def test_a_shootout_is_ignored_where_the_goals_already_decided_it(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        A shoot-out on a fixture one side won on goals is a contradiction, and the goals win it.

        `patch_spiel_data` discards the record on that shape, so this is reachable only by a hand edit —
        and no `$jsonSchema` validator may hold a cross-field rule to refuse it (ADR-0020). Reading the
        shoot-out here would advance Team 2 out of a match Team 1 won 3:1.
        """

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1", elfmeterschiessen={"team1": 2, "team2": 4}),
            fixture_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {29: ("Team 1", None)}

    def test_a_shootout_on_a_group_fixture_advances_nobody(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        A group draw is a final result, so no shoot-out settles it however the document is spelled.

        `patch_spiel_data` discards a record arriving on a group fixture, so this is reachable only by a
        hand edit — the same class of shape the `ergebnis` conjunction below guards against, and guarded
        here for the same reason. Without it, a `spiel` reference pointed at a group match would advance
        a team out of a draw that the league table scores as one point each.
        """

        spiele = [
            fixture_at(
                25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2", elfmeterschiessen={"team1": 4, "team2": 3}, saison_phase="gruppenphase"
            ),
            fixture_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {}

    def test_a_shootout_without_a_result_advances_nobody(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        The same conjunction the league table counts on still governs: no `ergebnis`, no winner.

        A shoot-out recorded against a match that was never played is another hand-edited shape, and
        advancing from it would put the bracket ahead of a result the table does not count (ADR-0019).
        """

        spiele = [
            fixture_at(25, team1=side(1), team2=side(2), ergebnis=None, elfmeterschiessen={"team1": 4, "team2": 3}),
            fixture_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {}

    def test_a_shootout_winner_arrives_with_no_goals(self, fixture_at: FixtureFactory, side: SideFactory):
        """Neither the goals nor the penalties were scored in the fixture the winner moves into."""

        spiele = [
            fixture_at(25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2", elfmeterschiessen={"team1": 4, "team2": 3}),
            fixture_at(29, quelle1=sieger(25)),
        ]
        advancement = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements[0]

        assert advancement.team1 is not None
        assert advancement.team1.tore is None

    def test_a_cancelled_match_with_a_result_still_advances_its_winner(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        A cancelled match carrying a result is a forfeit, and it counts (ADR-0019, invariant I1a).

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
        (ADR-0020) — so goals with no `ergebnis` is reachable, and advancing a winner from a match the
        table does not count would make the two derivations disagree.
        """

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis=None),
            fixture_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {}

    def test_a_group_seeded_slot_is_left_alone_with_no_standings(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        A `gruppe` reference with no standing behind it resolves to nothing, and nothing is no instruction.

        This is the state a caller passing `{}` is in — it asked for the match-fed half of the bracket
        alone. Distinct from a group that HAS a standing and simply has not decided that placing yet,
        which does empty the slot; that case is in `test_standings.py`.
        """

        spiele = [fixture_at(25, team1=side(1), quelle1={"type": "gruppe", "gruppe": "A", "platz": 1})]

        assert resolved(spiele) == {}

    def test_a_slot_with_no_source_is_never_touched(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        Clearing the source is the manual override, and it is the ONLY one.

        A team an admin entered into a slot carrying no `quelle` survives every later save, whatever the
        match feeding it did.
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
        (ADR-0020) — so the resolution writes nothing at all and the fixture reports as unmoved.
        """

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, quelle1=sieger(25), quelle2=sieger(25)),
        ]

        assert resolved(spiele) == {}

    def test_a_fixture_downstream_of_a_refused_collision_keeps_its_result(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        The same-team refusal must not leak past the fixture it refuses.

        The semi-final's duplicated reference is one digit away from a real draw, and the final below
        it already holds the semi's winner and a recorded result. A refusal that marked the semi's
        occupants as changed would void its stored result for the pass and EMPTY the final — erasing a
        recorded result over a typo. The memo instead records the semi as unmaintained, so the final
        keeps deriving from the semi's stored state and nothing anywhere is written.
        """

        # The typo on match 29: quelle2 should be sieger(27); both slots now name match 25.
        typo = {"quelle1": sieger(25), "quelle2": sieger(25)}
        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(27, team1=side(3, 2), team2=side(4, 0), ergebnis="2:0"),
            fixture_at(29, team1=side(1, 1), team2=side(3, 0), ergebnis="1:0", saison_phase="halbfinale", **typo),
            fixture_at(31, team1=side(1, 2), team2=side(5, 0), quelle1=sieger(29), ergebnis="2:0", saison_phase="finale"),
        ]

        assert resolved(spiele) == {}

    def test_a_refused_collisions_stored_state_still_feeds_downstream(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        Downstream of a refused fixture derives from what that fixture STORES, not from nothing.

        The refused semi-final holds a real, played result an admin accepted; a slot fed by it is a
        slot fed by a match that exists and has a winner, so it is maintained — from the stored state.
        """

        collision = {"quelle1": sieger(25), "quelle2": sieger(25)}
        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, team1=side(1, 1), team2=side(3, 0), ergebnis="1:0", saison_phase="halbfinale", **collision),
            # Holds the wrong club: the stored semi says Team 1 won it.
            fixture_at(31, team1=side(9), quelle1=sieger(29), saison_phase="finale"),
        ]

        assert resolved(spiele) == {31: ("Team 1", None)}

    @pytest.mark.parametrize("mistake", ["dangling", "cycle", "self_reference", "duplicate_reference", "gruppe_without_standings"])
    def test_no_mistake_shape_moves_a_season_at_rest(self, fixture_at: FixtureFactory, side: SideFactory, mistake: str):
        """
        A season whose slots all agree with their wiring stays untouched whatever mistake is added.

        This is the containment property behind every "left alone" rule, stated once. Each shape is
        injected into the same resolved bracket — quarter-finals played, semi played, final holding
        the semi's winner — and the resolution must write NOTHING, downstream fixtures included. A
        shape that leaves its own fixture alone but moves the subtree below it fails here, which is
        exactly the defect class the per-fixture tests cannot see.
        """

        def semi(quelle2: dict[str, Any]) -> dict[str, Any]:
            sides = {"team1": side(1, 1), "team2": side(3, 0)}
            return fixture_at(29, quelle1=sieger(25), quelle2=quelle2, ergebnis="1:0", saison_phase="halbfinale", **sides)

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(27, team1=side(3, 2), team2=side(4, 0), ergebnis="2:0"),
            semi(sieger(27)),
            fixture_at(31, team1=side(1), quelle1=sieger(29), saison_phase="finale"),
        ]

        gruppen_quelle = {"type": "gruppe", "gruppe": "A", "platz": 1}
        match mistake:
            case "dangling":
                spiele[2] = semi(sieger(99))
            case "cycle":
                spiele += [
                    fixture_at(40, team1=side(5), quelle1=sieger(41), saison_phase="halbfinale"),
                    fixture_at(41, team1=side(6), quelle1=sieger(40), saison_phase="halbfinale"),
                    fixture_at(42, team1=side(5), quelle1=sieger(40), saison_phase="finale"),
                ]
            case "self_reference":
                spiele += [
                    fixture_at(40, team1=side(5, 2), team2=side(6, 0), quelle1=sieger(40), ergebnis="2:0", saison_phase="halbfinale"),
                    fixture_at(42, team1=side(5), quelle1=sieger(40), saison_phase="finale"),
                ]
            case "duplicate_reference":
                spiele[2] = semi(sieger(25))
            case "gruppe_without_standings":
                spiele[0] = fixture_at(25, team1=side(1, 3), team2=side(2, 1), quelle1=gruppen_quelle, ergebnis="3:1")

        assert resolved(spiele) == {}

    def test_a_group_phase_fixture_is_never_touched(self, spiel: PayloadFactory):
        """Both sources null is most of the season, and the resolver has nothing to say about any of it."""

        assert resolved([spiel()]) == {}

    def test_a_renamed_club_is_not_re_fanned_out_here(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        The occupant is compared by id alone, so a stale display copy is not an advancement.

        `name` and `shorthand` are maintained by `PATCH /teams/{team_id}`'s fan-out (ADR-0021, rule 3).
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


class TestNamingWhatWasVoided:
    """
    Which advancements destroyed a stored result, and which merely filled a slot (ADR-0041).

    The distinction is the whole point: both write the same fields, and a report that named only the
    fixtures would describe an admin's deleted scoreline in the same words as an empty semi-final
    gaining its winner. Every case here asserts the harmless side too, because a report that always
    claimed a loss would be exactly as useless as one that never did.
    """

    def test_a_slot_filling_from_empty_voids_nothing(self, fixture_at: FixtureFactory, side: SideFactory):
        """The ordinary case, and the majority of them: the semi-final held no result to lose."""

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, quelle1=sieger(25)),
        ]
        (advancement,) = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements

        assert advancement.spiel_nr == 29
        assert advancement.voided_ergebnis is None
        assert advancement.voided_elfmeterschiessen is None

    def test_a_corrected_result_names_the_scoreline_it_destroys(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        The case the whole report exists for.

        Match 25 is corrected after the semi-final it feeds has been played, so the semi-final's 2:0 is
        deleted by a save the admin made against a different fixture. The response names it rather than
        leaving the admin to notice.
        """

        spiele = [
            fixture_at(25, team1=side(1, 1), team2=side(2, 3), ergebnis="1:3"),
            fixture_at(29, team1=side(1, 2), team2=side(3, 0), ergebnis="2:0", quelle1=sieger(25)),
        ]
        (advancement,) = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements

        assert advancement.spiel_nr == 29
        assert advancement.voided_ergebnis == "2:0"

    def test_a_shoot_out_is_named_beside_the_goals_it_settled(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        The shoot-out goes with the result (`docs/backend/spec.md :: I25b`), so it is the other half of what was lost.

        Reported separately rather than folded into the scoreline, for the reason it is stored
        separately: `2:2` and `4:3 i. E.` are two scorelines about one fixture (ADR-0036).
        """

        spiele = [
            fixture_at(25, team1=side(1, 1), team2=side(2, 3), ergebnis="1:3"),
            fixture_at(
                29,
                team1=side(1, 2),
                team2=side(3, 2),
                ergebnis="2:2",
                elfmeterschiessen={"team1": 4, "team2": 3},
                quelle1=sieger(25),
            ),
        ]
        (advancement,) = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements

        assert advancement.voided_ergebnis == "2:2"
        assert advancement.voided_elfmeterschiessen is not None
        assert (advancement.voided_elfmeterschiessen.team1, advancement.voided_elfmeterschiessen.team2) == (4, 3)

    def test_an_emptied_slot_still_names_what_it_held(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        Deleting a quarter-final's result empties the semi-final below it, result included.

        The advancement reports no occupant at all, which a bare fixture list cannot distinguish from a
        slot that filled — and this is the one where something was destroyed.
        """

        spiele = [
            fixture_at(25, team1=side(1), team2=side(2)),
            fixture_at(29, team1=side(1, 2), team2=side(3, 0), ergebnis="2:0", quelle1=sieger(25)),
        ]
        (advancement,) = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements

        assert advancement.team1 is None
        assert advancement.voided_ergebnis == "2:0"


class TestReportingAFault:
    """
    A fault shape is reported as well as contained (ADR-0039).

    Containment and reporting are separate properties, so every case here pairs its fault assertion with
    `resolved(...) == {}`: a fault that started moving a slot would be a regression the fault list itself
    cannot see.
    """

    def test_a_source_naming_no_match_is_reported(self, fixture_at: FixtureFactory, side: SideFactory):
        """The number to correct rides along, because it is the only thing an admin can act on."""

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, team1=side(1), quelle1=sieger(99)),
        ]

        assert faults(spiele) == [(29, "spiel_missing")]
        assert resolved(spiele) == {}

        # The isinstance is the assertion, not a type-checker concession: a `spiel_missing` arriving as
        # any other variant would be carrying the wrong fields for its own reason.
        reported = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).bracket_faults[0]
        assert isinstance(reported, FLBracketFaultQuelle)
        assert reported.quelle_spiel_nr == 99

    def test_every_fixture_a_cycle_reaches_is_reported(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        Both fixtures of the loop and the one hanging off it, because all three are equally underivable.

        A report naming only the loop would leave the admin correcting two fixtures and wondering why the
        third stayed empty.
        """

        spiele = [
            fixture_at(29, quelle1=sieger(30)),
            fixture_at(30, quelle1=sieger(29)),
            fixture_at(31, team1=side(1), quelle1=sieger(29)),
        ]

        assert faults(spiele) == [(29, "reference_cycle"), (30, "reference_cycle"), (31, "reference_cycle")]
        assert resolved(spiele) == {}

    def test_a_fixture_naming_itself_is_reported(self, fixture_at: FixtureFactory, side: SideFactory):
        """The shortest cycle there is, and it reports as one."""

        assert faults([fixture_at(29, team1=side(1), quelle1=sieger(29))]) == [(29, "reference_cycle")]

    def test_two_sources_resolving_to_one_club_are_reported(self, fixture_at: FixtureFactory, side: SideFactory):
        """The duplicated reference: one digit away from a real draw, and refused rather than written."""

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, quelle1=sieger(25), quelle2=sieger(25)),
        ]

        assert faults(spiele) == [(29, "same_team")]
        assert resolved(spiele) == {}

    def test_a_manual_side_colliding_with_a_maintained_one_is_reported(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        The one fault of the five the write path cannot refuse, so the report is all there is.

        `find_wiring_refusal` keys a source by its identity and refuses a hand-set team only on a side a
        source maintains (ADR-0038) — so a manual side holding the club that then wins the match feeding
        the other side passes every rule, legally, and produces a fixture nobody can play.
        """

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, team1=side(1), quelle1=None, quelle2=sieger(25)),
        ]

        assert faults(spiele) == [(29, "same_team")]
        assert resolved(spiele) == {}

    def test_a_collision_already_stored_is_reported_on_a_pass_that_moves_nothing(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        The containment guard fires only where an occupant would move; the report must not.

        A fixture hand-edited in Compass to hold, on both sides, the club its own source resolves to is
        already at rest — every pass agrees with what is stored, so nothing changes and the guard never
        sees it. Reporting on the same condition would make this fixture invisible forever.
        """

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, team1=side(1), team2=side(1), quelle2=sieger(25)),
        ]

        assert faults(spiele) == [(29, "same_team")]
        assert resolved(spiele) == {}

    def test_two_hand_set_sides_holding_one_club_are_not_a_wiring_fault(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        No source, no wiring, nothing for this list to say — whatever else is wrong with the fixture.

        The boundary matters: widening it would put every fixture with a duplicated hand-set side into a
        list an admin reads as being about the bracket's references.
        """

        assert faults([fixture_at(29, team1=side(1), team2=side(1))]) == []

    def test_a_season_at_rest_reports_nothing(self, fixture_at: FixtureFactory, side: SideFactory):
        """
        The property that keeps the list worth reading: a correct bracket produces an empty one.

        Quarter-finals played, semi-final holding their winners and its own result, final holding the
        semi's winner — every slot agreeing with its wiring, and not one of the five shapes present.
        """

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(27, team1=side(3, 2), team2=side(4, 0), ergebnis="2:0"),
            fixture_at(
                29, team1=side(1, 1), team2=side(3, 0), quelle1=sieger(25), quelle2=sieger(27), ergebnis="1:0", saison_phase="halbfinale"
            ),
            fixture_at(31, team1=side(1), quelle1=sieger(29), saison_phase="finale"),
        ]

        assert faults(spiele) == []
