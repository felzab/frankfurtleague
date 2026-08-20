from typing import Any, Callable, get_args

import pytest

from app.api.spiele.schemas import FLBracketFaultQuelle, FLSonderereignis, FLSpielListAdapter
from app.api.spiele.services import resolve_bracket

MATCH_ID = "6890a1b2c3d4e5f60718{:04d}"
BRACKET_TEAM_ID = "6890a1b2c3d4e5f60719{:04d}"

# Duplicated rather than imported: `--import-mode=importlib` is why `conftest.py` shares helpers as
# fixtures, and one alias is not worth the exception.
PayloadFactory = Callable[..., dict[str, Any]]
SideFactory = Callable[..., dict[str, Any]]
FixtureFactory = Callable[..., dict[str, Any]]


def sieger(spiel_nr: int) -> dict[str, Any]:
    return {"type": "spiel", "spiel_nr": spiel_nr, "ausgang": "sieger"}


def resolved(documents: list[dict[str, Any]]) -> dict[int, tuple[str | None, str | None]]:
    """No standings, so every case here is match-fed; seeding from a group placing is `test_standings.py`'s."""

    resolution = resolve_bracket(FLSpielListAdapter.validate_python(documents), {})

    return {
        advancement.spiel_nr: (
            advancement.team1.name if advancement.team1 is not None else None,
            advancement.team2.name if advancement.team2 is not None else None,
        )
        for advancement in resolution.advancements
    }


def faults(documents: list[dict[str, Any]]) -> list[tuple[int, str]]:
    return [(fault.spiel_nr, fault.reason) for fault in resolve_bracket(FLSpielListAdapter.validate_python(documents), {}).bracket_faults]


@pytest.fixture
def side(spiel_team_field: PayloadFactory) -> SideFactory:
    """Seeds stay single-digit: `shorthand` is exactly two characters."""

    def make(seed: int, tore: int | None = None) -> dict[str, Any]:
        return spiel_team_field(team_id=BRACKET_TEAM_ID.format(seed), name=f"Team {seed}", shorthand=f"T{seed}", tore=tore)

    return make


@pytest.fixture
def fixture_at(spiel: PayloadFactory) -> FixtureFactory:
    def make(
        nr: int,
        *,
        team1: dict[str, Any] | None = None,
        team2: dict[str, Any] | None = None,
        quelle1: dict[str, Any] | None = None,
        quelle2: dict[str, Any] | None = None,
        ergebnis: str | None = None,
        # Declared, not left to `**overrides`: that would pass `saison_phase` twice.
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
    def test_advances_every_played_match_at_once(self, fixture_at: FixtureFactory, side: SideFactory):
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
        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, quelle1=sieger(25)),
        ]
        advancement = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements[0]

        assert advancement.team1 is not None
        assert advancement.team1.tore is None

    def test_a_corrected_result_reaches_the_final(self, fixture_at: FixtureFactory, side: SideFactory):
        """Correcting 25 voids the semi's result — a side no longer in it scored those goals — so the final empties too."""

        spiele = [
            fixture_at(25, team1=side(1, 1), team2=side(2, 3), ergebnis="1:3"),
            fixture_at(27, team1=side(5, 4), team2=side(6, 0), ergebnis="4:0"),
            fixture_at(29, team1=side(1, 2), team2=side(5, 0), quelle1=sieger(25), quelle2=sieger(27), ergebnis="2:0"),
            fixture_at(31, team1=side(1), quelle1=sieger(29)),
        ]

        assert resolved(spiele) == {29: ("Team 2", "Team 5"), 31: (None, None)}

    def test_the_voided_fixture_keeps_neither_sides_goals(self, fixture_at: FixtureFactory, side: SideFactory):
        """Both sides lose their goals: goals with no result is a shape the write path refuses."""

        spiele = [
            fixture_at(25, team1=side(1, 1), team2=side(2, 3), ergebnis="1:3"),
            fixture_at(27, team1=side(5, 4), team2=side(6, 0), ergebnis="4:0"),
            fixture_at(29, team1=side(1, 2), team2=side(5, 0), quelle1=sieger(25), quelle2=sieger(27), ergebnis="2:0"),
        ]
        advancement = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements[0]

        assert advancement.team1 is not None and advancement.team1.tore is None
        assert advancement.team2 is not None and advancement.team2.tore is None

    def test_a_deleted_result_empties_the_slot_again(self, fixture_at: FixtureFactory, side: SideFactory):
        spiele = [
            fixture_at(25, team1=side(1), team2=side(2)),
            fixture_at(29, team1=side(1), quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {29: (None, None)}

    def test_writes_nothing_when_the_bracket_already_agrees(self, fixture_at: FixtureFactory, side: SideFactory):
        """Resolution runs on every admin save, so an agreeing bracket must stay silent."""

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(27, team1=side(5, 4), team2=side(6, 0), ergebnis="4:0"),
            fixture_at(29, team1=side(1), team2=side(5), quelle1=sieger(25), quelle2=sieger(27)),
        ]

        assert resolved(spiele) == {}

    def test_a_second_pass_over_its_own_output_writes_nothing(self, fixture_at: FixtureFactory, side: SideFactory):
        """Writes applied as `crud.py` does, then re-run: a resolver that appended rather than recomputed fails only here."""

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
        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(27, team1=side(5, 4), team2=side(6, 0), ergebnis="4:0"),
            fixture_at(29, team1=side(1, 2), team2=side(5, 0), quelle1=sieger(25), quelle2=sieger(27), ergebnis="2:0"),
            fixture_at(31, quelle1=sieger(29)),
        ]

        assert resolved(spiele) == {31: ("Team 1", None)}

    def test_a_drawn_knockout_with_no_shootout_advances_nobody(self, fixture_at: FixtureFactory, side: SideFactory):
        spiele = [
            fixture_at(25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2"),
            fixture_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {}

    def test_a_shootout_decides_a_level_knockout(self, fixture_at: FixtureFactory, side: SideFactory):
        spiele = [
            fixture_at(25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2", elfmeterschiessen={"team1": 4, "team2": 3}),
            fixture_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {29: ("Team 1", None)}

    def test_a_shootout_also_decides_the_loser(self, fixture_at: FixtureFactory, side: SideFactory):
        """Not redundant with the winner case: reading the higher count alone would pass that one."""

        spiele = [
            fixture_at(25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2", elfmeterschiessen={"team1": 4, "team2": 3}),
            fixture_at(29, quelle1={"type": "spiel", "spiel_nr": 25, "ausgang": "verlierer"}),
        ]

        assert resolved(spiele) == {29: ("Team 2", None)}

    def test_a_shootout_carries_through_a_whole_round(self, fixture_at: FixtureFactory, side: SideFactory):
        spiele = [
            fixture_at(25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2", elfmeterschiessen={"team1": 4, "team2": 3}),
            fixture_at(27, team1=side(5, 0), team2=side(6, 0), ergebnis="0:0", elfmeterschiessen={"team1": 2, "team2": 5}),
            fixture_at(29, quelle1=sieger(25), quelle2=sieger(27)),
        ]

        assert resolved(spiele) == {29: ("Team 1", "Team 6")}

    def test_a_shootout_is_ignored_where_the_goals_already_decided_it(self, fixture_at: FixtureFactory, side: SideFactory):
        """A hand edit only: `patch_spiel_data` discards it and no validator holds a cross-field rule. Reading it advances the loser."""

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1", elfmeterschiessen={"team1": 2, "team2": 4}),
            fixture_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {29: ("Team 1", None)}

    def test_a_shootout_on_a_group_fixture_advances_nobody(self, fixture_at: FixtureFactory, side: SideFactory):
        """A group draw is final: advancing out of one would contradict the table, which scores it a point each."""

        spiele = [
            fixture_at(
                25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2", elfmeterschiessen={"team1": 4, "team2": 3}, saison_phase="gruppenphase"
            ),
            fixture_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {}

    def test_a_shootout_without_a_result_advances_nobody(self, fixture_at: FixtureFactory, side: SideFactory):
        spiele = [
            fixture_at(25, team1=side(1), team2=side(2), ergebnis=None, elfmeterschiessen={"team1": 4, "team2": 3}),
            fixture_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {}

    def test_a_shootout_winner_arrives_with_no_goals(self, fixture_at: FixtureFactory, side: SideFactory):
        spiele = [
            fixture_at(25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2", elfmeterschiessen={"team1": 4, "team2": 3}),
            fixture_at(29, quelle1=sieger(25)),
        ]
        advancement = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements[0]

        assert advancement.team1 is not None
        assert advancement.team1.tore is None

    @pytest.mark.parametrize("sonderereignis", get_args(FLSonderereignis))
    def test_a_result_advances_its_winner_whatever_the_event_says(self, fixture_at: FixtureFactory, side: SideFactory, sonderereignis: str):
        """A forfeit counts (I1a), and `_outcome_of` reads no event, so the bracket follows the `ergebnis` the table scores.

        Only a hand edit reaches the two states barred from a result; this walk special-cases none.
        """

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 0), ergebnis="3:0", sonderereignis=sonderereignis),
            fixture_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {29: ("Team 1", None)}

    def test_goals_without_an_ergebnis_are_not_a_result(self, fixture_at: FixtureFactory, side: SideFactory):
        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis=None),
            fixture_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {}

    def test_a_group_seeded_slot_is_left_alone_with_no_standings(self, fixture_at: FixtureFactory, side: SideFactory):
        """Distinct from a standing that has not decided the placing, which does empty the slot — `test_standings.py`'s."""

        spiele = [fixture_at(25, team1=side(1), quelle1={"type": "gruppe", "gruppe": "A", "platz": 1})]

        assert resolved(spiele) == {}

    def test_a_slot_with_no_source_is_never_touched(self, fixture_at: FixtureFactory, side: SideFactory):
        """Clearing the source is the manual override, and the only one."""

        spiele = [
            fixture_at(25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2"),
            fixture_at(29, team1=side(1), quelle1=None),
        ]

        assert resolved(spiele) == {}

    def test_a_source_naming_no_match_leaves_the_slot_alone(self, fixture_at: FixtureFactory, side: SideFactory):
        """A number that cannot be looked up is a data-entry mistake, unlike a match with no winner yet, which does empty the slot."""

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, team1=side(1), quelle1=sieger(99)),
        ]

        assert resolved(spiele) == {}

    def test_a_cyclic_chain_leaves_both_fixtures_alone(self, fixture_at: FixtureFactory, side: SideFactory):
        """A contradiction states no outcome, and must not send the resolution round the loop."""

        spiele = [
            fixture_at(29, team1=side(1), quelle1=sieger(30)),
            fixture_at(30, team1=side(2), quelle1=sieger(29)),
        ]

        assert resolved(spiele) == {}

    def test_a_fixture_naming_itself_leaves_its_slot_alone(self, fixture_at: FixtureFactory, side: SideFactory):
        assert resolved([fixture_at(29, team1=side(1), quelle1=sieger(29))]) == {}

    def test_a_fixture_downstream_of_a_cycle_is_left_alone_too(self, fixture_at: FixtureFactory, side: SideFactory):
        spiele = [
            fixture_at(29, quelle1=sieger(30)),
            fixture_at(30, quelle1=sieger(29)),
            fixture_at(31, team1=side(1), quelle1=sieger(29)),
        ]

        assert resolved(spiele) == {}

    def test_the_sibling_slot_of_an_unresolvable_one_still_resolves(self, fixture_at: FixtureFactory, side: SideFactory):
        """The guard is per side, not per match, and the unusable side is cyclic rather than dangling."""

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, quelle1=sieger(30), quelle2=sieger(25)),
            fixture_at(30, quelle1=sieger(29)),
        ]

        assert resolved(spiele) == {29: (None, "Team 1")}

    def test_a_fixture_never_becomes_a_team_against_itself(self, fixture_at: FixtureFactory, side: SideFactory):
        """Nothing downstream would refuse it: a validator carries no cross-field rule."""

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, quelle1=sieger(25), quelle2=sieger(25)),
        ]

        assert resolved(spiele) == {}

    def test_a_fixture_downstream_of_a_refused_collision_keeps_its_result(self, fixture_at: FixtureFactory, side: SideFactory):
        """Voiding the semi over a typo would erase a recorded result and empty the final; it is recorded as unmaintained instead."""

        # The typo: `quelle2` should be `sieger(27)`.
        typo = {"quelle1": sieger(25), "quelle2": sieger(25)}
        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(27, team1=side(3, 2), team2=side(4, 0), ergebnis="2:0"),
            fixture_at(29, team1=side(1, 1), team2=side(3, 0), ergebnis="1:0", saison_phase="halbfinale", **typo),
            fixture_at(31, team1=side(1, 2), team2=side(5, 0), quelle1=sieger(29), ergebnis="2:0", saison_phase="finale"),
        ]

        assert resolved(spiele) == {}

    def test_a_refused_collisions_stored_state_still_feeds_downstream(self, fixture_at: FixtureFactory, side: SideFactory):
        collision = {"quelle1": sieger(25), "quelle2": sieger(25)}
        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, team1=side(1, 1), team2=side(3, 0), ergebnis="1:0", saison_phase="halbfinale", **collision),
            # Holds the wrong club: the stored semi says Team 1 won.
            fixture_at(31, team1=side(9), quelle1=sieger(29), saison_phase="finale"),
        ]

        assert resolved(spiele) == {31: ("Team 1", None)}

    @pytest.mark.parametrize("mistake", ["dangling", "cycle", "self_reference", "duplicate_reference", "gruppe_without_standings"])
    def test_no_mistake_shape_moves_a_season_at_rest(self, fixture_at: FixtureFactory, side: SideFactory, mistake: str):
        """Each shape injected into one resolved bracket: nothing moves, downstream included — the class the per-fixture cases cannot see."""

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
        assert resolved([spiel()]) == {}

    def test_a_renamed_club_is_not_re_fanned_out_here(self, fixture_at: FixtureFactory, side: SideFactory):
        """Compared by id alone: comparing `name` here would duplicate `PATCH /teams/{team_id}`'s fan-out as a partial rename."""

        stale = side(1)
        stale["name"] = "Team 1, as it was called last season"

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, team1=stale, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {}


class TestNamingWhatWasVoided:
    """Both fill the same fields, so a report naming only the fixtures cannot tell a deleted scoreline from a slot that filled."""

    def test_a_slot_filling_from_empty_voids_nothing(self, fixture_at: FixtureFactory, side: SideFactory):
        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, quelle1=sieger(25)),
        ]
        (advancement,) = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements

        assert advancement.spiel_nr == 29
        assert advancement.voided_ergebnis is None
        assert advancement.voided_elfmeterschiessen is None

    def test_a_corrected_result_names_the_scoreline_it_destroys(self, fixture_at: FixtureFactory, side: SideFactory):
        spiele = [
            fixture_at(25, team1=side(1, 1), team2=side(2, 3), ergebnis="1:3"),
            fixture_at(29, team1=side(1, 2), team2=side(3, 0), ergebnis="2:0", quelle1=sieger(25)),
        ]
        (advancement,) = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements

        assert advancement.spiel_nr == 29
        assert advancement.voided_ergebnis == "2:0"

    def test_a_shoot_out_is_named_beside_the_goals_it_settled(self, fixture_at: FixtureFactory, side: SideFactory):
        """The shoot-out goes with the result (I25b), reported separately because it is stored separately."""

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
        spiele = [
            fixture_at(25, team1=side(1), team2=side(2)),
            fixture_at(29, team1=side(1, 2), team2=side(3, 0), ergebnis="2:0", quelle1=sieger(25)),
        ]
        (advancement,) = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements

        assert advancement.team1 is None
        assert advancement.voided_ergebnis == "2:0"


class TestReportingAFault:
    """Containment and reporting are separate properties, so every case pairs its fault with `resolved(...) == {}`."""

    def test_a_source_naming_no_match_is_reported(self, fixture_at: FixtureFactory, side: SideFactory):
        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, team1=side(1), quelle1=sieger(99)),
        ]

        assert faults(spiele) == [(29, "spiel_missing")]
        assert resolved(spiele) == {}

        # The `isinstance` is the assertion: another variant carries the wrong fields.
        reported = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).bracket_faults[0]
        assert isinstance(reported, FLBracketFaultQuelle)
        assert reported.quelle_spiel_nr == 99

    def test_every_fixture_a_cycle_reaches_is_reported(self, fixture_at: FixtureFactory, side: SideFactory):
        """A report naming only the loop leaves the third fixture unexplained."""

        spiele = [
            fixture_at(29, quelle1=sieger(30)),
            fixture_at(30, quelle1=sieger(29)),
            fixture_at(31, team1=side(1), quelle1=sieger(29)),
        ]

        assert faults(spiele) == [(29, "reference_cycle"), (30, "reference_cycle"), (31, "reference_cycle")]
        assert resolved(spiele) == {}

    def test_a_fixture_naming_itself_is_reported(self, fixture_at: FixtureFactory, side: SideFactory):
        assert faults([fixture_at(29, team1=side(1), quelle1=sieger(29))]) == [(29, "reference_cycle")]

    def test_two_sources_resolving_to_one_club_are_reported(self, fixture_at: FixtureFactory, side: SideFactory):
        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, quelle1=sieger(25), quelle2=sieger(25)),
        ]

        assert faults(spiele) == [(29, "same_team")]
        assert resolved(spiele) == {}

    def test_a_manual_side_colliding_with_a_maintained_one_is_reported(self, fixture_at: FixtureFactory, side: SideFactory):
        """The one fault the write path cannot refuse: `find_wiring_refusal` guards only a side a source maintains."""

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, team1=side(1), quelle1=None, quelle2=sieger(25)),
        ]

        assert faults(spiele) == [(29, "same_team")]
        assert resolved(spiele) == {}

    def test_a_collision_already_stored_is_reported_on_a_pass_that_moves_nothing(self, fixture_at: FixtureFactory, side: SideFactory):
        """The report must not key on the containment guard: a fixture already at rest would hide its fault forever."""

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, team1=side(1), team2=side(1), quelle2=sieger(25)),
        ]

        assert faults(spiele) == [(29, "same_team")]
        assert resolved(spiele) == {}

    def test_two_hand_set_sides_holding_one_club_are_not_a_wiring_fault(self, fixture_at: FixtureFactory, side: SideFactory):
        """Widening this would fill a list an admin reads as being about references."""

        assert faults([fixture_at(29, team1=side(1), team2=side(1))]) == []

    def test_a_season_at_rest_reports_nothing(self, fixture_at: FixtureFactory, side: SideFactory):
        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(27, team1=side(3, 2), team2=side(4, 0), ergebnis="2:0"),
            fixture_at(
                29, team1=side(1, 1), team2=side(3, 0), quelle1=sieger(25), quelle2=sieger(27), ergebnis="1:0", saison_phase="halbfinale"
            ),
            fixture_at(31, team1=side(1), quelle1=sieger(29), saison_phase="finale"),
        ]

        assert faults(spiele) == []
