from http import HTTPStatus

from bson import ObjectId

from app.api.teams.services import (
    SWAP_ONE_CLUB_TWICE,
    find_swap_pair_refusal,
)

OID = ObjectId("6890a1b2c3d4e5f60fff0001")


class TestOneClubNamedTwice:
    def test_two_clubs_pass(self):
        assert find_swap_pair_refusal(team1_id=OID, team2_id=ObjectId("6890a1b2c3d4e5f60fff0002")) is None

    def test_one_club_named_twice_is_refused_as_the_payload(self):
        """The ids say so, not the groups, which agree either way; a 422 naming both fields, no season making one club a pair."""

        refusal = find_swap_pair_refusal(team1_id=OID, team2_id=ObjectId(str(OID)))

        assert refusal is not None
        assert (refusal.error_code, refusal.status, refusal.fields) == (
            SWAP_ONE_CLUB_TWICE,
            HTTPStatus.UNPROCESSABLE_CONTENT,
            (("team1_id",), ("team2_id",)),
        )


# The shape `pull_many_from_db` hands the handler.
HOME, AWAY, OTHER = "home", "away", "other"
