from http import HTTPStatus

import pytest

from app.api.saisons.services import find_gruppe_swap_refusal
from app.core.codes import Code


class TestWhatCountsAsASwap:
    @pytest.mark.parametrize(
        ("team1_gruppe", "team2_gruppe"),
        [
            # Exchanging within one group: let through, it trades the two clubs' fixtures and answers as if it had moved them.
            pytest.param("A", "A", id="two teams of one group"),
            # A club the season holds no row of reads no group, and has none to exchange.
            pytest.param(None, "A", id="a club outside the season"),
        ],
    )
    def test_a_pick_that_is_no_swap_is_refused(self, team1_gruppe: str | None, team2_gruppe: str | None):
        refusal = find_gruppe_swap_refusal(
            team1_gruppe=team1_gruppe,
            team2_gruppe=team2_gruppe,
            saison_status="active",
            started=False,
        )

        assert refusal is not None
        # The pick of two clubs is what is refused, so on both boxes.
        assert (refusal.error_code, refusal.status_code, refusal.fields) == (
            Code.SWAP_NOT_A_SWAP,
            HTTPStatus.UNPROCESSABLE_CONTENT,
            (("team1_id",), ("team2_id",)),
        )
