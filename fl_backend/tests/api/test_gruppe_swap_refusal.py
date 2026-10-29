from http import HTTPStatus

from bson import ObjectId

from app.api.teams.services import (
    SWAP_NOT_A_SWAP,
    SWAP_ONE_CLUB_TWICE,
    find_gruppe_swap_refusal,
    find_swap_pair_refusal,
    fixtures_newly_fielding_a_departed_club,
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


class TestWhatCountsAsASwap:
    def test_two_clubs_of_one_group_are_refused(self):
        """Exchanging within one group is no swap: let through, it trades the two clubs' fixtures and answers as if it had moved them."""

        refusal = find_gruppe_swap_refusal(
            team1_gruppe="A",
            team2_gruppe="A",
            saison_status="active",
            played_knockout_fixtures=0,
            played_gruppenphase_fixtures=0,
            clashing_spieltage=0,
            departed_fixtures=0,
        )

        assert refusal is not None
        assert refusal.error_code == SWAP_NOT_A_SWAP


# The shape `pull_many_from_db` hands the handler.
HOME, AWAY, OTHER = "home", "away", "other"


class TestASwapNeverFieldsADisqualifiedClub:
    def test_the_effective_day_itself_counts(self):
        """Inclusive, as the eligibility rule's on-or-after boundary is: a swap must not field a club on the day its exit takes effect."""

        fixture = {"datum": "2026-04-01", "team1": {"team_id": AWAY}, "team2": {"team_id": OTHER}, "sonderereignis": None}

        assert (
            fixtures_newly_fielding_a_departed_club(
                team1_id=HOME, team2_id=AWAY, departed_since={HOME: "2026-04-01"}, gruppenphase_spiele=[fixture]
            )
            == 1
        )
