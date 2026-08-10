"""
SPIELE · the write path's occupant rules, and the payload normalisation both paths share

Pure functions throughout, so every case runs in the default tier: `apply_payload_to_spiel` — the
normalisation the save and the `dry_run=true` preview both apply, tested here because a drift
would be invisible everywhere else (ADR-0041); `find_eligibility_refusal` and
`find_disqualified_occupants` — a disqualified team, keyed on the fixture's date (ADR-0042);
`judge_spieltag_occupancy` and `find_result_removal_refusal` — what a side may become (ADR-0042).

Refusals are asserted on their code, never their message. The season under test is one Spieltag
of two group fixtures plus the knockout round — the smallest shape in which "same matchday" and
"different matchday" are both expressible.
"""

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
            "notiz": stored.get("notiz"),
            **overrides,
        }
    )


def eligibility_for(season_docs: list[dict[str, Any]], nr: int, membership: dict[str, str | None], **overrides: Any) -> str | None:
    """
    The eligibility refusal's CODE for an edit of match `nr`, or `None` when it is legal.

    `membership` maps a club to the DAY it is disqualified from, or `None` while it competes — the shape
    `pull_saison_membership` returns, because the rule compares that day against the fixture's own date.
    """

    stored = next(doc for doc in season_docs if doc["spiel_nr"] == nr)
    refusal = find_eligibility_refusal(
        ObjectId(stored["_id"]),
        payload_for(season_docs, nr, **overrides),
        FLSpielListAdapter.validate_python(season_docs),
        {ObjectId(team_id): disqualified_from for team_id, disqualified_from in membership.items()},
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
ALL_ELIGIBLE: dict[str, str | None] = {ADLER: None, BIEBER: None, CRONBERG: None, DORNBUSCH: None}

# Every fixture in the shared factory is dated 2026-03-15, so these three straddle it: one day before it,
# the day itself, and one day after. The boundary is what the rule turns on, so it is named rather than
# spelled out at each call site.
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
        """One side empty means the fixture has no result, so the goals the other side holds go too."""
        patched = apply_payload_to_spiel(
            FLSpiel.model_validate(season[0]),
            payload_for(season, 1, team1=team(ADLER, "Adler", tore=4), team2=None),
        )

        assert patched.ergebnis is None
        assert patched.team1 is not None and patched.team1.tore is None

    def test_a_shoot_out_is_discarded_on_a_group_fixture(self, season):
        """A group draw is a final result and has no tie to break (ADR-0036)."""
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
    """A team the season records as unable to be there (ADR-0042), judged against the fixture's date."""

    def test_saving_a_fixture_unchanged_is_legal(self, season):
        assert eligibility_for(season, 1, ALL_ELIGIBLE) is None

    def test_newly_fielding_a_team_disqualified_before_the_fixture_is_refused(self, season):
        """The straightforward case: the team was already out on the day this match is played."""

        assert (
            eligibility_for(season, 30, {**ALL_ELIGIBLE, CRONBERG: BEFORE_THE_FIXTURE}, team1=team(CRONBERG, "Cronberg"))
            == ELIGIBILITY_DISQUALIFIED
        )

    def test_the_day_itself_is_refused(self, season):
        """
        `datum` is "the day the disqualification took effect", so a match that day is already affected.

        Asserted rather than left to the comparison operator: an off-by-one here is the difference
        between a team playing a match it was banned from and being refused one it was entitled to.
        """

        assert (
            eligibility_for(season, 30, {**ALL_ELIGIBLE, CRONBERG: ON_THE_FIXTURE_DAY}, team1=team(CRONBERG, "Cronberg"))
            == ELIGIBILITY_DISQUALIFIED
        )

    def test_a_fixture_played_before_the_disqualification_stays_fillable(self, season):
        """
        The case the date makes possible (decided 2026-08-08), and the reason a boolean was not enough.

        A match played in March, entered in April, by a team disqualified in between: recording what
        happened is not the same act as putting an ineligible team into a match still to come. A blanket
        refusal made the league's own history unenterable.
        """

        assert eligibility_for(season, 30, {**ALL_ELIGIBLE, CRONBERG: AFTER_THE_FIXTURE}, team1=team(CRONBERG, "Cronberg")) is None

    def test_a_fixture_with_no_date_is_refused(self, season):
        """
        Refuse-by-default: "we cannot tell when this was played" is not evidence it was played in time.

        An undated fixture is one nobody has scheduled, which is far more likely to be a future match
        than a past one somebody forgot to date.
        """

        assert (
            eligibility_for(season, 30, {**ALL_ELIGIBLE, CRONBERG: BEFORE_THE_FIXTURE}, team1=team(CRONBERG, "Cronberg"), datum=None)
            == ELIGIBILITY_DISQUALIFIED
        )

    def test_a_cancelled_group_fixture_may_hold_a_disqualified_team(self, season):
        """
        The carve-out (decided 2026-08-08), and the one case where the fixture's date is irrelevant.

        Cancelling a group fixture RECORDS that the match did not happen, so a disqualified team is exactly
        who belongs on it — the row keeps the group's schedule complete and lets the table account for the
        absence. Refusing here would refuse the very entry that documents it. Fixture 1 is a group fixture.
        """

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
        """
        Where the carve-out stops, and why it has to.

        Fixture 30 is a `halbfinale`. A bracket slot is not a record of a match that did not happen — it is
        a place somebody advances from, and a cancelled one still has to say who. A disqualified team there
        decides nothing and reads as a bracket nobody rewired.

        The pair with the test above also pins that the phase comes from the STORED fixture: `saison_phase`
        is on no payload, so a request cannot claim a semi-final is a group fixture to get past the rule.
        """

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
        """
        The carve-out turns on the CANCELLATION, not on the phase alone.

        The same group fixture, the same disqualified team, not cancelled: refused, because now the row
        claims a match that will be played rather than one that was called off.
        """

        assert (
            eligibility_for(season, 1, {**ALL_ELIGIBLE, CRONBERG: BEFORE_THE_FIXTURE}, team1=team(CRONBERG, "Cronberg"))
            == ELIGIBILITY_DISQUALIFIED
        )

    def test_a_cancelled_group_fixture_still_needs_a_membership(self, season):
        """
        The carve-out reaches the DISQUALIFICATION rule alone.

        A club with no junction row was never in the season, so cancelling a fixture says nothing about it
        — `REQ-ELIGIBILITY-002` is a different fact and still applies.
        """

        missing: dict[str, str | None] = {team_id: None for team_id in (ADLER, BIEBER, DORNBUSCH)}

        assert eligibility_for(season, 1, missing, team1=team(CRONBERG, "Cronberg"), is_canceled=True) == ELIGIBILITY_NO_MEMBERSHIP

    def test_a_disqualified_team_already_stored_stays_editable(self, season):
        """
        The clause without which the one fixture needing an admin is the one nobody can open.

        A team disqualified AFTER being placed is reported as a fault (ADR-0039) and resolving it means
        editing that very fixture — so resubmitting the stored occupant has to pass, on any date.
        """
        assert eligibility_for(season, 1, {**ALL_ELIGIBLE, ADLER: BEFORE_THE_FIXTURE}) is None

    def test_a_disqualified_team_can_still_be_removed(self, season):
        """Clearing the side is the correction, and refusing it would trap the fixture."""
        assert eligibility_for(season, 1, {**ALL_ELIGIBLE, ADLER: BEFORE_THE_FIXTURE}, team1=None) is None

    def test_a_team_with_no_row_for_the_season_is_refused(self, season):
        """A dangling reference rather than an odd draw: the form offers only the season's teams."""
        missing: dict[str, str | None] = {team_id: None for team_id in (ADLER, BIEBER, DORNBUSCH)}
        assert eligibility_for(season, 30, missing, team1=team(CRONBERG, "Cronberg")) == ELIGIBILITY_NO_MEMBERSHIP

    def test_a_missing_row_is_refused_whatever_the_date(self, season):
        """
        The date narrows the DISQUALIFICATION rule and not this one, which is a different fact.

        A club with no junction row was never in the season, so no date makes fielding it legal — and the
        two are checked in this order because "you are not in this competition" is the stronger answer.
        """

        missing: dict[str, str | None] = {team_id: None for team_id in (ADLER, BIEBER, DORNBUSCH)}
        assert eligibility_for(season, 30, missing, team1=team(CRONBERG, "Cronberg"), datum="2020-01-01") == ELIGIBILITY_NO_MEMBERSHIP

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
        Emptying a side that carries a `quelle` is undone by the next resolution (ADR-0034).

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
        A team against itself, and there is nothing to move it to.

        The only side to empty is one the caller has just filled in. The wiring rules cannot see this
        shape either: they key a source by identity, and these two sides carry no source at all
        (ADR-0038).
        """
        verdict = occupancy_for(season, 30, team1=team(BIEBER, "Bieber"), team2=team(BIEBER, "Bieber"))

        assert verdict.refusal is not None
        assert verdict.refusal.error_code == SPIELTAG_OCCUPIED

    def test_a_refusal_plans_no_release(self, season):
        """
        A refusal plans no release, which is the invariant every caller depends on.

        Reading `releases` without checking `refusal` first would act on a plan that was rejected, and
        write into a fixture the request never touched.
        """
        occupied = [doc if doc["spiel_nr"] != 29 else {**doc, "team2": team(CRONBERG, "Cronberg")} for doc in season]
        verdict = occupancy_for(occupied, 30, team1=team(CRONBERG, "Cronberg"))

        assert verdict.refusal is not None and verdict.releases == []


def joined(*, nr: int, datum: str | None, side_disqualified_from: str | None, side: str = "team1") -> dict[str, Any]:
    """
    One JOINED fixture, which is the shape `build_spiele_pipeline` returns.

    The joined side carries the whole `disqualifikation` record rather than a flag, so the fault can name
    the day it took effect without a second read (ADR-0047).
    """

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
    """
    A fixture fielding a team the season disqualified before the day it is played (decided 2026-08-08).

    Derived, never stored, and it empties nothing: what to do about the fixture — cancel it, award it, or
    replace the team — is a competition decision (ADR-0039, ADR-0042).
    """

    def test_a_fixture_with_no_disqualified_side_is_clean(self):
        assert occupant_faults(joined(nr=1, datum="2026-03-15", side_disqualified_from=None)) == []

    def test_a_fixture_played_before_the_disqualification_is_clean(self):
        """
        The whole reason the date is compared rather than a flag.

        The team was eligible on the day, so the match happened legally and its result stands. Reporting
        it would be reporting the league's own history as a defect.
        """

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
        """
        Refuse-by-default, matching the write path.

        An undated fixture cannot be shown to have been played in time, and one nobody has scheduled is
        far more often ahead than behind.
        """

        faults = occupant_faults(joined(nr=9, datum=None, side_disqualified_from="2026-03-15"))

        assert len(faults) == 1
        assert faults[0].spiel_datum is None

    def test_either_side_is_reported(self):
        """A `quelle` sits on either side (ADR-0034) and so does an occupant, so both are walked."""

        faults = occupant_faults(joined(nr=2, datum="2026-04-01", side_disqualified_from="2026-03-15", side="team2"))

        assert [fault.side for fault in faults] == ["team2"]
        assert faults[0].team_name == "Bieber"

    def test_a_group_phase_fixture_is_covered(self):
        """
        Unlike the five bracket faults, this one is not about the bracket at all.

        A group fixture dated after the disqualification is exactly as wrong as a knockout slot, and no
        bracket rule looks at the group phase — which is why this is derived beside the walk, not in it.
        """

        faults = occupant_faults(joined(nr=1, datum="2026-04-01", side_disqualified_from="2026-03-15"))

        assert len(faults) == 1

    def test_every_affected_fixture_is_reported(self):
        """
        A team disqualified mid-season produces one fault per remaining fixture.

        That is the honest count rather than noise: each of those fixtures needs the same decision taken
        separately.
        """

        faults = occupant_faults(
            joined(nr=1, datum="2026-03-01", side_disqualified_from="2026-03-15"),
            joined(nr=2, datum="2026-04-01", side_disqualified_from="2026-03-15"),
            joined(nr=3, datum="2026-05-01", side_disqualified_from="2026-03-15"),
        )

        assert [fault.spiel_nr for fault in faults] == [2, 3]

    def test_the_report_is_ordered_by_season_then_fixture(self):
        """So the triage list reads in a stable order rather than in whatever order the read returned."""

        faults = occupant_faults(
            joined(nr=7, datum="2026-04-01", side_disqualified_from="2026-03-15"),
            joined(nr=2, datum="2026-04-01", side_disqualified_from="2026-03-15"),
        )

        assert [fault.spiel_nr for fault in faults] == [2, 7]


class TestRemovingATeamFromAPlayedFixture:
    """
    A side carrying goals may be SWITCHED but not EMPTIED (decided 2026-08-08).

    `ergebnis` is composed from the two `tore`, and `tore` lives inside the side — so removing the team
    takes its goals with it and the result collapses. What is left is a match that was played, whose score
    is gone, and whose one side is empty; no legitimate act reaches that, because a match that was played
    had two sides.

    Switching stays permitted, and that asymmetry is the rule rather than a gap in it: `tore` stays on the
    side, so the score survives, which is the "we recorded the wrong club" repair this data most often
    needs. Refusing the whole edit would leave only clear-the-result-then-fix — three steps passing through
    a state where the match reads as unplayed, and the league table is derived on every read.
    """

    def removal(self, season_docs, nr, **overrides):
        stored = next(doc for doc in season_docs if doc["spiel_nr"] == nr)
        refusal = find_result_removal_refusal(
            ObjectId(stored["_id"]),
            payload_for(season_docs, nr, **overrides),
            FLSpielListAdapter.validate_python(season_docs),
        )

        return None if refusal is None else refusal.error_code

    def test_emptying_a_side_that_carries_goals_is_refused(self, season):
        """Fixture 2 is the one with a stored 3:1, so its team1 carries three goals."""

        assert self.removal(season, 2, team1=None) == RESULT_SIDE_EMPTIED

    def test_switching_the_team_on_that_side_is_permitted(self, season):
        """
        The repair the rule exists to keep possible.

        Fixture 2's team1 is Cronberg with three goals. Naming Adler instead keeps the three goals on the
        side, so the 3:1 survives and only the club changes.
        """

        assert self.removal(season, 2, team1=team(ADLER, "Adler", tore=3)) is None

    def test_emptying_a_side_with_no_goals_is_permitted(self, season):
        """
        Fixture 1 was never played, so clearing a side destroys nothing.

        This is the ordinary way a group fixture's side is emptied, and the picker's clear button exists
        for it — the rule must not reach it.
        """

        assert self.removal(season, 1, team1=None) is None

    def test_the_other_side_is_checked_too(self, season):
        """A fixture is symmetric, so a rule that only read `team1` would be half a rule."""

        assert self.removal(season, 2, team2=None) == RESULT_SIDE_EMPTIED

    def test_resubmitting_the_fixture_unchanged_is_permitted(self, season):
        """The clause every occupant rule here turns on: a no-op edit is always legal."""

        assert self.removal(season, 2) is None

    def test_it_keys_on_the_goals_rather_than_on_ergebnis(self, season):
        """
        The two can differ, and keying on the goals catches both.

        A fixture whose sides hold `tore` but whose `ergebnis` was never composed is the hand-edited
        document `apply_payload_to_spiel` exists to normalise — and emptying its side destroys the goals
        just the same.
        """

        without_ergebnis = [{**doc, "ergebnis": None} if doc["spiel_nr"] == 2 else doc for doc in season]

        assert self.removal(without_ergebnis, 2, team1=None) == RESULT_SIDE_EMPTIED
