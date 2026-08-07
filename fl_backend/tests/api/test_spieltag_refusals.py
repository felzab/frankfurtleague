"""
What a matchday write refuses — two pure functions, so both run in the default tier with no container.

Both rules exist because a matchday is a CONTAINER whose contents it does not know about. Its fixtures
point at it and it points at none of them, so every question about the pair is one the endpoint has to
ask the `spiele` collection — and until it did, the matchday could be retired or re-phased into a state
its own fixtures contradicted.

- `REQ-RETIRE-002` — retiring one that holds a played match. Soft deletion is described everywhere in
  this repository as harmless because the matches stay resolvable, and that is true of `GET /spiele` and
  false of the page a visitor reads: `getSpieltage` excludes retired rows and the public Spielplan joins
  fixtures onto the matchdays it received, so the results go with the container.
- `REQ-SPIELTAG-002` — a phase accounting for fewer matches than the matchday already holds. The count
  follows from the season's rules (ADR-0065), so this is the one direction no setup passes through.

Asserted on the CODE, never the message: the code is the contract the form reads, the message is an
English log line.
"""

import pytest

from app.api.spieltage.services import (
    SPIELTAG_HOLDS_PLAYED,
    SPIELTAG_OVER_ITS_PHASE,
    find_spieltag_phase_refusal,
    find_spieltag_retire_refusal,
)


class TestRetiringAMatchday:
    def test_an_unplayed_matchday_retires_freely(self):
        """The matchday somebody created by mistake, which is what the control is mostly for."""

        assert find_spieltag_retire_refusal(played_count=0) is None

    @pytest.mark.parametrize("played", [1, 8])
    def test_a_matchday_holding_a_result_is_refused(self, played):
        """
        One result is enough, because the harm is not proportional to the count.

        What goes wrong is that a result the league produced stops appearing on the public Spielplan,
        and that happens at the first one.
        """

        refusal = find_spieltag_retire_refusal(played_count=played)

        assert refusal is not None
        assert refusal[0] == SPIELTAG_HOLDS_PLAYED

    def test_the_refusal_names_the_count(self):
        """
        The count is the actionable part.

        It tells an admin how much sits behind the matchday they are about to hide, which is the
        difference between a mis-created row and a round that was played.
        """

        refusal = find_spieltag_retire_refusal(played_count=3)

        assert refusal is not None
        assert "3" in refusal[1]


class TestChangingThePhase:
    def test_a_matchday_matching_its_phase_is_legal(self):
        assert find_spieltag_phase_refusal(attached_count=8, expected_count=8) is None

    def test_a_matchday_still_being_filled_in_is_legal(self):
        """
        The direction that stays permitted, deliberately.

        A season being set up holds fewer fixtures than its rules imply at every point on the way to
        holding all of them (ADR-0065), so refusing here would refuse the setup rather than a mistake.
        """

        assert find_spieltag_phase_refusal(attached_count=0, expected_count=8) is None
        assert find_spieltag_phase_refusal(attached_count=7, expected_count=8) is None

    def test_one_fixture_too_many_is_refused(self):
        """A single round robin per group fixes the number exactly, so there is no slack to allow."""

        refusal = find_spieltag_phase_refusal(attached_count=9, expected_count=8)

        assert refusal is not None
        assert refusal[0] == SPIELTAG_OVER_ITS_PHASE

    def test_a_phase_this_season_does_not_reach_accounts_for_nothing(self):
        """
        `expected_matches` answers 0 for a knockout round the bracket never gets to.

        The refusal then follows from the ordinary comparison rather than from a special case: those
        fixtures have nowhere to be played.
        """

        refusal = find_spieltag_phase_refusal(attached_count=2, expected_count=0)

        assert refusal is not None
        assert refusal[0] == SPIELTAG_OVER_ITS_PHASE

    def test_an_empty_matchday_in_an_unreached_phase_is_legal(self):
        """
        Both counts zero, which contradicts nothing.

        A season that plans a round of sixteen it will not reach has a matchday with no fixtures, and
        the admin list reporting `0 / 0` says exactly that.
        """

        assert find_spieltag_phase_refusal(attached_count=0, expected_count=0) is None

    def test_the_two_refusals_are_distinct(self):
        """Different advice — cancel or enter results, against move fixtures — so different codes."""

        assert SPIELTAG_HOLDS_PLAYED != SPIELTAG_OVER_ITS_PHASE
