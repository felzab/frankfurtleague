from typing import Any, Callable

import pytest
from bson import ObjectId

from app.api.spiele.schemas import FLPatchSpielDataPayload, FLSpiel, FLSpielJoinedListAdapter, FLSpielListAdapter
from app.api.spiele.services import (
    ELIGIBILITY_DISQUALIFIED,
    ELIGIBILITY_NO_MEMBERSHIP,
    RESULT_SIDE_EMPTIED,
    SPIELTAG_OCCUPIED,
    apply_payload_to_spiel,
    find_disqualified_occupants,
    find_eligibility_refusal,
    find_result_removal_refusal,
    judge_spieltag_occupancy,
)

MATCH_ID = "6890a1b2c3d4e5f60720{:04d}"
SPIELTAG_ONE = "6890a1b2c3d4e5f607210001"
SPIELTAG_TWO = "6890a1b2c3d4e5f607210002"

# Four clubs, so a clash needs no reuse of the id standing for the team under test.
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
    def make(nr: int, phase: str, spieltag_id: str, **overrides: Any) -> dict[str, Any]:
        # `ergebnis` defaults to unplayed and stays overridable, so one fixture can carry a result.
        return spiel(_id=MATCH_ID.format(nr), spiel_nr=nr, saison_phase=phase, spieltag_id=spieltag_id, **{"ergebnis": None, **overrides})

    return make


@pytest.fixture
def season(fixture_at: Callable[..., dict[str, Any]]) -> list[dict[str, Any]]:
    """Two group fixtures on one Spieltag, two knockouts on another. Spiel 2 carries a result, so releasing its side destroys something."""

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
    """Everything as stored plus `overrides`, so the default is the no-op edit every occupant rule turns on."""

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
            "notiz": stored.get("notiz"),
            **overrides,
        }
    )


def eligibility_for(season_docs: list[dict[str, Any]], nr: int, membership: dict[str, str | None], **overrides: Any) -> str | None:
    """`membership` maps a club to the day it is disqualified from, or `None` while it competes — `pull_saison_membership`'s shape."""

    stored = next(doc for doc in season_docs if doc["spiel_nr"] == nr)
    refusal = find_eligibility_refusal(
        ObjectId(stored["_id"]),
        payload_for(season_docs, nr, **overrides),
        FLSpielListAdapter.validate_python(season_docs),
        {ObjectId(team_id): disqualified_from for team_id, disqualified_from in membership.items()},
    )

    return None if refusal is None else refusal.error_code


def occupancy_for(season_docs: list[dict[str, Any]], nr: int, **overrides: Any):
    stored = next(doc for doc in season_docs if doc["spiel_nr"] == nr)

    return judge_spieltag_occupancy(
        ObjectId(stored["_id"]),
        payload_for(season_docs, nr, **overrides),
        FLSpielListAdapter.validate_python(season_docs),
    )


# Every club in the season, none disqualified — the base each eligibility case departs from.
ALL_ELIGIBLE: dict[str, str | None] = {ADLER: None, BIEBER: None, CRONBERG: None, DORNBUSCH: None}

# The shared factory dates every fixture the same day; these three straddle it.
BEFORE_THE_FIXTURE = "2026-03-14"
ON_THE_FIXTURE_DAY = "2026-03-15"
AFTER_THE_FIXTURE = "2026-03-16"


class TestApplyingThePayload:
    """The normalisation, which is the one thing the preview and the save must never do differently."""

    def test_ergebnis_is_derived_from_the_two_goal_counts(self, season):
        patched = apply_payload_to_spiel(
            FLSpiel.model_validate(season[0]),
            payload_for(season, 1, team1=team(ADLER, "Adler", tore=4), team2=team(BIEBER, "Bieber", tore=2)),
        )

        assert patched.ergebnis == "4:2"

    def test_an_unresolved_side_strips_the_other_sides_goals(self, season):
        patched = apply_payload_to_spiel(
            FLSpiel.model_validate(season[0]),
            payload_for(season, 1, team1=team(ADLER, "Adler", tore=4), team2=None),
        )

        assert patched.ergebnis is None
        assert patched.team1 is not None and patched.team1.tore is None

    def test_a_shoot_out_is_discarded_on_a_group_fixture(self, season):
        """A group draw is a final result and has no tie to break."""
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
        stored = FLSpiel.model_validate(season[1])
        patched = apply_payload_to_spiel(stored, payload_for(season, 2, datum=None))

        assert (patched.spiel_nr, patched.spieltag_id, patched.saison_id, patched.saison_phase) == (
            stored.spiel_nr,
            stored.spieltag_id,
            stored.saison_id,
            stored.saison_phase,
        )


class TestEligibility:
    def test_saving_a_fixture_unchanged_is_legal(self, season):
        assert eligibility_for(season, 1, ALL_ELIGIBLE) is None

    def test_newly_fielding_a_team_disqualified_before_the_fixture_is_refused(self, season):
        assert (
            eligibility_for(season, 30, {**ALL_ELIGIBLE, CRONBERG: BEFORE_THE_FIXTURE}, team1=team(CRONBERG, "Cronberg"))
            == ELIGIBILITY_DISQUALIFIED
        )

    def test_the_day_itself_is_refused(self, season):
        """An off-by-one is a banned team playing, or an entitled one refused."""

        assert (
            eligibility_for(season, 30, {**ALL_ELIGIBLE, CRONBERG: ON_THE_FIXTURE_DAY}, team1=team(CRONBERG, "Cronberg"))
            == ELIGIBILITY_DISQUALIFIED
        )

    def test_a_fixture_played_before_the_disqualification_stays_fillable(self, season):
        """Why a boolean was not enough: recording a match played before the ban is not fielding an ineligible team in one still to come."""

        assert eligibility_for(season, 30, {**ALL_ELIGIBLE, CRONBERG: AFTER_THE_FIXTURE}, team1=team(CRONBERG, "Cronberg")) is None

    def test_a_fixture_with_no_date_is_refused(self, season):
        """Refuse-by-default: an unscheduled fixture is more often ahead than behind."""

        assert (
            eligibility_for(season, 30, {**ALL_ELIGIBLE, CRONBERG: BEFORE_THE_FIXTURE}, team1=team(CRONBERG, "Cronberg"), datum=None)
            == ELIGIBILITY_DISQUALIFIED
        )

    def test_a_cancelled_group_fixture_may_hold_a_disqualified_team(self, season):
        """The carve-out: a cancellation records that the match did not happen, so refusing would refuse the entry documenting the absence."""

        assert (
            eligibility_for(
                season,
                1,
                {**ALL_ELIGIBLE, CRONBERG: BEFORE_THE_FIXTURE},
                team1=team(CRONBERG, "Cronberg"),
                is_canceled=True,
            )
            is None
        )

    def test_a_cancelled_knockout_fixture_is_still_refused(self, season):
        """Where the carve-out stops: a cancelled bracket slot still has to say who advances. The phase comes from the stored fixture."""

        assert (
            eligibility_for(
                season,
                30,
                {**ALL_ELIGIBLE, CRONBERG: BEFORE_THE_FIXTURE},
                team1=team(CRONBERG, "Cronberg"),
                is_canceled=True,
            )
            == ELIGIBILITY_DISQUALIFIED
        )

    def test_an_uncancelled_group_fixture_is_refused(self, season):
        assert (
            eligibility_for(season, 1, {**ALL_ELIGIBLE, CRONBERG: BEFORE_THE_FIXTURE}, team1=team(CRONBERG, "Cronberg"))
            == ELIGIBILITY_DISQUALIFIED
        )

    def test_a_cancelled_group_fixture_still_needs_a_membership(self, season):
        """The carve-out reaches the disqualification rule alone; `REQ-ELIGIBILITY-002` is a different fact."""

        missing: dict[str, str | None] = {team_id: None for team_id in (ADLER, BIEBER, DORNBUSCH)}

        assert eligibility_for(season, 1, missing, team1=team(CRONBERG, "Cronberg"), is_canceled=True) == ELIGIBILITY_NO_MEMBERSHIP

    def test_a_disqualified_team_already_stored_stays_editable(self, season):
        """Resolving the fault means editing that fixture, so the stored occupant passes on any date."""
        assert eligibility_for(season, 1, {**ALL_ELIGIBLE, ADLER: BEFORE_THE_FIXTURE}) is None

    def test_a_disqualified_team_can_still_be_removed(self, season):
        """Clearing the side is the correction, and refusing it would trap the fixture."""
        assert eligibility_for(season, 1, {**ALL_ELIGIBLE, ADLER: BEFORE_THE_FIXTURE}, team1=None) is None

    def test_a_team_with_no_row_for_the_season_is_refused(self, season):
        """A dangling reference rather than an odd draw: the form offers only the season's teams."""
        missing: dict[str, str | None] = {team_id: None for team_id in (ADLER, BIEBER, DORNBUSCH)}
        assert eligibility_for(season, 30, missing, team1=team(CRONBERG, "Cronberg")) == ELIGIBILITY_NO_MEMBERSHIP

    def test_a_missing_row_is_refused_whatever_the_date(self, season):
        """No date makes fielding a club outside the season legal."""

        missing: dict[str, str | None] = {team_id: None for team_id in (ADLER, BIEBER, DORNBUSCH)}
        assert eligibility_for(season, 30, missing, team1=team(CRONBERG, "Cronberg"), datum="2020-01-01") == ELIGIBILITY_NO_MEMBERSHIP

    def test_the_two_refusals_are_distinct(self, season):
        """Different advice, so different codes."""
        assert ELIGIBILITY_DISQUALIFIED != ELIGIBILITY_NO_MEMBERSHIP


class TestSpieltagOccupancy:
    """A team plays at most one match per matchday, moved where it can be and refused where it cannot."""

    def test_saving_a_fixture_unchanged_releases_nothing(self, season):
        verdict = occupancy_for(season, 1)

        assert verdict.refusal is None
        assert verdict.releases == []

    def test_a_team_on_another_spieltag_is_no_clash(self, season):
        """Per matchday, not per season: advancing to the next round must cost nothing."""
        verdict = occupancy_for(season, 30, team1=team(BIEBER, "Bieber"))

        assert verdict.refusal is None
        assert verdict.releases == []

    def test_a_manual_side_on_the_same_spieltag_is_released(self, season):
        verdict = occupancy_for(season, 1, team1=team(CRONBERG, "Cronberg"))

        assert verdict.refusal is None
        assert [(release.spiel_nr, release.side, release.team_name) for release in verdict.releases] == [(2, "team1", "Cronberg")]

    def test_a_release_names_the_result_it_destroys(self, season):
        (release,) = occupancy_for(season, 1, team1=team(CRONBERG, "Cronberg")).releases

        assert release.voided_ergebnis == "3:1"
        # The side left behind still holds goals, and they go with the result they were scored in.
        assert release.other_side_tore is True

    def test_a_maintained_side_is_refused_rather_than_released(self, season):
        """Emptying a side that carries a `quelle` is undone by the next resolution, so it is refused instead."""
        occupied = [doc if doc["spiel_nr"] != 29 else {**doc, "team2": team(BIEBER, "Bieber")} for doc in season]
        verdict = occupancy_for(occupied, 30, team1=team(BIEBER, "Bieber"))

        assert verdict.refusal is not None
        assert verdict.refusal.error_code == SPIELTAG_OCCUPIED
        assert verdict.releases == []

    def test_one_club_on_both_sides_is_refused(self, season):
        """The wiring rules cannot see this shape, and the only side to empty is one the caller just filled."""
        verdict = occupancy_for(season, 30, team1=team(BIEBER, "Bieber"), team2=team(BIEBER, "Bieber"))

        assert verdict.refusal is not None
        assert verdict.refusal.error_code == SPIELTAG_OCCUPIED

    def test_a_refusal_plans_no_release(self, season):
        """Reading `releases` without checking `refusal` would act on a rejected plan and write into an untouched fixture."""
        occupied = [doc if doc["spiel_nr"] != 29 else {**doc, "team2": team(CRONBERG, "Cronberg")} for doc in season]
        verdict = occupancy_for(occupied, 30, team1=team(CRONBERG, "Cronberg"))

        assert verdict.refusal is not None and verdict.releases == []


def joined(*, nr: int, datum: str | None, side_disqualified_from: str | None, side: str = "team1") -> dict[str, Any]:
    """Carries the whole `disqualifikation` record, so a fault can name its effective day."""

    def occupant(team_id: str, name: str, disqualified_from: str | None) -> dict[str, Any]:
        return {
            **team(team_id, name),
            "disqualifikation": None if disqualified_from is None else {"grund": "Nicht angetreten", "datum": disqualified_from},
        }

    return {
        "_id": MATCH_ID.format(nr),
        "team1": occupant(ADLER, "Adler", side_disqualified_from if side == "team1" else None),
        "team2": occupant(BIEBER, "Bieber", side_disqualified_from if side == "team2" else None),
        "team1_quelle": None,
        "team2_quelle": None,
        "datum": datum,
        "uhrzeit": None,
        "ort": None,
        "schiedsrichter": None,
        "ergebnis": None,
        "elfmeterschiessen": None,
        "spieltag_id": SPIELTAG_ONE,
        "spiel_nr": nr,
        "is_canceled": False,
        "saison_phase": "gruppenphase",
        "saison_id": "2026",
    }


def occupant_faults(*fixtures: dict[str, Any]) -> list:
    return find_disqualified_occupants(FLSpielJoinedListAdapter.validate_python(list(fixtures)))


class TestTheDisqualifiedOccupantFault:
    """Derived, never stored, and it empties nothing: what to do about the fixture is a competition decision."""

    def test_a_fixture_with_no_disqualified_side_is_clean(self):
        assert occupant_faults(joined(nr=1, datum="2026-03-15", side_disqualified_from=None)) == []

    def test_a_fixture_played_before_the_disqualification_is_clean(self):
        """Eligible on the day: reporting it would report the league's own history as a defect."""

        assert occupant_faults(joined(nr=1, datum="2026-03-15", side_disqualified_from="2026-03-16")) == []

    def test_a_fixture_on_the_effective_day_is_reported(self):
        """`datum` is the day the disqualification took effect, so that day's fixtures are affected."""

        faults = occupant_faults(joined(nr=1, datum="2026-03-15", side_disqualified_from="2026-03-15"))

        assert [fault.reason for fault in faults] == ["disqualified_occupant"]

    def test_a_fixture_after_the_disqualification_is_reported(self):
        faults = occupant_faults(joined(nr=4, datum="2026-04-01", side_disqualified_from="2026-03-15"))

        assert len(faults) == 1
        assert faults[0].spiel_nr == 4
        assert faults[0].side == "team1"
        assert faults[0].disqualifiziert_seit == "2026-03-15"
        assert faults[0].spiel_datum == "2026-04-01"

    def test_an_undated_fixture_is_reported(self):
        """Refuse-by-default, matching the write path."""

        faults = occupant_faults(joined(nr=9, datum=None, side_disqualified_from="2026-03-15"))

        assert len(faults) == 1
        assert faults[0].spiel_datum is None

    def test_either_side_is_reported(self):
        faults = occupant_faults(joined(nr=2, datum="2026-04-01", side_disqualified_from="2026-03-15", side="team2"))

        assert [fault.side for fault in faults] == ["team2"]
        assert faults[0].team_name == "Bieber"

    def test_a_group_phase_fixture_is_covered(self):
        """No bracket rule looks at the group phase, which is why this is derived beside the walk."""

        faults = occupant_faults(joined(nr=1, datum="2026-04-01", side_disqualified_from="2026-03-15"))

        assert len(faults) == 1

    def test_every_affected_fixture_is_reported(self):
        """One fault per remaining fixture: each needs the same decision taken separately."""

        faults = occupant_faults(
            joined(nr=1, datum="2026-03-01", side_disqualified_from="2026-03-15"),
            joined(nr=2, datum="2026-04-01", side_disqualified_from="2026-03-15"),
            joined(nr=3, datum="2026-05-01", side_disqualified_from="2026-03-15"),
        )

        assert [fault.spiel_nr for fault in faults] == [2, 3]

    def test_the_report_is_ordered_by_season_then_fixture(self):
        faults = occupant_faults(
            joined(nr=7, datum="2026-04-01", side_disqualified_from="2026-03-15"),
            joined(nr=2, datum="2026-04-01", side_disqualified_from="2026-03-15"),
        )

        assert [fault.spiel_nr for fault in faults] == [2, 7]


class TestRemovingATeamFromAPlayedFixture:
    """`tore` lives inside the side, so emptying it takes the goals and the result collapses; switching keeps them."""

    def removal(self, season_docs, nr, **overrides):
        stored = next(doc for doc in season_docs if doc["spiel_nr"] == nr)
        refusal = find_result_removal_refusal(
            ObjectId(stored["_id"]),
            payload_for(season_docs, nr, **overrides),
            FLSpielListAdapter.validate_python(season_docs),
        )

        return None if refusal is None else refusal.error_code

    def test_emptying_a_side_that_carries_goals_is_refused(self, season):
        assert self.removal(season, 2, team1=None) == RESULT_SIDE_EMPTIED

    def test_switching_the_team_on_that_side_is_permitted(self, season):
        assert self.removal(season, 2, team1=team(ADLER, "Adler", tore=3)) is None

    def test_emptying_a_side_with_no_goals_is_permitted(self, season):
        """Nothing is destroyed, which is what keeps the picker's clear button working."""

        assert self.removal(season, 1, team1=None) is None

    def test_the_other_side_is_checked_too(self, season):
        assert self.removal(season, 2, team2=None) == RESULT_SIDE_EMPTIED

    def test_resubmitting_the_fixture_unchanged_is_permitted(self, season):
        """The clause every occupant rule here turns on: a no-op edit is always legal."""

        assert self.removal(season, 2) is None

    def test_it_keys_on_the_goals_rather_than_on_ergebnis(self, season):
        """`tore` with no composed `ergebnis` is the hand-edited document, and emptying it loses the goals."""

        without_ergebnis = [{**doc, "ergebnis": None} if doc["spiel_nr"] == 2 else doc for doc in season]

        assert self.removal(without_ergebnis, 2, team1=None) == RESULT_SIDE_EMPTIED
