from http import HTTPStatus

from app.api.saisons.services import find_gruppe_swap_refusal
from app.core.codes import Code


class TestWhatCountsAsASwap:
    def test_a_pick_that_is_no_swap_is_refused(self):
        # Two clubs of one group: let through, it would trade the two clubs' fixtures and answer as if it had moved them.
        refusal = find_gruppe_swap_refusal(
            team1_gruppe="A",
            team2_gruppe="A",
            saison_status="active",
            started=False,
        )

        assert refusal is not None
        # The pick of two clubs is what is refused, on no box: the second picker offers only another group's clubs.
        assert (refusal.error_code, refusal.status_code, refusal.faults, refusal.subject) == (
            Code.SWAP_NOT_A_SWAP,
            HTTPStatus.UNPROCESSABLE_CONTENT,
            (),
            None,
        )
