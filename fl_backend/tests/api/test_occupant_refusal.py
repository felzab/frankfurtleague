from typing import Any, Callable

import pytest
from bson import ObjectId

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.spiele.crud import apply_release_to_spiel
from app.api.spiele.schemas import (
    SONDEREREIGNIS_RECORDING_AN_ABSENCE,
    SONDEREREIGNIS_WITHOUT_A_RESULT,
    FLPatchSpielDataPayload,
    FLSpiel,
    FLSpielJoinedListAdapter,
    FLSpielListAdapter,
)
from app.api.spiele.services import (
    ELIGIBILITY_DISQUALIFIED,
    ELIGIBILITY_NO_MEMBERSHIP,
    RESULT_SIDE_EMPTIED,
    SPIELTAG_OCCUPIED,
    STATE_NO_SHOW_WITHOUT_TWO_SIDES,
    STATE_RESULT_ON_A_NON_EVENT,
    apply_payload_to_spiel,
    find_departed_occupants,
    find_eligibility_refusal,
    find_result_removal_refusal,
    find_state_refusal,
    judge_spieltag_occupancy,
)
from app.core.exceptions import WriteRefusal

MATCH_ID = "6890a1b2c3d4e5f60720{:04d}"
SPIELTAG_ONE = "6890a1b2c3d4e5f607210001"
SPIELTAG_TWO = "6890a1b2c3d4e5f607210002"

# Four clubs, so a clash needs no reuse of the id standing for the team under test.
ADLER = "6890a1b2c3d4e5f607220001"
BIEBER = "6890a1b2c3d4e5f607220002"
CRONBERG = "6890a1b2c3d4e5f607220003"
DORNBUSCH = "6890a1b2c3d4e5f607220004"

# A forfeit is composed from the SEASON's regulation, so the two sets below share no number: a
# constant 3:0 would satisfy the first and fail the second.
STANDARD_FORFEIT = FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0)
UNUSUAL_FORFEIT = FLSaisonForfeitErgebnis(sieger_tore=2, verlierer_tore=1)

RULES = FLSaisonRules(
    win_points=3,
    draw_points=1,
    qualifiers_per_group=2,
    number_of_groups=4,
    teams_per_group=4,
    tiebreak_order="tordifferenz",
    max_kadergroesse=18,
    forfeit_ergebnis=STANDARD_FORFEIT,
    erlaubte_stufen=["E1"],
)

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


def stored_spiel(season_docs: list[dict[str, Any]], nr: int) -> dict[str, Any]:
    return next(doc for doc in season_docs if doc["spiel_nr"] == nr)


def payload_for(season_docs: list[dict[str, Any]], nr: int, **overrides: Any) -> FLPatchSpielDataPayload:
    """Everything as stored plus `overrides`, so the default is the no-op edit every occupant rule turns on."""

    stored = stored_spiel(season_docs, nr)

    return FLPatchSpielDataPayload.model_validate(
        {
            "spiel_id": stored["_id"],
            "sonderereignis": stored["sonderereignis"],
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

    stored = stored_spiel(season_docs, nr)
    refusal = find_eligibility_refusal(
        ObjectId(stored["_id"]),
        payload_for(season_docs, nr, **overrides),
        FLSpielListAdapter.validate_python(season_docs),
        {ObjectId(team_id): disqualified_from for team_id, disqualified_from in membership.items()},
    )

    return None if refusal is None else refusal.error_code


def occupancy_for(season_docs: list[dict[str, Any]], nr: int, **overrides: Any):
    stored = stored_spiel(season_docs, nr)

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


def patched_spiel(season_docs: list[dict[str, Any]], nr: int, *, rules: FLSaisonRules = RULES, **overrides: Any) -> FLSpiel:
    """The fixture as this patch leaves it — the one function `patch_spiel_data` applies for the save and for the `dry_run` preview alike."""

    stored = FLSpiel.model_validate(stored_spiel(season_docs, nr))

    return apply_payload_to_spiel(stored, payload_for(season_docs, nr, **overrides), rules)


class TestApplyingThePayload:
    """The normalisation, which is the one thing the preview and the save must never do differently (`docs/backend/spec.md :: I29`)."""

    def test_ergebnis_is_derived_from_the_two_goal_counts(self, season):
        patched = patched_spiel(season, 1, team1=team(ADLER, "Adler", tore=4), team2=team(BIEBER, "Bieber", tore=2))

        assert patched.ergebnis == "4:2"

    def test_an_unresolved_side_strips_the_other_sides_goals(self, season):
        patched = patched_spiel(season, 1, team1=team(ADLER, "Adler", tore=4), team2=None)

        assert patched.ergebnis is None
        assert patched.team1 is not None and patched.team1.tore is None

    def test_a_shoot_out_is_discarded_on_a_group_fixture(self, season):
        """A group draw is a final result and has no tie to break."""
        patched = patched_spiel(
            season,
            1,
            team1=team(ADLER, "Adler", tore=2),
            team2=team(BIEBER, "Bieber", tore=2),
            elfmeterschiessen={"team1": 4, "team2": 3},
        )

        assert patched.ergebnis == "2:2"
        assert patched.elfmeterschiessen is None

    def test_a_shoot_out_is_discarded_when_the_goals_already_decided_it(self, season):
        patched = patched_spiel(
            season,
            29,
            team1=team(ADLER, "Adler", tore=3),
            team2=team(BIEBER, "Bieber", tore=1),
            elfmeterschiessen={"team1": 4, "team2": 3},
        )

        assert patched.elfmeterschiessen is None

    def test_a_shoot_out_survives_a_level_knockout(self, season):
        patched = patched_spiel(
            season,
            29,
            team1=team(ADLER, "Adler", tore=2),
            team2=team(BIEBER, "Bieber", tore=2),
            elfmeterschiessen={"team1": 4, "team2": 3},
        )

        assert patched.elfmeterschiessen is not None
        assert patched.elfmeterschiessen.team1 == 4

    def test_the_fixtures_own_identity_is_never_taken_from_the_payload(self, season):
        stored = FLSpiel.model_validate(season[1])
        patched = patched_spiel(season, 2, datum=None)

        assert (patched.spiel_nr, patched.spieltag_id, patched.saison_id, patched.saison_phase) == (
            stored.spiel_nr,
            stored.spieltag_id,
            stored.saison_id,
            stored.saison_phase,
        )


class TestComposingAForfeit:
    """A no-show's goals come from the season's regulation, never from the client: a typed figure can disagree with the rule it states."""

    def test_a_no_show_by_team1_awards_the_result_against_it(self, season):
        """The goals submitted are overwritten rather than trusted, which is what makes the award the regulation's."""

        patched = patched_spiel(
            season,
            1,
            sonderereignis="nichtantreten_team1",
            team1=team(ADLER, "Adler", tore=9),
            team2=team(BIEBER, "Bieber", tore=9),
        )

        assert patched.ergebnis == "0:3"
        assert patched.team1 is not None and patched.team1.tore == 0
        assert patched.team2 is not None and patched.team2.tore == 3

    def test_a_no_show_by_team2_awards_it_the_other_way_round(self, season):
        """Not redundant with the case above: a composition reading one side only passes that one and reverses this."""

        patched = patched_spiel(season, 1, sonderereignis="nichtantreten_team2", team1=team(ADLER, "Adler"), team2=team(BIEBER, "Bieber"))

        assert patched.ergebnis == "3:0"
        assert patched.team1 is not None and patched.team1.tore == 3
        assert patched.team2 is not None and patched.team2.tore == 0

    def test_a_season_regulating_a_different_award_gets_a_different_score(self, season):
        """The reason `rules` is an argument at all: a constant here would freeze one competition's regulation into every season."""

        unusual = RULES.model_copy(update={"forfeit_ergebnis": UNUSUAL_FORFEIT})
        patched = patched_spiel(
            season,
            1,
            rules=unusual,
            sonderereignis="nichtantreten_team2",
            team1=team(ADLER, "Adler"),
            team2=team(BIEBER, "Bieber"),
        )

        assert patched.ergebnis == "2:1"

    def test_an_abandoned_fixture_keeps_the_score_that_stood(self, season):
        """Only a no-show is composed; an abandonment is unconstrained, so whatever was entered when play stopped survives."""

        patched = patched_spiel(
            season, 1, sonderereignis="abgebrochen", team1=team(ADLER, "Adler", tore=1), team2=team(BIEBER, "Bieber", tore=0)
        )

        assert patched.ergebnis == "1:0"

    def test_the_event_itself_reaches_the_fixture(self, season):
        """A composition that awarded the goals and dropped the event would leave a scoreline nothing explains."""

        patched = patched_spiel(season, 1, sonderereignis="nichtantreten_team2", team1=team(ADLER, "Adler"), team2=team(BIEBER, "Bieber"))

        assert patched.sonderereignis == "nichtantreten_team2"


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

    @pytest.mark.parametrize("sonderereignis", SONDEREREIGNIS_RECORDING_AN_ABSENCE)
    def test_a_group_fixture_recording_an_absence_may_hold_a_disqualified_team(self, season, sonderereignis):
        """The carve-out: the entry records that the match did not happen, so refusing would refuse the very document of the absence."""

        assert (
            eligibility_for(
                season,
                1,
                {**ALL_ELIGIBLE, CRONBERG: BEFORE_THE_FIXTURE},
                team1=team(CRONBERG, "Cronberg"),
                sonderereignis=sonderereignis,
            )
            is None
        )

    def test_an_abandoned_group_fixture_is_still_refused(self, season):
        """The distinction the boolean hid: an abandonment HAPPENED, so a club barred from the season standing on it is the fault."""

        assert (
            eligibility_for(
                season,
                1,
                {**ALL_ELIGIBLE, CRONBERG: BEFORE_THE_FIXTURE},
                team1=team(CRONBERG, "Cronberg"),
                sonderereignis="abgebrochen",
            )
            == ELIGIBILITY_DISQUALIFIED
        )

    def test_an_annulled_knockout_fixture_is_still_refused(self, season):
        """Where the carve-out stops: a struck-out bracket slot still has to say who advances. The phase comes from the stored fixture."""

        assert (
            eligibility_for(
                season,
                30,
                {**ALL_ELIGIBLE, CRONBERG: BEFORE_THE_FIXTURE},
                team1=team(CRONBERG, "Cronberg"),
                sonderereignis="annulliert",
            )
            == ELIGIBILITY_DISQUALIFIED
        )

    def test_an_ordinary_group_fixture_is_refused(self, season):
        assert (
            eligibility_for(season, 1, {**ALL_ELIGIBLE, CRONBERG: BEFORE_THE_FIXTURE}, team1=team(CRONBERG, "Cronberg"))
            == ELIGIBILITY_DISQUALIFIED
        )

    def test_a_group_fixture_recording_an_absence_still_needs_a_membership(self, season):
        """The carve-out reaches the disqualification rule alone; `REQ-ELIGIBILITY-002` is a different fact."""

        missing: dict[str, str | None] = {team_id: None for team_id in (ADLER, BIEBER, DORNBUSCH)}

        assert eligibility_for(season, 1, missing, team1=team(CRONBERG, "Cronberg"), sonderereignis="annulliert") == ELIGIBILITY_NO_MEMBERSHIP

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


class TestApplyingARelease:
    """The emptying itself. The preview and the save share it, so neither can model a release the other would not."""

    def test_the_side_left_behind_loses_its_goals(self, season):
        """Those goals were scored against the team being removed, so the result they add up to cannot stand either."""

        (release,) = occupancy_for(season, 1, team1=team(CRONBERG, "Cronberg")).releases
        released = apply_release_to_spiel(FLSpiel.model_validate(stored_spiel(season, release.spiel_nr)), release)

        assert released.team1 is None
        assert released.team2 is not None and released.team2.tore is None
        assert released.ergebnis is None and released.elfmeterschiessen is None

    def test_a_shoot_out_goes_with_the_goals_it_settled(self, season):
        """It exists to break a level score, so nothing is left for it to decide once that score is gone."""

        settled = [
            doc
            if doc["spiel_nr"] != 29
            else {
                **doc,
                "team1": team(ADLER, "Adler", tore=2),
                "team2": team(BIEBER, "Bieber", tore=2),
                "ergebnis": "2:2",
                "elfmeterschiessen": {"team1": 4, "team2": 3},
            }
            for doc in season
        ]

        (release,) = occupancy_for(settled, 30, team1=team(ADLER, "Adler")).releases
        released = apply_release_to_spiel(FLSpiel.model_validate(stored_spiel(settled, release.spiel_nr)), release)

        assert release.voided_elfmeterschiessen is not None
        assert released.elfmeterschiessen is None
        assert released.team2 is not None and released.team2.tore is None


def joined(*, nr: int, datum: str | None, side_disqualified_from: str | None, side: str = "team1") -> dict[str, Any]:
    """Carries the whole `austritt` record, so a fault can name its effective day."""

    def occupant(team_id: str, name: str, disqualified_from: str | None) -> dict[str, Any]:
        # `type` is set and never varied: the rule reads the DATE, so a `rueckzug` would exercise
        # the same branch with a different word in it.
        record = None if disqualified_from is None else {"type": "disqualifikation", "grund": "Nicht angetreten", "datum": disqualified_from}

        return {**team(team_id, name), "austritt": record}

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
        "sonderereignis": None,
        "saison_phase": "gruppenphase",
        "saison_id": "2026",
    }


def occupant_faults(*fixtures: dict[str, Any]) -> list:
    return find_departed_occupants(FLSpielJoinedListAdapter.validate_python(list(fixtures)))


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

        assert [fault.reason for fault in faults] == ["departed_occupant"]

    def test_a_fixture_after_the_disqualification_is_reported(self):
        faults = occupant_faults(joined(nr=4, datum="2026-04-01", side_disqualified_from="2026-03-15"))

        assert len(faults) == 1
        assert faults[0].spiel_nr == 4
        assert faults[0].side == "team1"
        assert faults[0].ausgeschieden_seit == "2026-03-15"
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
        stored = stored_spiel(season_docs, nr)
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


def state_refusal_for(season_docs: list[dict[str, Any]], nr: int, **overrides: Any) -> WriteRefusal | None:
    """`find_state_refusal` reads the payload alone — the event and the two goal counts arrive in one body."""

    return find_state_refusal(payload_for(season_docs, nr, **overrides))


class TestAnEventThatAwardsNothingCarriesNoResult:
    """`REQ-STATE-002`: the goals are somebody's typing, so a save that silently discarded them is how a real result disappears."""

    @pytest.mark.parametrize("sonderereignis", SONDEREREIGNIS_WITHOUT_A_RESULT)
    def test_goals_submitted_beside_it_are_refused(self, season, sonderereignis):
        refusal = state_refusal_for(season, 1, sonderereignis=sonderereignis, team1=team(ADLER, "Adler", tore=2))

        assert refusal is not None
        assert refusal.error_code == STATE_RESULT_ON_A_NON_EVENT

    @pytest.mark.parametrize("sonderereignis", SONDEREREIGNIS_WITHOUT_A_RESULT)
    def test_the_same_fixture_with_no_goals_passes(self, season, sonderereignis):
        """The route the admin takes: clear the score, then record that the match never happened."""

        assert state_refusal_for(season, 1, sonderereignis=sonderereignis) is None

    def test_a_zero_is_a_goal_count_like_any_other(self, season):
        """`0` is a score somebody entered, not an absent one, and a truthiness test on the value alone would let it through."""

        refusal = state_refusal_for(season, 1, sonderereignis="ausgefallen", team1=team(ADLER, "Adler", tore=0))

        assert refusal is not None
        assert refusal.error_code == STATE_RESULT_ON_A_NON_EVENT

    def test_an_abandoned_fixture_may_carry_its_goals(self, season):
        """The distinction the boolean hid: play started and a score stood, so this state is unconstrained."""

        assert state_refusal_for(season, 1, sonderereignis="abgebrochen", team1=team(ADLER, "Adler", tore=2)) is None

    def test_an_ordinary_fixture_may_carry_its_goals(self, season):
        assert state_refusal_for(season, 1, team1=team(ADLER, "Adler", tore=2)) is None


class TestANoShowNeedsBothSides:
    """`REQ-STATE-003`: an unresolved slot has nobody who could have failed to appear, and the award would have no side to land on."""

    @pytest.mark.parametrize("sonderereignis", ["nichtantreten_team1", "nichtantreten_team2"])
    def test_a_fixture_with_two_clubs_passes(self, season, sonderereignis):
        assert state_refusal_for(season, 1, sonderereignis=sonderereignis) is None

    @pytest.mark.parametrize("emptied", ["team1", "team2"])
    def test_an_unresolved_slot_is_refused(self, season, emptied):
        """Either side, because the rule is about the fixture rather than about the club that stayed away."""

        refusal = state_refusal_for(season, 1, sonderereignis="nichtantreten_team1", **{emptied: None})

        assert refusal is not None
        assert refusal.error_code == STATE_NO_SHOW_WITHOUT_TWO_SIDES

    def test_an_unresolved_slot_is_no_bar_to_any_other_event(self, season):
        """Fixture 30 holds neither club, and calling off a match nobody was drawn into is a legitimate entry."""

        assert state_refusal_for(season, 30, sonderereignis="ausgefallen") is None

    def test_the_two_state_refusals_are_distinct(self):
        """Different advice — one says remove the goals, the other says fill the slot — so different codes."""

        assert STATE_RESULT_ON_A_NON_EVENT != STATE_NO_SHOW_WITHOUT_TWO_SIDES
