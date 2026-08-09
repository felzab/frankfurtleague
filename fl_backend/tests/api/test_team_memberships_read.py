"""
TEAMS · the admin list's club-centric read

`GET /teams/memberships` answers "every team, and which seasons hold it" in one aggregation,
which the season-scoped `GET /teams` cannot. These default-tier cases pin the pipeline's three
deliberate differences from `build_team_pipeline` and the response model's shape; the db tier's
pipeline execution suite covers Mongo semantics for lookups generally.
"""

from app.api.teams.schemas import FLTeamsMembershipsResponse
from app.api.teams.services import build_team_memberships_pipeline


class TestTheMembershipsPipeline:
    def test_it_filters_nothing_out(self):
        # No $match at all: retired teams and teams in no season are exactly what the admin list
        # must still show.
        stages = [next(iter(stage)) for stage in build_team_memberships_pipeline()]
        assert "$match" not in stages

    def test_the_lookup_projects_the_junction_data_fields_only(self):
        lookup = next(stage["$lookup"] for stage in build_team_memberships_pipeline() if "$lookup" in stage)
        assert lookup["from"] == "saison_teams"
        projection = lookup["pipeline"][0]["$project"]
        assert projection == {"_id": 0, "saison_id": 1, "gruppe": 1, "disqualifikation": 1}

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
