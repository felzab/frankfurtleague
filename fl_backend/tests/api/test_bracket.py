from collections.abc import Callable, Mapping
from typing import Any, get_args

import pytest

from app.api.spiele.schemas import FLBracketFaultQuelle, FLBracketFaultSlot, FLSpielListAdapter
from app.api.spiele.services import find_gruppen_not_run, resolve_bracket
from app.api.teams.services import DecidedStanding
from app.shared.schemas.literals import FLGruppenNames, FLSonderereignis

MATCH_ID = "6890a1b2c3d4e5f60718{:04d}"
BRACKET_TEAM_ID = "6890a1b2c3d4e5f60719{:04d}"

# Duplicated rather than imported: `--import-mode=importlib` is why `conftest.py` shares helpers as
# fixtures, and one alias is not worth the exception.
PayloadFactory = Callable[..., dict[str, Any]]
SideFactory = Callable[..., dict[str, Any]]
SpielFactory = Callable[..., dict[str, Any]]


def sieger(spiel_nr: int) -> dict[str, Any]:
    return {"type": "spiel", "spiel_nr": spiel_nr, "ausgang": "sieger"}


def gruppenplatz(gruppe: str, platz: int) -> dict[str, Any]:
    return {"type": "gruppe", "gruppe": gruppe, "platz": platz}


Standings = Mapping[FLGruppenNames, DecidedStanding]


def resolved(documents: list[dict[str, Any]], standings: Standings | None = None) -> dict[int, tuple[str | None, str | None]]:
    """Match-fed unless a case hands in a standing; which team a placing resolves to is `test_standings.py`'s.

    Each advanced side by the name its club is known under here: a resolution moves a team id, whose name a read joins.
    """

    resolution = resolve_bracket(FLSpielListAdapter.validate_python(documents), standings or {})
    names = {
        **{
            str(side["team_id"]): side["name"]
            for document in documents
            for side in (document["team1"], document["team2"])
            if side and "name" in side
        },
        **{str(team.id): team.name for standing in (standings or {}).values() for team in standing.by_platz.values()},
    }

    return {
        advancement.spiel_nr: (
            names[str(advancement.team1.team_id)] if advancement.team1 is not None else None,
            names[str(advancement.team2.team_id)] if advancement.team2 is not None else None,
        )
        for advancement in resolution.advancements
    }


def faults(documents: list[dict[str, Any]], standings: Standings | None = None) -> list[tuple[int, str]]:
    resolution = resolve_bracket(FLSpielListAdapter.validate_python(documents), standings or {})

    return [(fault.spiel_nr, fault.reason) for fault in resolution.bracket_faults]


@pytest.fixture
def side(spiel_team_field: PayloadFactory) -> SideFactory:
    """Seeds stay single-digit: `shorthand` is exactly two characters."""

    def make(seed: int, tore: int | None = None) -> dict[str, Any]:
        return spiel_team_field(
            team_id=BRACKET_TEAM_ID.format(seed), name=f"Team {seed}", shorthand=f"T{chr(65 + seed // 26)}{chr(65 + seed % 26)}", tore=tore
        )

    return make


def drawn_phase(nr: int) -> str:
    """The round a real draw gives this number.

    `spiel_nr` ascends through the rounds, so a feeder numbered below its slot is in a strictly
    earlier one -- which is what an edge into a bracket slot must be.
    """

    if nr <= 28:
        return "viertelfinale"

    return "halbfinale" if nr <= 30 else "finale"


@pytest.fixture
def spiel_at(spiel: PayloadFactory) -> SpielFactory:
    def make(
        nr: int,
        *,
        team1: dict[str, Any] | None = None,
        team2: dict[str, Any] | None = None,
        quelle1: dict[str, Any] | None = None,
        quelle2: dict[str, Any] | None = None,
        ergebnis: str | None = None,
        # Declared, not left to `**overrides`: that would pass `saison_phase` twice. A case about the
        # phase rule itself passes one, and every other takes the round its number was drawn into.
        saison_phase: str | None = None,
        **overrides: Any,
    ) -> dict[str, Any]:
        return spiel(
            _id=MATCH_ID.format(nr),
            spiel_nr=nr,
            saison_phase=saison_phase or drawn_phase(nr),
            team1=team1,
            team2=team2,
            team1_quelle=quelle1,
            team2_quelle=quelle2,
            ergebnis=ergebnis,
            **overrides,
        )

    return make


class TestResolveBracket:
    def test_advances_every_played_match_at_once(self, spiel_at: SpielFactory, side: SideFactory):
        spiele = [
            spiel_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            spiel_at(26, team1=side(3), team2=side(4)),
            spiel_at(27, team1=side(5), team2=side(6)),
            spiel_at(28, team1=side(7, 0), team2=side(8, 2), ergebnis="0:2"),
            spiel_at(29, quelle1=sieger(25), quelle2=sieger(27)),
            spiel_at(30, quelle1=sieger(26), quelle2=sieger(28)),
            spiel_at(31, quelle1=sieger(29), quelle2=sieger(30)),
        ]

        assert resolved(spiele) == {29: ("Team 1", None), 30: (None, "Team 8")}

    def test_the_advanced_team_arrives_with_no_goals(self, spiel_at: SpielFactory, side: SideFactory):
        spiele = [
            spiel_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            spiel_at(29, quelle1=sieger(25)),
        ]
        advancement = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements[0]

        assert advancement.team1 is not None
        assert advancement.team1.tore is None

    def test_a_corrected_result_reaches_the_final(self, spiel_at: SpielFactory, side: SideFactory):
        """Correcting 25 voids the semi's result — a side no longer in it scored those goals — so the final empties too."""

        spiele = [
            spiel_at(25, team1=side(1, 1), team2=side(2, 3), ergebnis="1:3"),
            spiel_at(27, team1=side(5, 4), team2=side(6, 0), ergebnis="4:0"),
            spiel_at(29, team1=side(1, 2), team2=side(5, 0), quelle1=sieger(25), quelle2=sieger(27), ergebnis="2:0"),
            spiel_at(31, team1=side(1), quelle1=sieger(29)),
        ]

        assert resolved(spiele) == {29: ("Team 2", "Team 5"), 31: (None, None)}

    def test_the_voided_spiel_keeps_neither_sides_goals(self, spiel_at: SpielFactory, side: SideFactory):
        """Both sides lose their goals: goals with no result is a shape the write path refuses."""

        spiele = [
            spiel_at(25, team1=side(1, 1), team2=side(2, 3), ergebnis="1:3"),
            spiel_at(27, team1=side(5, 4), team2=side(6, 0), ergebnis="4:0"),
            spiel_at(29, team1=side(1, 2), team2=side(5, 0), quelle1=sieger(25), quelle2=sieger(27), ergebnis="2:0"),
        ]
        advancement = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements[0]

        assert advancement.team1 is not None and advancement.team1.tore is None
        assert advancement.team2 is not None and advancement.team2.tore is None

    def test_a_deleted_result_empties_the_slot_again(self, spiel_at: SpielFactory, side: SideFactory):
        spiele = [
            spiel_at(25, team1=side(1), team2=side(2)),
            spiel_at(29, team1=side(1), quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {29: (None, None)}

    def test_a_second_pass_over_its_own_output_writes_nothing(self, spiel_at: SpielFactory, side: SideFactory):
        """Writes applied as `crud.py` does, then re-run: a resolver that appended rather than recomputed fails only here."""

        spiele = [
            spiel_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            spiel_at(29, quelle1=sieger(25)),
            spiel_at(31, team1=side(2), quelle1=sieger(29)),
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

    def test_a_resolved_spiel_keeps_its_own_result(self, spiel_at: SpielFactory, side: SideFactory):
        spiele = [
            spiel_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            spiel_at(27, team1=side(5, 4), team2=side(6, 0), ergebnis="4:0"),
            spiel_at(29, team1=side(1, 2), team2=side(5, 0), quelle1=sieger(25), quelle2=sieger(27), ergebnis="2:0"),
            spiel_at(31, quelle1=sieger(29)),
        ]

        assert resolved(spiele) == {31: ("Team 1", None)}

    def test_a_drawn_knockout_with_no_shootout_advances_nobody(self, spiel_at: SpielFactory, side: SideFactory):
        spiele = [
            spiel_at(25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2"),
            spiel_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {}

    def test_a_shootout_decides_a_level_knockout(self, spiel_at: SpielFactory, side: SideFactory):
        spiele = [
            spiel_at(25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2", elfmeterschiessen={"team1": 4, "team2": 3}),
            spiel_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {29: ("Team 1", None)}

    def test_a_shootout_also_decides_the_loser(self, spiel_at: SpielFactory, side: SideFactory):
        """Not redundant with the winner case: reading the higher count alone would pass that one."""

        spiele = [
            spiel_at(25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2", elfmeterschiessen={"team1": 4, "team2": 3}),
            spiel_at(29, quelle1={"type": "spiel", "spiel_nr": 25, "ausgang": "verlierer"}),
        ]

        assert resolved(spiele) == {29: ("Team 2", None)}

    def test_a_shootout_is_ignored_where_the_goals_already_decided_it(self, spiel_at: SpielFactory, side: SideFactory):
        """A hand edit only: `patch_spiel` discards it and no validator holds a cross-field rule. Reading it advances the loser."""

        spiele = [
            spiel_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1", elfmeterschiessen={"team1": 2, "team2": 4}),
            spiel_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {29: ("Team 1", None)}

    def test_a_shootout_on_a_group_spiel_advances_nobody(self, spiel_at: SpielFactory, side: SideFactory):
        """A group draw is final: advancing out of one would contradict the table, which scores it a point each."""

        spiele = [
            spiel_at(
                25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2", elfmeterschiessen={"team1": 4, "team2": 3}, saison_phase="gruppenphase"
            ),
            spiel_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {}

    def test_a_shootout_without_a_result_advances_nobody(self, spiel_at: SpielFactory, side: SideFactory):
        spiele = [
            spiel_at(25, team1=side(1), team2=side(2), ergebnis=None, elfmeterschiessen={"team1": 4, "team2": 3}),
            spiel_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {}

    @pytest.mark.parametrize("sonderereignis", get_args(FLSonderereignis.__value__))
    def test_a_result_advances_its_winner_whatever_the_event_says(self, spiel_at: SpielFactory, side: SideFactory, sonderereignis: str):
        """A forfeit counts, and `_outcome_of` reads no event, so the bracket follows the `ergebnis` the table scores.

        Only a hand edit reaches the two states barred from a result; this walk special-cases none.
        """

        spiele = [
            spiel_at(25, team1=side(1, 3), team2=side(2, 0), ergebnis="3:0", sonderereignis=sonderereignis),
            spiel_at(29, quelle1=sieger(25)),
        ]

        assert resolved(spiele) == {29: ("Team 1", None)}

    def test_a_group_seeded_slot_is_left_alone_with_no_standings(self, spiel_at: SpielFactory, side: SideFactory):
        """Distinct from a standing that has not decided the placing, which does empty the slot — `test_standings.py`'s."""

        spiele = [spiel_at(25, team1=side(1), quelle1=gruppenplatz("A", 1))]

        assert resolved(spiele) == {}

    def test_a_slot_with_no_source_is_never_touched(self, spiel_at: SpielFactory, side: SideFactory):
        """Clearing the source is the manual override, and the only one."""

        spiele = [
            spiel_at(25, team1=side(1, 2), team2=side(2, 2), ergebnis="2:2"),
            spiel_at(29, team1=side(1), quelle1=None),
        ]

        assert resolved(spiele) == {}

    def test_a_source_naming_no_match_leaves_the_slot_alone(self, spiel_at: SpielFactory, side: SideFactory):
        """A number that cannot be looked up is a data-entry mistake, unlike a match with no winner yet, which does empty the slot."""

        spiele = [
            spiel_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            spiel_at(29, team1=side(1), quelle1=sieger(99)),
        ]

        assert resolved(spiele) == {}

    def test_a_cyclic_chain_leaves_both_spiele_alone(self, spiel_at: SpielFactory, side: SideFactory):
        """A contradiction states no outcome, and must not send the resolution round the loop."""

        spiele = [
            spiel_at(29, team1=side(1), quelle1=sieger(30)),
            spiel_at(30, team1=side(2), quelle1=sieger(29)),
        ]

        assert resolved(spiele) == {}

    def test_a_spiel_downstream_of_a_cycle_is_left_alone_too(self, spiel_at: SpielFactory, side: SideFactory):
        spiele = [
            spiel_at(29, quelle1=sieger(30)),
            spiel_at(30, quelle1=sieger(29)),
            spiel_at(31, team1=side(1), quelle1=sieger(29)),
        ]

        assert resolved(spiele) == {}

    def test_the_sibling_slot_of_an_unresolvable_one_still_resolves(self, spiel_at: SpielFactory, side: SideFactory):
        """The guard is per side, not per match, and the unusable side is cyclic rather than dangling."""

        spiele = [
            spiel_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            spiel_at(29, quelle1=sieger(30), quelle2=sieger(25)),
            spiel_at(30, quelle1=sieger(29)),
        ]

        assert resolved(spiele) == {29: (None, "Team 1")}

    def test_a_spiel_never_becomes_a_team_against_itself(self, spiel_at: SpielFactory, side: SideFactory):
        """Nothing downstream would refuse it: the database holds no cross-field rule."""

        spiele = [
            spiel_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            spiel_at(29, quelle1=sieger(25), quelle2=sieger(25)),
        ]

        assert resolved(spiele) == {}

    def test_a_spiel_downstream_of_a_refused_collision_keeps_its_result(self, spiel_at: SpielFactory, side: SideFactory):
        """Voiding the semi over a typo would erase a recorded result and empty the final; it is recorded as unmaintained instead."""

        # The typo: `quelle2` should be `sieger(27)`.
        typo = {"quelle1": sieger(25), "quelle2": sieger(25)}
        spiele = [
            spiel_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            spiel_at(27, team1=side(3, 2), team2=side(4, 0), ergebnis="2:0"),
            spiel_at(29, team1=side(1, 1), team2=side(3, 0), ergebnis="1:0", saison_phase="halbfinale", **typo),
            spiel_at(31, team1=side(1, 2), team2=side(5, 0), quelle1=sieger(29), ergebnis="2:0", saison_phase="finale"),
        ]

        assert resolved(spiele) == {}

    def test_a_refused_collisions_stored_state_still_feeds_downstream(self, spiel_at: SpielFactory, side: SideFactory):
        collision = {"quelle1": sieger(25), "quelle2": sieger(25)}
        spiele = [
            spiel_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            spiel_at(29, team1=side(1, 1), team2=side(3, 0), ergebnis="1:0", saison_phase="halbfinale", **collision),
            # Holds the wrong club: the stored semi says Team 1 won.
            spiel_at(31, team1=side(9), quelle1=sieger(29), saison_phase="finale"),
        ]

        assert resolved(spiele) == {31: ("Team 1", None)}

    @pytest.mark.parametrize("mistake", ["dangling", "cycle", "self_reference", "duplicate_reference", "gruppe_without_standings"])
    def test_no_mistake_shape_moves_a_season_at_rest(self, spiel_at: SpielFactory, side: SideFactory, mistake: str):
        """Each shape injected into one resolved bracket: nothing moves, downstream included — the class the per-fixture cases cannot see."""

        def semi(quelle2: dict[str, Any]) -> dict[str, Any]:
            sides = {"team1": side(1, 1), "team2": side(3, 0)}
            return spiel_at(29, quelle1=sieger(25), quelle2=quelle2, ergebnis="1:0", saison_phase="halbfinale", **sides)

        spiele = [
            spiel_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            spiel_at(27, team1=side(3, 2), team2=side(4, 0), ergebnis="2:0"),
            semi(sieger(27)),
            spiel_at(31, team1=side(1), quelle1=sieger(29), saison_phase="finale"),
        ]

        gruppen_quelle = gruppenplatz("A", 1)
        match mistake:
            case "dangling":
                spiele[2] = semi(sieger(99))
            case "cycle":
                spiele += [
                    spiel_at(40, team1=side(5), quelle1=sieger(41), saison_phase="halbfinale"),
                    spiel_at(41, team1=side(6), quelle1=sieger(40), saison_phase="halbfinale"),
                    spiel_at(42, team1=side(5), quelle1=sieger(40), saison_phase="finale"),
                ]
            case "self_reference":
                spiele += [
                    spiel_at(40, team1=side(5, 2), team2=side(6, 0), quelle1=sieger(40), ergebnis="2:0", saison_phase="halbfinale"),
                    spiel_at(42, team1=side(5), quelle1=sieger(40), saison_phase="finale"),
                ]
            case "duplicate_reference":
                spiele[2] = semi(sieger(25))
            case "gruppe_without_standings":
                spiele[0] = spiel_at(25, team1=side(1, 3), team2=side(2, 1), quelle1=gruppen_quelle, ergebnis="3:1")

        assert resolved(spiele) == {}


class TestNamingWhatWasVoided:
    """Both fill the same fields, so a report naming only the fixtures cannot tell a deleted scoreline from a slot that filled."""

    def test_a_corrected_result_names_the_scoreline_it_destroys(self, spiel_at: SpielFactory, side: SideFactory):
        spiele = [
            spiel_at(25, team1=side(1, 1), team2=side(2, 3), ergebnis="1:3"),
            spiel_at(29, team1=side(1, 2), team2=side(3, 0), ergebnis="2:0", quelle1=sieger(25)),
        ]
        (advancement,) = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements

        assert advancement.spiel_nr == 29
        assert advancement.voided_ergebnis == "2:0"

    def test_a_shoot_out_is_named_beside_the_goals_it_settled(self, spiel_at: SpielFactory, side: SideFactory):
        """The shoot-out goes with the result, reported separately because it is stored separately."""

        spiele = [
            spiel_at(25, team1=side(1, 1), team2=side(2, 3), ergebnis="1:3"),
            spiel_at(
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

    @pytest.mark.parametrize(
        ("stored_event", "voided"),
        [
            ("nichtantreten_team1", "nichtantreten_team1"),
            ("nichtantreten_team2", "nichtantreten_team2"),
            ("abgebrochen", None),
            ("ausgefallen", None),
            (None, None),
        ],
    )
    def test_only_a_no_show_is_named_as_voided(self, spiel_at: SpielFactory, side: SideFactory, stored_event: str | None, voided: str | None):
        """A no-show names a side, so a replaced occupant leaves it describing nobody; an event naming no side survives."""

        spiele = [
            spiel_at(25, team1=side(1, 1), team2=side(2, 3), ergebnis="1:3"),
            spiel_at(29, team1=side(1, 0), team2=side(3, 3), ergebnis="0:3", quelle1=sieger(25), sonderereignis=stored_event),
        ]
        (advancement,) = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements

        assert advancement.voided_sonderereignis == voided

    def test_an_emptied_slot_still_names_what_it_held(self, spiel_at: SpielFactory, side: SideFactory):
        spiele = [
            spiel_at(25, team1=side(1), team2=side(2)),
            spiel_at(29, team1=side(1, 2), team2=side(3, 0), ergebnis="2:0", quelle1=sieger(25)),
        ]
        (advancement,) = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements

        assert advancement.team1 is None
        assert advancement.voided_ergebnis == "2:0"


class TestReportingAFault:
    """Containment and reporting are separate properties, so every case pairs its fault with `resolved(...) == {}`."""

    def test_a_source_naming_no_match_is_reported(self, spiel_at: SpielFactory, side: SideFactory):
        spiele = [
            spiel_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            spiel_at(29, team1=side(1), quelle1=sieger(99)),
        ]

        assert faults(spiele) == [(29, "spiel_missing")]
        assert resolved(spiele) == {}

        # The `isinstance` is the assertion: another variant carries the wrong fields.
        reported = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).bracket_faults[0]
        assert isinstance(reported, FLBracketFaultQuelle)
        assert reported.quelle_spiel_nr == 99

    def test_every_spiel_a_cycle_reaches_is_reported(self, spiel_at: SpielFactory, side: SideFactory):
        """A report naming only the loop leaves the third fixture unexplained."""

        spiele = [
            spiel_at(29, quelle1=sieger(30)),
            spiel_at(30, quelle1=sieger(29)),
            spiel_at(31, team1=side(1), quelle1=sieger(29)),
        ]

        assert faults(spiele) == [(29, "reference_cycle"), (30, "reference_cycle"), (31, "reference_cycle")]
        assert resolved(spiele) == {}

    def test_a_spiel_naming_itself_is_reported(self, spiel_at: SpielFactory, side: SideFactory):
        assert faults([spiel_at(29, team1=side(1), quelle1=sieger(29))]) == [(29, "reference_cycle")]

    def test_two_sources_resolving_to_one_club_are_reported(self, spiel_at: SpielFactory, side: SideFactory):
        spiele = [
            spiel_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            spiel_at(29, quelle1=sieger(25), quelle2=sieger(25)),
        ]

        assert faults(spiele) == [(29, "same_team")]
        assert resolved(spiele) == {}

    def test_a_manual_side_colliding_with_a_maintained_one_is_reported(self, spiel_at: SpielFactory, side: SideFactory):
        """The one fault the write path cannot refuse: `find_wiring_refusal` guards only a side a source maintains."""

        spiele = [
            spiel_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            spiel_at(29, team1=side(1), quelle1=None, quelle2=sieger(25)),
        ]

        assert faults(spiele) == [(29, "same_team")]
        assert resolved(spiele) == {}

    def test_a_collision_already_stored_is_reported_on_a_pass_that_moves_nothing(self, spiel_at: SpielFactory, side: SideFactory):
        """The report must not key on the containment guard: a fixture already at rest would hide its fault forever."""

        spiele = [
            spiel_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            spiel_at(29, team1=side(1), team2=side(1), quelle2=sieger(25)),
        ]

        assert faults(spiele) == [(29, "same_team")]
        assert resolved(spiele) == {}

    def test_a_reference_on_a_group_spiel_is_reported(self, spiel_at: SpielFactory, side: SideFactory):
        """Following it would rewrite the sides of a match the schedule drew and void its result."""

        spiele = [
            spiel_at(1, team1=side(1, 1), team2=side(2, 0), ergebnis="1:0", quelle1=sieger(25), saison_phase="gruppenphase"),
            spiel_at(25, team1=side(3, 2), team2=side(4, 1), ergebnis="2:1"),
        ]

        assert faults(spiele) == [(1, "gruppenphase_spiel_wired")]
        assert resolved(spiele) == {}

        # The variant carries the seat and the reference whole, which is what a toast has to name.
        reported = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).bracket_faults[0]
        assert isinstance(reported, FLBracketFaultSlot)
        assert (reported.side, reported.quelle.model_dump()) == ("team1", sieger(25))

    def test_a_source_in_the_group_phase_is_reported(self, spiel_at: SpielFactory, side: SideFactory):
        """A decided group match names a winner, so this seeds a bracket slot from the table's own answer."""

        spiele = [
            spiel_at(1, team1=side(1, 2), team2=side(2, 0), ergebnis="2:0", saison_phase="gruppenphase"),
            spiel_at(29, team1=side(3), quelle1=sieger(1)),
        ]

        assert faults(spiele) == [(29, "gruppenphase_feeder")]
        assert resolved(spiele) == {}

    @pytest.mark.parametrize("feeder_nr", [30, 31], ids=["same-round", "later-round"])
    def test_a_source_not_played_first_is_reported(self, spiel_at: SpielFactory, side: SideFactory, feeder_nr: int):
        """Both arms of the comparison, outside a cycle: the feeder references nothing back, so `reference_cycle` cannot cover either."""

        spiele = [
            spiel_at(29, team1=side(1), quelle1=sieger(feeder_nr)),
            spiel_at(feeder_nr, team1=side(2, 3), team2=side(3, 1), ergebnis="3:1"),
        ]

        assert faults(spiele) == [(29, "feeder_not_played_first")]
        assert resolved(spiele) == {}

    def test_a_source_feeding_two_spiele_is_reported_on_both(self, spiel_at: SpielFactory, side: SideFactory):
        """One entry per slot, as `fielded_twice` keeps: which fixture the outcome belongs to is a competition decision."""

        spiele = [
            spiel_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            spiel_at(29, team1=side(5), quelle1=sieger(25)),
            spiel_at(30, team1=side(6), quelle1=sieger(25)),
        ]

        assert faults(spiele) == [(29, "source_feeds_another_spiel"), (30, "source_feeds_another_spiel")]
        assert resolved(spiele) == {}

    def test_a_placing_seeding_a_later_round_is_reported(self, spiel_at: SpielFactory, side: SideFactory):
        """The season holds an earlier round, so this Finale slot is one a match feeds rather than a table."""

        spiele = [
            spiel_at(25, team1=side(1), team2=side(2)),
            spiel_at(31, team1=side(3), quelle1=gruppenplatz("A", 1)),
        ]
        standings: Standings = {"A": DecidedStanding(eligible=2, is_complete=False, by_platz={})}

        assert faults(spiele, standings) == [(31, "seed_past_the_opening_round")]
        assert resolved(spiele, standings) == {}

    def test_a_group_the_season_does_not_run_is_reported_as_that(self, spiel_at: SpielFactory, side: SideFactory):
        """Never as a table too short: the repair is the reference, where a short table's is the group's entrants."""

        spiele = [spiel_at(25, team1=side(1), quelle1=gruppenplatz("C", 1))]
        reported = find_gruppen_not_run(FLSpielListAdapter.validate_python(spiele), number_of_gruppen=2)

        assert [(fault.spiel_nr, fault.reason, fault.gruppe) for fault in reported] == [(25, "gruppe_not_run", "C")]

        # The division of labour: no standing reaches the walk for such a group, so nothing there can
        # report a size it was never given.
        assert faults(spiele) == []
