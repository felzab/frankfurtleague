from app.api.saisons.services import find_saison_start_refusal, has_started
from app.core.codes import Code

# The day every case is judged on, so the stored start is the only thing a case moves.
TODAY = "2026-04-01"


class TestTheSeasonStartsOnItsStartDate:
    """The one start every start lock, the Nachnominierung and the landing read."""

    def test_the_day_before_is_not_yet_started(self):
        assert has_started(start_date="2026-04-02", today=TODAY) is False

    def test_the_start_date_itself_is_started(self):
        """The day itself, not the day after: the countdown reaches 00:00 of it, and the locks close with it."""

        assert has_started(start_date=TODAY, today=TODAY) is True

    def test_a_later_day_is_started(self):
        assert has_started(start_date="2026-03-15", today=TODAY) is True


class TestTheStartIsFixedOnceAFixtureHasTakenPlace:
    """`saison_start_taken_place`: compared by value, so only a MOVED start is refused, and only after play."""

    def test_a_moved_start_after_play_is_refused(self):
        refusal = find_saison_start_refusal(stored_start_date="2026-03-01", proposed_start_date="2026-03-08", taken_place=True)

        assert refusal is not None and refusal.error_code == Code.SAISON_START_TAKEN_PLACE

    def test_a_resubmitted_start_after_play_passes(self):
        """A dates-only edit of the end resubmits the stored start, which has to pass on a played season."""

        assert find_saison_start_refusal(stored_start_date="2026-03-01", proposed_start_date="2026-03-01", taken_place=True) is None

    def test_a_moved_start_before_play_passes(self):
        """The way a season frozen too early is unlocked."""

        assert find_saison_start_refusal(stored_start_date="2026-03-01", proposed_start_date="2026-05-01", taken_place=False) is None
