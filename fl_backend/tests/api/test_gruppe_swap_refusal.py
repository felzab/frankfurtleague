from http import HTTPStatus

from bson import ObjectId

from app.api.teams.services import (
    find_gruppe_swap_refusal,
    find_swap_pair_refusal,
)
from app.core.codes import Code

OID = ObjectId("6890a1b2c3d4e5f60fff0001")


class TestOneClubNamedTwice:
    def test_two_clubs_pass(self):
        assert find_swap_pair_refusal(team1_id=OID, team2_id=ObjectId("6890a1b2c3d4e5f60fff0002")) is None

    def test_one_club_named_twice_is_refused_as_the_payload(self):
        """The ids say so, not the groups, which agree either way; a 422 naming both fields, no season making one club a pair."""

        refusal = find_swap_pair_refusal(team1_id=OID, team2_id=ObjectId(str(OID)))

        assert refusal is not None
        assert (refusal.error_code, refusal.status, refusal.fields) == (
            Code.SWAP_NOT_A_SWAP,
            HTTPStatus.UNPROCESSABLE_CONTENT,
            (("team1_id",), ("team2_id",)),
        )


class TestWhatCountsAsASwap:
    def test_two_clubs_of_one_group_are_refused(self):
        """Exchanging within one group is no swap: let through, it trades the two clubs' fixtures and answers as if it had moved them."""

        refusal = find_gruppe_swap_refusal(
            team1_gruppe="A",
            team2_gruppe="A",
            saison_status="active",
            started=False,
            taken_place=False,
        )

        assert refusal is not None
        # The pick of two clubs is what is refused, so on both boxes, as one club named twice is.
        assert (refusal.error_code, refusal.status, refusal.fields) == (
            Code.SWAP_NOT_A_SWAP,
            HTTPStatus.UNPROCESSABLE_CONTENT,
            (("team1_id",), ("team2_id",)),
        )
