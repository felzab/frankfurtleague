from app.api.spieltage.services import find_spieltag_order_refusal
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
        refusal = find_spieltag_order_refusal(start=start, stored_start=stored, previous_start=previous, following_start=following)

        return None if refusal is None else (refusal.code, refusal.path, refusal.bounds)

    def test_a_first_dating_is_judged_against_both_sides(self):
        """An undated matchday sits in no pair, so its first date introduces whatever it lands in, in either direction."""

        assert self.order(start="2026-05-04", stored=None, previous="2026-05-05") is not None
        assert self.order(start="2026-05-21", stored=None, following="2026-05-20") is not None

    def test_a_step_towards_the_stored_violation_is_refused_naming_the_neighbours_start(self):
        """Without the neighbour's start the start box cannot say which day the matchday must keep to."""

        towards_the_predecessor = self.order(start="2026-05-08", stored="2026-05-10", previous="2026-05-20")
        away_from_the_follower = self.order(start="2026-05-12", stored="2026-05-10", following="2026-05-05")

        assert towards_the_predecessor == (Code.SPIELTAG_START_OUT_OF_ORDER, ("start",), {"earliest": "2026-05-20"})
        assert away_from_the_follower == (Code.SPIELTAG_START_OUT_OF_ORDER, ("start",), {"latest": "2026-05-05"})
