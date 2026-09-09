from typing import Any, Callable, Mapping, get_args

import pytest
from bson import ObjectId

from app.api.spiele.crud import report_advancement, report_prior_paarungen
from app.api.spiele.schemas import (
    FLBracketFaultQuelle,
    FLBracketFaultSlot,
    FLPatchSpielDataPayload,
    FLPatchSpielPaarungPayload,
    FLSonderereignis,
    FLSpiel,
    FLSpielListAdapter,
    FLSpielPriorOtherFields,
    FLSpielPriorPaarung,
    FLSpielReleasedSide,
    FLSpielRestorableField,
)
from app.api.spiele.services import find_gruppen_not_run, resolve_bracket
from app.api.teams.schemas import FLGruppenNames
from app.api.teams.services import DecidedStanding

MATCH_ID = "6890a1b2c3d4e5f60718{:04d}"
BRACKET_TEAM_ID = "6890a1b2c3d4e5f60719{:04d}"

# Duplicated rather than imported: `--import-mode=importlib` is why `conftest.py` shares helpers as
# fixtures, and one alias is not worth the exception.
PayloadFactory = Callable[..., dict[str, Any]]
SideFactory = Callable[..., dict[str, Any]]
FixtureFactory = Callable[..., dict[str, Any]]


def sieger(spiel_nr: int) -> dict[str, Any]:
    return {"type": "spiel", "spiel_nr": spiel_nr, "ausgang": "sieger"}


def gruppenplatz(gruppe: str, platz: int) -> dict[str, Any]:
    return {"type": "gruppe", "gruppe": gruppe, "platz": platz}


Standings = Mapping[FLGruppenNames, DecidedStanding]


def resolved(documents: list[dict[str, Any]], standings: Standings | None = None) -> dict[int, tuple[str | None, str | None]]:
    """Match-fed unless a case hands in a standing; which team a placing resolves to is `test_standings.py`'s."""

    resolution = resolve_bracket(FLSpielListAdapter.validate_python(documents), standings or {})

    return {
        advancement.spiel_nr: (
            advancement.team1.name if advancement.team1 is not None else None,
            advancement.team2.name if advancement.team2 is not None else None,
        )
        for advancement in resolution.advancements
    }


def faults(documents: list[dict[str, Any]], standings: Standings | None = None) -> list[tuple[int, str]]:
    resolution = resolve_bracket(FLSpielListAdapter.validate_python(documents), standings or {})

    return [(fault.spiel_nr, fault.reason) for fault in resolution.bracket_faults]


def stored_at(documents: list[dict[str, Any]], spiel_nr: int) -> FLSpiel:
    return next(spiel for spiel in FLSpielListAdapter.validate_python(documents) if spiel.spiel_nr == spiel_nr)


def priors(
    documents: list[dict[str, Any]],
    released: list[FLSpielReleasedSide] | None = None,
    edited: int = 25,
    wrote: Mapping[str, Any] | None = None,
) -> list[FLSpielPriorPaarung]:
    """Every fixture the resolution moves, off the slice it was judged on -- `documents` being both.

    `wrote` is what the save put on the fixture it named, and the releases are handed in because no
    resolution produces one.
    """

    season = FLSpielListAdapter.validate_python(documents)
    resolution = resolve_bracket(season, {})

    return report_prior_paarungen(
        ObjectId(MATCH_ID.format(edited)),
        season,
        stored_at(documents, edited).model_copy(update=dict(wrote or {})),
        [report_advancement(advancement) for advancement in resolution.advancements],
        released or [],
    )


def restore_of(prior: FLSpielPriorPaarung) -> FLPatchSpielPaarungPayload:
    """The report as the body sent back, `spiel_id` becoming the path segment -- the round trip the wire makes."""

    return FLPatchSpielPaarungPayload(**prior.model_dump(exclude={"spiel_id"}))


def a_release_of(spiel_nr: int, ergebnis: str | None = None) -> FLSpielReleasedSide:
    return FLSpielReleasedSide(
        spiel_id=ObjectId(MATCH_ID.format(spiel_nr)),
        spiel_nr=spiel_nr,
        side="team1",
        team_name="Team 1",
        voided_ergebnis=ergebnis,
        voided_elfmeterschiessen=None,
        voided_sonderereignis=None,
    )


@pytest.fixture
def side(spiel_team_field: PayloadFactory) -> SideFactory:
    """Seeds stay single-digit: `shorthand` is exactly two characters."""

    def make(seed: int, tore: int | None = None) -> dict[str, Any]:
        return spiel_team_field(team_id=BRACKET_TEAM_ID.format(seed), name=f"Team {seed}", shorthand=f"T{seed}", tore=tore)

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
def fixture_at(spiel: PayloadFactory) -> FixtureFactory:
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

        spiele = [fixture_at(25, team1=side(1), quelle1=gruppenplatz("A", 1))]

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

        gruppen_quelle = gruppenplatz("A", 1)
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
    def test_only_a_no_show_is_named_as_voided(
        self, fixture_at: FixtureFactory, side: SideFactory, stored_event: str | None, voided: str | None
    ):
        """A no-show names a side, so a replaced occupant leaves it describing nobody; an event naming no side survives."""

        spiele = [
            fixture_at(25, team1=side(1, 1), team2=side(2, 3), ergebnis="1:3"),
            fixture_at(29, team1=side(1, 0), team2=side(3, 3), ergebnis="0:3", quelle1=sieger(25), sonderereignis=stored_event),
        ]
        (advancement,) = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).advancements

        assert advancement.voided_sonderereignis == voided

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

    def test_a_reference_on_a_group_fixture_is_reported(self, fixture_at: FixtureFactory, side: SideFactory):
        """Following it would rewrite the sides of a match the schedule drew and void its result."""

        spiele = [
            fixture_at(1, team1=side(1, 1), team2=side(2, 0), ergebnis="1:0", quelle1=sieger(25), saison_phase="gruppenphase"),
            fixture_at(25, team1=side(3, 2), team2=side(4, 1), ergebnis="2:1"),
        ]

        assert faults(spiele) == [(1, "gruppenphase_fixture_wired")]
        assert resolved(spiele) == {}

        # The variant carries the seat and the reference whole, which is what a toast has to name.
        reported = resolve_bracket(FLSpielListAdapter.validate_python(spiele), {}).bracket_faults[0]
        assert isinstance(reported, FLBracketFaultSlot)
        assert (reported.side, reported.quelle.model_dump()) == ("team1", sieger(25))

    def test_a_source_in_the_group_phase_is_reported(self, fixture_at: FixtureFactory, side: SideFactory):
        """A decided group match names a winner, so this seeds a bracket slot from the table's own answer."""

        spiele = [
            fixture_at(1, team1=side(1, 2), team2=side(2, 0), ergebnis="2:0", saison_phase="gruppenphase"),
            fixture_at(29, team1=side(3), quelle1=sieger(1)),
        ]

        assert faults(spiele) == [(29, "gruppenphase_feeder")]
        assert resolved(spiele) == {}

    @pytest.mark.parametrize("feeder_nr", [30, 31], ids=["same-round", "later-round"])
    def test_a_source_not_played_first_is_reported(self, fixture_at: FixtureFactory, side: SideFactory, feeder_nr: int):
        """Both arms of the comparison, outside a cycle: the feeder references nothing back, so `reference_cycle` cannot cover either."""

        spiele = [
            fixture_at(29, team1=side(1), quelle1=sieger(feeder_nr)),
            fixture_at(feeder_nr, team1=side(2, 3), team2=side(3, 1), ergebnis="3:1"),
        ]

        assert faults(spiele) == [(29, "feeder_not_played_first")]
        assert resolved(spiele) == {}

    def test_a_source_feeding_two_fixtures_is_reported_on_both(self, fixture_at: FixtureFactory, side: SideFactory):
        """One entry per slot, as `fielded_twice` keeps: which fixture the outcome belongs to is a competition decision."""

        spiele = [
            fixture_at(25, team1=side(1, 3), team2=side(2, 1), ergebnis="3:1"),
            fixture_at(29, team1=side(5), quelle1=sieger(25)),
            fixture_at(30, team1=side(6), quelle1=sieger(25)),
        ]

        assert faults(spiele) == [(29, "source_feeds_another_fixture"), (30, "source_feeds_another_fixture")]
        assert resolved(spiele) == {}

    def test_a_placing_seeding_a_later_round_is_reported(self, fixture_at: FixtureFactory, side: SideFactory):
        """The season holds an earlier round, so this Finale slot is one a match feeds rather than a table."""

        spiele = [
            fixture_at(25, team1=side(1), team2=side(2)),
            fixture_at(31, team1=side(3), quelle1=gruppenplatz("A", 1)),
        ]
        standings: Standings = {"A": DecidedStanding(eligible=2, is_complete=False, by_platz={})}

        assert faults(spiele, standings) == [(31, "seed_past_the_opening_round")]
        assert resolved(spiele, standings) == {}

    def test_a_group_the_season_does_not_run_is_reported_as_that(self, fixture_at: FixtureFactory, side: SideFactory):
        """Never as a table too short: the repair is the reference, where a short table's is the group's entrants."""

        spiele = [fixture_at(25, team1=side(1), quelle1=gruppenplatz("C", 1))]
        reported = find_gruppen_not_run(FLSpielListAdapter.validate_python(spiele), number_of_groups=2)

        assert [(fault.spiel_nr, fault.reason, fault.gruppe) for fault in reported] == [(25, "gruppe_not_run", "C")]

        # The division of labour: no standing reaches the walk for such a group, so nothing there can
        # report a size it was never given.
        assert faults(spiele) == []

    def test_a_group_inside_the_seasons_count_is_reported_by_nobody(self, fixture_at: FixtureFactory, side: SideFactory):
        """The bound is the season's own count rather than the closed letter set, so C on a four-group season is wired legally."""

        spiele = [fixture_at(25, team1=side(1), quelle1=gruppenplatz("C", 1))]

        assert find_gruppen_not_run(FLSpielListAdapter.validate_python(spiele), number_of_groups=4) == []

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


class TestPuttingBackWhatTheResolutionDestroyed:
    """The undo's whole input. `TestNamingWhatWasVoided`'s report says what went; this one says what it takes to put it back."""

    def moved_by_a_corrected_feeder(self, fixture_at: FixtureFactory, side: SideFactory, **overrides: Any) -> list[dict[str, Any]]:
        """Spiel 29 holds seed 1 while its source hands it seed 2, which is the disagreement a resolution rewrites."""

        return [
            fixture_at(25, team1=side(1, 1), team2=side(2, 3), ergebnis="1:3"),
            fixture_at(29, team1=side(1, 2), team2=side(3, 0), ergebnis="2:0", quelle1=sieger(25), **overrides),
        ]

    def test_a_replaced_occupant_is_named_with_the_goals_it_scored(self, fixture_at: FixtureFactory, side: SideFactory):
        """Both sides, never the one that moved: the rewrite takes the counterpart's goals with the scoreline."""

        _, prior = priors(self.moved_by_a_corrected_feeder(fixture_at, side))

        assert str(prior.spiel_id) == MATCH_ID.format(29)
        assert prior.team1 is not None and prior.team2 is not None
        assert (str(prior.team1.team_id), prior.team1.tore) == (BRACKET_TEAM_ID.format(1), 2)
        assert (str(prior.team2.team_id), prior.team2.tore) == (BRACKET_TEAM_ID.format(3), 0)

    def test_an_event_the_rewrite_leaves_standing_travels_back_all_the_same(self, fixture_at: FixtureFactory, side: SideFactory):
        """`voided_sonderereignis` is null here, so a restore built from that field alone would clear an abandonment nobody touched."""

        _, prior = priors(self.moved_by_a_corrected_feeder(fixture_at, side, sonderereignis="abgebrochen"))

        assert prior.sonderereignis == "abgebrochen"

    def test_a_shoot_out_travels_back_beside_the_goals_that_needed_it(self, fixture_at: FixtureFactory, side: SideFactory):
        spiele = self.moved_by_a_corrected_feeder(fixture_at, side)
        spiele[1] |= {"team2": side(3, 2), "ergebnis": "2:2", "elfmeterschiessen": {"team1": 4, "team2": 3}}

        _, prior = priors(spiele)

        assert prior.elfmeterschiessen is not None
        assert (prior.elfmeterschiessen.team1, prior.elfmeterschiessen.team2) == (4, 3)

    def test_a_fixture_both_reports_name_is_reported_once(self, fixture_at: FixtureFactory, side: SideFactory):
        """A release is written before the resolution reads, so two entries would restore the fixture twice and the later one would win."""

        reported = priors(self.moved_by_a_corrected_feeder(fixture_at, side), [a_release_of(29, ergebnis="2:0")])

        assert [str(prior.spiel_id) for prior in reported] == [MATCH_ID.format(25), MATCH_ID.format(29)]

    def test_a_slice_missing_a_moved_fixture_is_refused(self, fixture_at: FixtureFactory, side: SideFactory):
        """A restore silently short of one fixture is the failure this refusal exists for -- `docs/backend/spec.md :: I108`'s reading."""

        with pytest.raises(ValueError, match="does not hold every fixture"):
            priors(self.moved_by_a_corrected_feeder(fixture_at, side), [a_release_of(31)])

    def test_the_fixture_the_request_named_leads_the_report_and_appears_once(self, fixture_at: FixtureFactory, side: SideFactory):
        """Restoring it runs the resolution that refills the moved slots, so an entry after those would be written over."""

        reported = priors(self.moved_by_a_corrected_feeder(fixture_at, side), [a_release_of(29, ergebnis="2:0")], edited=29)

        assert [str(prior.spiel_id) for prior in reported] == [MATCH_ID.format(29)]

    def test_a_write_that_moved_nothing_beyond_the_paarung_names_nothing_beyond_it(self, fixture_at: FixtureFactory, side: SideFactory):
        """The null is what tells a reader to leave those fields alone; an empty list would read as the same answer twice."""

        named, moved = priors(self.moved_by_a_corrected_feeder(fixture_at, side))

        assert (named.other_fields, moved.other_fields) == (None, None)

    def test_only_the_field_the_write_replaced_is_named_and_it_carries_the_replaced_value(self, fixture_at: FixtureFactory, side: SideFactory):
        """The window this entry closes: a payload naming a field nobody moved reverts whoever moved it after the save."""

        spiele = self.moved_by_a_corrected_feeder(fixture_at, side)
        spiele[0] |= {"notiz": "Kunstrasen"}

        named, _ = priors(spiele, wrote={"notiz": "Platz getauscht"})

        assert named.other_fields is not None
        assert named.other_fields.replaced == ["notiz"]
        assert named.other_fields.notiz == "Kunstrasen"

    def test_a_venue_renamed_since_the_save_is_no_field_this_write_replaced(self, fixture_at: FixtureFactory, side: SideFactory):
        """The comparison reads the ids and the money a payload names: a composed name moving would restore a booking nobody changed."""

        spiele = self.moved_by_a_corrected_feeder(fixture_at, side)
        stored = stored_at(spiele, 25)
        assert stored.ort is not None

        named, _ = priors(spiele, wrote={"ort": stored.ort.model_copy(update={"name": "Halle Süd"})})

        assert named.other_fields is None

    def test_completing_a_restore_writes_what_the_report_names_and_leaves_what_it_does_not(self, fixture_at: FixtureFactory, side: SideFactory):
        """The narrowing itself, on the fixture the request named: a value moved after the save survives its undo."""

        spiele = self.moved_by_a_corrected_feeder(fixture_at, side)
        spiele[0] |= {"notiz": "Kunstrasen"}
        named, _ = priors(spiele, wrote={"notiz": "Platz getauscht"})

        # The fixture as the save left it, plus a date somebody moved since — a field that save never touched.
        now = stored_at(spiele, 25).model_copy(update={"notiz": "Platz getauscht", "datum": "2026-04-02"})

        payload = restore_of(named).completed_with(now)

        assert payload.notiz == "Kunstrasen"
        assert payload.datum == "2026-04-02"

    def test_completing_a_restore_leaves_every_field_the_rewrite_never_reached(self, fixture_at: FixtureFactory, side: SideFactory):
        """The narrowing on a MOVED fixture, which names no field beyond its Paarung: a note added after the save survives."""

        spiele = self.moved_by_a_corrected_feeder(fixture_at, side)
        _, prior = priors(spiele)

        stored = stored_at(spiele, 29)
        # The fixture as the save left it, plus a note written since: the slot emptied, the scoreline gone.
        now = stored.model_copy(update={"team1": None, "ergebnis": None, "notiz": "Platz getauscht"})

        payload = restore_of(prior).completed_with(now)

        assert payload.team1 is not None and str(payload.team1.team_id) == BRACKET_TEAM_ID.format(1)
        assert payload.notiz == "Platz getauscht"
        assert (payload.datum, payload.uhrzeit) == (now.datum, now.uhrzeit)
        assert payload.team1_quelle == now.team1_quelle
        assert now.ort is not None and payload.ort is not None and payload.ort.mietpreis == now.ort.mietpreis
        assert now.schiedsrichter is not None and payload.schiedsrichter is not None
        assert payload.schiedsrichter.payment == now.schiedsrichter.payment

    def test_the_two_halves_name_every_field_the_wholesale_payload_takes(self):
        """A field added to that payload and to neither half here is written by a save and put back by no undo."""

        paarung = set(FLPatchSpielPaarungPayload.model_fields) - {"other_fields"}
        beyond = set(get_args(FLSpielRestorableField))

        assert set(FLPatchSpielDataPayload.model_fields) == paarung | beyond
        assert set(FLSpielPriorOtherFields.model_fields) - {"replaced"} == beyond
