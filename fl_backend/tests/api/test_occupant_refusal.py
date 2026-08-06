"""
The write path's occupant rules, and the payload normalisation both of its paths share.

Three pure functions, so every case runs in the default tier with no container:

- `apply_payload_to_spiel` — the normalisation the save and the `dry_run=true` preview both apply
  (ADR-0051). Tested here because a drift between the two would be invisible everywhere else: both
  would simply agree on the wrong answer.
- `find_eligibility_refusal` — a disqualified team, and a team with no row for the season (ADR-0052).
- `judge_spieltag_occupancy` — a team fielded twice on one matchday, moved or refused (ADR-0052).

Refusals are asserted on their CODE, never on their message. The code is the API contract and is what
the form reads to decide which field the message belongs to; the message is an English log detail and
these tests must not break over its phrasing.

The season under test is one Spieltag of two group fixtures plus a second Spieltag holding the
knockout round, which is the smallest shape in which "same matchday" and "different matchday" are both
expressible.
"""

from typing import Any, Callable

import pytest
from bson import ObjectId

from app.api.spiele.schemas import FLPatchSpielDataPayload, FLSpiel, FLSpielListAdapter
from app.api.spiele.services import (
    ELIGIBILITY_DISQUALIFIED,
    ELIGIBILITY_NO_MEMBERSHIP,
    SPIELTAG_OCCUPIED,
    apply_payload_to_spiel,
    find_eligibility_refusal,
    judge_spieltag_occupancy,
)

MATCH_ID = "6890a1b2c3d4e5f60720{:04d}"
SPIELTAG_ONE = "6890a1b2c3d4e5f607210001"
SPIELTAG_TWO = "6890a1b2c3d4e5f607210002"

# Four clubs, so a clash can be built without reusing the id that stands for "the team under test".
ADLER = "6890a1b2c3d4e5f607220001"
BIEBER = "6890a1b2c3d4e5f607220002"
CRONBERG = "6890a1b2c3d4e5f607220003"
DORNBUSCH = "6890a1b2c3d4e5f607220004"

PayloadFactory = Callable[..., dict[str, Any]]


def team(team_id: str, name: str, tore: int | None = None) -> dict[str, Any]:
    return {"team_id": team_id, "name": name, "tore": tore, "shorthand": name[:2].upper()}


def sieger(spiel_nr: int) -> dict[str, Any]:
    return {"type": "spiel", "spiel_nr": spiel_nr, "ausgang": "sieger"}


@pytest.fixture
def fixture_at(spiel: PayloadFactory) -> Callable[..., dict[str, Any]]:
    """One match of the season, keyed by `spiel_nr`, with an id derived from it."""

    def make(nr: int, phase: str, spieltag_id: str, **overrides: Any) -> dict[str, Any]:
        # `ergebnis` defaults to unplayed and is overridable, so a caller can give one fixture a stored
        # result without the two spellings colliding.
        return spiel(_id=MATCH_ID.format(nr), spiel_nr=nr, saison_phase=phase, spieltag_id=spieltag_id, **{"ergebnis": None, **overrides})

    return make


@pytest.fixture
def season(fixture_at: Callable[..., dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Two group fixtures on one Spieltag, and two knockouts on another.

    Spiel 2 carries a stored result, so releasing a side of it is a release that destroys something —
    the case the report exists for.
    """

    return [
        fixture_at(1, "gruppenphase", SPIELTAG_ONE, team1=team(ADLER, "Adler"), team2=team(BIEBER, "Bieber")),
        fixture_at(
            2,
            "gruppenphase",
            SPIELTAG_ONE,
            team1=team(CRONBERG, "Cronberg", tore=3),
            team2=team(DORNBUSCH, "Dornbusch", tore=1),
            ergebnis="3:1",
        ),
        fixture_at(29, "halbfinale", SPIELTAG_TWO, team1=team(ADLER, "Adler"), team2=None, team1_quelle=None, team2_quelle=sieger(1)),
        fixture_at(30, "halbfinale", SPIELTAG_TWO, team1=None, team2=None, team1_quelle=None, team2_quelle=None),
    ]


def payload_for(season_docs: list[dict[str, Any]], nr: int, **overrides: Any) -> FLPatchSpielDataPayload:
    """
    An edit of match `nr`, built as "everything as stored, plus `overrides`" — what the form submits.

    That base makes the no-op case the default: a test overriding nothing asserts that resubmitting a
    fixture unchanged is always legal, which is the clause every occupant rule turns on.
    """

    stored = next(doc for doc in season_docs if doc["spiel_nr"] == nr)

    return FLPatchSpielDataPayload.model_validate(
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
            **overrides,
        }
    )


def eligibility_for(season_docs: list[dict[str, Any]], nr: int, membership: dict[str, bool], **overrides: Any) -> str | None:
    """The eligibility refusal's CODE for an edit of match `nr`, or `None` when it is legal."""

    stored = next(doc for doc in season_docs if doc["spiel_nr"] == nr)
    refusal = find_eligibility_refusal(
        ObjectId(stored["_id"]),
        payload_for(season_docs, nr, **overrides),
        FLSpielListAdapter.validate_python(season_docs),
        {ObjectId(team_id): disqualified for team_id, disqualified in membership.items()},
    )

    return None if refusal is None else refusal.error_code


def occupancy_for(season_docs: list[dict[str, Any]], nr: int, **overrides: Any):
    """The Spieltag verdict for an edit of match `nr`."""

    stored = next(doc for doc in season_docs if doc["spiel_nr"] == nr)

    return judge_spieltag_occupancy(
        ObjectId(stored["_id"]),
        payload_for(season_docs, nr, **overrides),
        FLSpielListAdapter.validate_python(season_docs),
    )


# Every club in the season, none disqualified — the base each eligibility case departs from.
ALL_ELIGIBLE = {ADLER: False, BIEBER: False, CRONBERG: False, DORNBUSCH: False}


class TestApplyingThePayload:
    """The normalisation, which is the one thing the preview and the save must never do differently."""

    def test_ergebnis_is_derived_from_the_two_goal_counts(self, season):
        patched = apply_payload_to_spiel(
            FLSpiel.model_validate(season[0]),
            payload_for(season, 1, team1=team(ADLER, "Adler", tore=4), team2=team(BIEBER, "Bieber", tore=2)),
        )

        assert patched.ergebnis == "4:2"

    def test_an_unresolved_side_strips_the_other_sides_goals(self, season):
        """One side empty means the fixture has no result, so the goals the other side holds go too."""
        patched = apply_payload_to_spiel(
            FLSpiel.model_validate(season[0]),
            payload_for(season, 1, team1=team(ADLER, "Adler", tore=4), team2=None),
        )

        assert patched.ergebnis is None
        assert patched.team1 is not None and patched.team1.tore is None

    def test_a_shoot_out_is_discarded_on_a_group_fixture(self, season):
        """A group draw is a final result and has no tie to break (ADR-0044)."""
        patched = apply_payload_to_spiel(
            FLSpiel.model_validate(season[0]),
            payload_for(
                season,
                1,
                team1=team(ADLER, "Adler", tore=2),
                team2=team(BIEBER, "Bieber", tore=2),
                elfmeterschiessen={"team1": 4, "team2": 3},
            ),
        )

        assert patched.ergebnis == "2:2"
        assert patched.elfmeterschiessen is None

    def test_a_shoot_out_is_discarded_when_the_goals_already_decided_it(self, season):
        patched = apply_payload_to_spiel(
            FLSpiel.model_validate(season[2]),
            payload_for(
                season,
                29,
                team1=team(ADLER, "Adler", tore=3),
                team2=team(BIEBER, "Bieber", tore=1),
                elfmeterschiessen={"team1": 4, "team2": 3},
            ),
        )

        assert patched.elfmeterschiessen is None

    def test_a_shoot_out_survives_a_level_knockout(self, season):
        """The one shape it can describe, and the only one it is kept on."""
        patched = apply_payload_to_spiel(
            FLSpiel.model_validate(season[2]),
            payload_for(
                season,
                29,
                team1=team(ADLER, "Adler", tore=2),
                team2=team(BIEBER, "Bieber", tore=2),
                elfmeterschiessen={"team1": 4, "team2": 3},
            ),
        )

        assert patched.elfmeterschiessen is not None
        assert patched.elfmeterschiessen.team1 == 4

    def test_the_fixtures_own_identity_is_never_taken_from_the_payload(self, season):
        """`spiel_nr`, `spieltag_id`, `saison_id` and `saison_phase` are on no payload and survive."""
        stored = FLSpiel.model_validate(season[1])
        patched = apply_payload_to_spiel(stored, payload_for(season, 2, datum=None))

        assert (patched.spiel_nr, patched.spieltag_id, patched.saison_id, patched.saison_phase) == (
            stored.spiel_nr,
            stored.spieltag_id,
            stored.saison_id,
            stored.saison_phase,
        )


class TestEligibility:
    """A team the season records as unable to be there (ADR-0052)."""

    def test_saving_a_fixture_unchanged_is_legal(self, season):
        assert eligibility_for(season, 1, ALL_ELIGIBLE) is None

    def test_newly_fielding_a_disqualified_team_is_refused(self, season):
        assert eligibility_for(season, 30, {**ALL_ELIGIBLE, CRONBERG: True}, team1=team(CRONBERG, "Cronberg")) == ELIGIBILITY_DISQUALIFIED

    def test_a_disqualified_team_already_stored_stays_editable(self, season):
        """
        The clause without which the one fixture needing an admin is the one nobody can open.

        A team disqualified AFTER being placed is reported as a bracket fault (ADR-0047) and resolving
        it means editing that very fixture — so resubmitting the stored occupant has to pass.
        """
        assert eligibility_for(season, 1, {**ALL_ELIGIBLE, ADLER: True}) is None

    def test_a_disqualified_team_can_still_be_removed(self, season):
        """Clearing the side is the correction, and refusing it would trap the fixture."""
        assert eligibility_for(season, 1, {**ALL_ELIGIBLE, ADLER: True}, team1=None) is None

    def test_a_team_with_no_row_for_the_season_is_refused(self, season):
        """A dangling reference rather than an odd draw: the form offers only the season's teams."""
        missing = {team_id: False for team_id in (ADLER, BIEBER, DORNBUSCH)}
        assert eligibility_for(season, 30, missing, team1=team(CRONBERG, "Cronberg")) == ELIGIBILITY_NO_MEMBERSHIP

    def test_the_two_refusals_are_distinct(self, season):
        """A missing row and a disqualification need different advice, so they carry different codes."""
        assert ELIGIBILITY_DISQUALIFIED != ELIGIBILITY_NO_MEMBERSHIP


class TestSpieltagOccupancy:
    """A team plays at most one match per matchday, moved where it can be and refused where it cannot."""

    def test_saving_a_fixture_unchanged_releases_nothing(self, season):
        verdict = occupancy_for(season, 1)

        assert verdict.refusal is None
        assert verdict.releases == []

    def test_a_team_on_another_spieltag_is_no_clash(self, season):
        """
        The rule is per matchday, not per season — a team plays every round it reaches.

        Bieber stands in Spiel 1, on Spieltag One. Fielding it in Spiel 30, on Spieltag Two, is the
        ordinary case of a team advancing, and it must cost nothing.
        """
        verdict = occupancy_for(season, 30, team1=team(BIEBER, "Bieber"))

        assert verdict.refusal is None
        assert verdict.releases == []

    def test_a_manual_side_on_the_same_spieltag_is_released(self, season):
        """Fielding Cronberg in Spiel 1 takes it out of Spiel 2, which is on the same matchday."""
        verdict = occupancy_for(season, 1, team1=team(CRONBERG, "Cronberg"))

        assert verdict.refusal is None
        assert [(release.spiel_nr, release.side, release.team_name) for release in verdict.releases] == [(2, "team1", "Cronberg")]

    def test_a_release_names_the_result_it_destroys(self, season):
        """Spiel 2 carries 3:1, and emptying a side of it is what takes that scoreline away."""
        (release,) = occupancy_for(season, 1, team1=team(CRONBERG, "Cronberg")).releases

        assert release.voided_ergebnis == "3:1"
        # The side left behind still holds goals, and they go with the result they were scored in.
        assert release.other_side_tore is True

    def test_a_maintained_side_is_refused_rather_than_released(self, season):
        """
        Emptying a side that carries a `quelle` is undone by the next resolution (ADR-0042).

        Spiel 29 and Spiel 30 share a Spieltag; 29's team2 is fed by Spiel 1's winner, so a team
        standing there cannot be moved out of it by fielding it in 30.
        """
        occupied = [doc if doc["spiel_nr"] != 29 else {**doc, "team2": team(BIEBER, "Bieber")} for doc in season]
        verdict = occupancy_for(occupied, 30, team1=team(BIEBER, "Bieber"))

        assert verdict.refusal is not None
        assert verdict.refusal.error_code == SPIELTAG_OCCUPIED
        assert verdict.releases == []

    def test_one_club_on_both_sides_is_refused(self, season):
        """
        A team against itself, and there is nothing to move it to — the only side to empty is one the
        caller has just filled in. The wiring rules cannot see this: they key a source by identity, and
        these two sides carry no source at all (ADR-0046).
        """
        verdict = occupancy_for(season, 30, team1=team(BIEBER, "Bieber"), team2=team(BIEBER, "Bieber"))

        assert verdict.refusal is not None
        assert verdict.refusal.error_code == SPIELTAG_OCCUPIED

    def test_a_refusal_plans_no_release(self, season):
        """
        The invariant a caller depends on: reading `releases` without checking `refusal` first would
        act on a plan that was rejected, and write into a fixture the request never touched.
        """
        occupied = [doc if doc["spiel_nr"] != 29 else {**doc, "team2": team(CRONBERG, "Cronberg")} for doc in season]
        verdict = occupancy_for(occupied, 30, team1=team(CRONBERG, "Cronberg"))

        assert verdict.refusal is not None and verdict.releases == []
