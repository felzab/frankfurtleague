from bson import ObjectId

from app.api.teams.schemas import FLTeamMembership
from app.api.teams.services import build_team_saisons_pipeline


class TestTheSaisonsPipeline:
    def test_the_lookup_projects_exactly_what_the_membership_model_declares(self):
        """Against the MODEL, not a hand-copied list: a field added to the junction reaches this read only by being named on both."""

        lookup = next(stage["$lookup"] for stage in build_team_saisons_pipeline(ObjectId()) if "$lookup" in stage)
        assert lookup["from"] == "saison_teams"
        projection = lookup["pipeline"][0]["$project"]
        # Composed after the read, off the seats' addresses; the row's id keys the read of its links' mails.
        composed = {"address_change"}
        assert projection == {"_id": 1} | {name: 1 for name in FLTeamMembership.model_fields if name not in composed}
