from typing import Any

import pytest
from bson import ObjectId

from app.api.spiele.services import SAISON_TEAMS_AS_NAME, build_spiele_pipeline

from .conftest import AUSTRITT, PRIOR_SAISON, SAISON, TEAM_OIDS, SeededLeague

pytestmark = pytest.mark.db


def spiel(league: SeededLeague, spiel_nr: int, saison_id: str = SAISON) -> dict[str, Any]:
    documents = list(league.database.spiele.aggregate(build_spiele_pipeline(db_filter={"spiel_nr": spiel_nr, "saison_id": saison_id})))

    assert len(documents) == 1, f"expected exactly one match {spiel_nr} in {saison_id}, got {len(documents)}"
    return documents[0]


class TestTheJoinedDisqualification:
    def test_a_disqualified_side_carries_the_whole_record(self, league: SeededLeague) -> None:
        """The projection is the whole record; which half of it each read model declares is `test_spiele_public_read.py`'s subject."""

        assert spiel(league, 3)["team2"]["austritt"] == AUSTRITT

    def test_a_competing_side_carries_null(self, league: SeededLeague) -> None:
        """`null` is what not disqualified means, and there is no boolean anywhere."""

        assert spiel(league, 3)["team1"]["austritt"] is None

    def test_each_side_reads_its_own_row(self, league: SeededLeague) -> None:
        """One lookup serves both sides: a join matching rows by position rather than `team_id` still returns one record and one null."""

        match_3 = spiel(league, 3)

        assert match_3["team1"]["name"] == "Helmholtz"
        assert match_3["team1"]["austritt"] is None
        assert match_3["team2"]["name"] == "Lessing"
        assert match_3["team2"]["austritt"] == AUSTRITT

    def test_the_season_is_the_fixtures_own_and_not_a_resolved_one(self, league: SeededLeague) -> None:
        """Every match read runs this pipeline, so keying on `team_id` alone badges a match played before the decision."""

        match_8 = spiel(league, 8, saison_id=PRIOR_SAISON)

        assert match_8["team2"]["name"] == "Lessing"
        assert match_8["team2"]["austritt"] is None

    def test_a_side_whose_team_holds_no_row_for_the_season_carries_null(self, league: SeededLeague) -> None:
        """No junction row is not a disqualification: that is `REQ-ELIGIBILITY-002`'s fact, and this field answers a different one."""

        assert spiel(league, 8, saison_id=PRIOR_SAISON)["team1"]["austritt"] is None


class TestWhatTheMergeMustNotBreak:
    def test_an_unresolved_side_stays_null(self, league: SeededLeague) -> None:
        """An empty object would render as a resolved side with a blank name: every card reads `team?.name ?? formatQuelle(...)`."""

        assert spiel(league, 9)["team1"] is None

    def test_the_stored_keys_survive_the_merge(self, league: SeededLeague) -> None:
        """`$mergeObjects` adds one key; listing the stored ones instead would drop whatever it missed."""

        team2 = spiel(league, 9)["team2"]

        assert team2["team_id"] == TEAM_OIDS["Bock"]
        assert team2["name"] == "Bock"
        assert team2["tore"] is None

    def test_the_lookup_rows_do_not_reach_the_result(self, league: SeededLeague) -> None:
        """Pydantic ignores an undeclared key, so nothing else would report the junction travelling twice over."""

        assert SAISON_TEAMS_AS_NAME not in spiel(league, 3)


class TestTheFilterAndTheOrder:
    def test_the_filter_still_selects(self, league: SeededLeague) -> None:
        """The `$match` is the same document a `find` took, so the endpoints' parameters are unchanged."""

        db_filter = {"saison_id": SAISON, "sonderereignis": {"$ne": None}}
        eventful = list(league.database.spiele.aggregate(build_spiele_pipeline(db_filter=db_filter)))

        # Sorted rather than taken in pipeline order: with no `sort_by` the order is the storage engine's.
        assert sorted(document["spiel_nr"] for document in eventful) == [4, 10, 11, 13, 14]

    def test_the_sort_and_the_limit_run_before_the_join(self, league: SeededLeague) -> None:
        """Asserted through the result: a `$sort` after the `$limit` cuts the wrong fixtures, and both orders return three."""

        first_three = list(
            league.database.spiele.aggregate(build_spiele_pipeline(db_filter={"saison_id": SAISON}, sort_by=[("spiel_nr", 1)], limit=3))
        )

        assert [document["spiel_nr"] for document in first_three] == [1, 2, 3]

    def test_a_filter_matching_nothing_returns_nothing(self, league: SeededLeague) -> None:
        """The empty result is a list, which is why `get_spiel` raises its own 404 rather than reading a `None`."""

        assert list(league.database.spiele.aggregate(build_spiele_pipeline(db_filter={"_id": ObjectId()}))) == []
