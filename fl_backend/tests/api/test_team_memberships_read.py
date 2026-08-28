from app.api.teams.schemas import FLTeamMembership, FLTeamsMembershipsResponse
from app.api.teams.services import build_team_memberships_pipeline


class TestTheMembershipsPipeline:
    def test_it_filters_nothing_out(self):
        # No `$match` at all: retired teams and teams in no season are what the admin list must show.
        stages = [next(iter(stage)) for stage in build_team_memberships_pipeline()]
        assert "$match" not in stages

    def test_the_lookup_projects_exactly_what_the_membership_model_declares(self):
        """Against the MODEL, not a hand-copied list: a field added to the junction reaches this read only by being named on both."""

        lookup = next(stage["$lookup"] for stage in build_team_memberships_pipeline() if "$lookup" in stage)
        assert lookup["from"] == "saison_teams"
        projection = lookup["pipeline"][0]["$project"]
        assert projection == {"_id": 0} | {name: 1 for name in FLTeamMembership.model_fields}

    def test_it_sorts_by_name(self):
        assert build_team_memberships_pipeline()[-1] == {"$sort": {"name": 1}}


class TestTheResponseModel:
    def test_an_empty_membership_list_is_a_valid_club(self):
        response = FLTeamsMembershipsResponse.model_validate(
            {
                "acknowledged": 1,
                "teams": [
                    {
                        "_id": "69ea37a048b415de4f59417b",
                        "name": "Muster",
                        "shorthand": "MU",
                        "description": "",
                        "full_name": "Musterschule",
                        "website_url": "https://example.org",
                        "address": {"strasse": "Weg", "hausnummer": "1", "plz": "60313", "stadtteil": "", "stadt": "Frankfurt"},
                        "inactive_since": None,
                        "memberships": [],
                    }
                ],
            }
        )
        assert response.teams[0].memberships == []
