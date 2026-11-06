from app.api.spieltage.services import (
    DatedNeighbour,
    dated_neighbour,
    dated_start,
    find_spieltag_order_refusal,
)
from app.core.codes import Code


class TestAMatchdayNeverBeginsBeforeItsPredecessor:
    """`spieltag_start_out_of_order`: `position` and `start` order a phase independently, and this is what holds the two together."""

    def order(
        self,
        *,
        start: str,
        stored: str | None = "2026-05-10",
        previous: str | None = None,
        following: str | None = None,
    ):
        """The neighbours as bare dates, at fixed positions: every case below turns on the dates alone."""

        return find_spieltag_order_refusal(
            start=start,
            stored_start=stored,
            previous=None if previous is None else DatedNeighbour(position=2, start=previous),
            following=None if following is None else DatedNeighbour(position=4, start=following),
        )

    def test_a_matchday_beginning_after_its_predecessor_passes(self):
        assert self.order(start="2026-05-12", previous="2026-05-05", following="2026-05-20") is None

    def test_a_matchday_beginning_before_its_predecessor_is_refused(self):
        refusal = self.order(start="2026-05-04", previous="2026-05-05")

        assert refusal is not None
        assert refusal.error_code == Code.SPIELTAG_START_OUT_OF_ORDER

    def test_the_following_position_is_judged_too(self):
        """Moving one matchday breaks the pair on either side of it, and a rule watching one side would miss half of them."""

        refusal = self.order(start="2026-05-21", following="2026-05-20")

        assert refusal is not None
        assert refusal.error_code == Code.SPIELTAG_START_OUT_OF_ORDER

    def test_two_matchdays_may_begin_on_one_day(self):
        """Only BEFORE is refused: two matchdays of a phase sharing a start date contradict no ordering."""

        assert self.order(start="2026-05-05", previous="2026-05-05") is None
        assert self.order(start="2026-05-20", following="2026-05-20") is None

    def test_an_undated_neighbour_constrains_nothing(self):
        """A generated matchday carries no dates, so a phase where nothing else is dated yet is the ordinary case."""

        assert self.order(start="2026-01-01") is None

    def test_a_first_dating_is_judged_against_both_sides(self):
        """An undated matchday sits in no pair, so its first date introduces whatever it lands in, in either direction."""

        assert self.order(start="2026-05-04", stored=None, previous="2026-05-05") is not None
        assert self.order(start="2026-05-21", stored=None, following="2026-05-20") is not None

    def test_a_resubmitted_start_passes_though_the_pair_is_backwards(self):
        """An `end`-only edit resubmits the stored `start`; refusing it would latch the season against its own repair."""

        assert self.order(start="2026-05-10", stored="2026-05-10", previous="2026-05-20") is None
        assert self.order(start="2026-05-10", stored="2026-05-10", following="2026-05-05") is None

    def test_a_step_towards_the_stored_violation_is_refused(self):
        towards_the_predecessor = self.order(start="2026-05-08", stored="2026-05-10", previous="2026-05-20")
        away_from_the_follower = self.order(start="2026-05-12", stored="2026-05-10", following="2026-05-05")

        assert towards_the_predecessor is not None and towards_the_predecessor.error_code == Code.SPIELTAG_START_OUT_OF_ORDER
        assert away_from_the_follower is not None and away_from_the_follower.error_code == Code.SPIELTAG_START_OUT_OF_ORDER

    def test_a_step_away_from_the_stored_violation_passes(self):
        """A partial repair still leaves the pair backwards, and refusing it would demand the whole distance in one edit."""

        assert self.order(start="2026-05-15", stored="2026-05-10", previous="2026-05-20") is None
        assert self.order(start="2026-05-07", stored="2026-05-10", following="2026-05-05") is None


class TestWhatCountsAsADatedNeighbour:
    """The null-span guard sits here rather than in the query, so a caller that forgets the filter still cannot break it."""

    def test_a_missing_row_is_no_neighbour(self):
        assert dated_neighbour(None) is None

    def test_an_undated_row_is_no_neighbour(self):
        """A `None` reaching the comparison raises rather than refusing, so what an undated row means is settled here."""

        assert dated_neighbour({"position": 2, "start": None}) is None

    def test_a_dated_row_comes_back_whole(self):
        assert dated_neighbour({"position": 2, "start": "2026-05-05"}) == DatedNeighbour(position=2, start="2026-05-05")

    def test_an_undated_subject_states_no_day_of_its_own(self):
        """The subject's own row goes through this read too, and its `None` is what tells the rule a first dating from a move."""

        assert dated_start({"position": 1, "start": None}) is None
        assert dated_start({"position": 1, "start": "2026-05-05"}) == "2026-05-05"
