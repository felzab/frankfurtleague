from http import HTTPStatus

from app.api.teams.services import find_gruppe_swap_refusal
from app.core.codes import Code


class TestWhatCountsAsASwap:
    def test_two_clubs_of_one_group_are_refused(self):
        """Exchanging within one group is no swap: let through, it trades the two clubs' fixtures and answers as if it had moved them."""

        refusal = find_gruppe_swap_refusal(
            team1_gruppe="A",
            team2_gruppe="A",
            saison_status="active",
            started=False,
        )

        assert refusal is not None
        # The pick of two clubs is what is refused, so on both boxes.
        assert (refusal.error_code, refusal.status, refusal.fields) == (
            Code.SWAP_NOT_A_SWAP,
            HTTPStatus.UNPROCESSABLE_CONTENT,
            (("team1_id",), ("team2_id",)),
        )
