"""
SPIELE · `build_spiele_pipeline` executed by a real MongoDB (ADR-0023)

The same split as the team pipeline's two suites: `test_spiele.py` asserts what the models
accept and this asserts what MongoDB computes — only a database proves a `$lookup` correlates on
the right keys and a null side survives it. What is proved is one rule with four edges: a side
carries the `disqualifikation` of the junction row for its own team and THIS fixture's season
(ADR-0021, ADR-0047), and the 2025 fixture is the sharpest edge, because every wrong join key
passes the 2026 cases and fails that one.

Every test is marked `db` and deselected by default (`fl_backend/tests/README.md`).
The corpus and its reasoning are documented in `conftest.py`; this module asserts against them.
"""

from typing import Any

import pytest
from bson import ObjectId

from app.api.spiele.services import SAISON_TEAMS_AS_NAME, build_spiele_pipeline

from .conftest import DISQUALIFIKATION, PRIOR_SAISON, SAISON, TEAM_OIDS, SeededLeague

pytestmark = pytest.mark.db


def spiel(league: SeededLeague, spiel_nr: int, saison_id: str = SAISON) -> dict[str, Any]:
    """One fixture through the real pipeline, addressed the way a test names it rather than by id."""

    documents = list(league.database.spiele.aggregate(build_spiele_pipeline(db_filter={"spiel_nr": spiel_nr, "saison_id": saison_id})))

    assert len(documents) == 1, f"expected exactly one match {spiel_nr} in {saison_id}, got {len(documents)}"
    return documents[0]


class TestTheJoinedDisqualification:
    def test_a_disqualified_side_carries_the_whole_record(self, league: SeededLeague) -> None:
        """The badge needs only presence, but the record is what is projected -- so a popover can say why."""

        assert spiel(league, 3)["team2"]["disqualifikation"] == DISQUALIFIKATION

    def test_a_competing_side_carries_null(self, league: SeededLeague) -> None:
        """`null` is what "not disqualified" means, and there is no boolean anywhere (ADR-0047)."""

        assert spiel(league, 3)["team1"]["disqualifikation"] is None

    def test_each_side_reads_its_own_row(self, league: SeededLeague) -> None:
        """
        One lookup serves both sides, so the two could be crossed and no smaller test would see it.

        Match 3 is the pairing that catches it: Helmholtz competes and Lessing does not, so a join
        matching rows to sides by position rather than by `team_id` swaps the two and still returns
        one record and one null.
        """

        match_3 = spiel(league, 3)

        assert match_3["team1"]["name"] == "Helmholtz"
        assert match_3["team1"]["disqualifikation"] is None
        assert match_3["team2"]["name"] == "Lessing"
        assert match_3["team2"]["disqualifikation"] == DISQUALIFIKATION

    def test_the_season_is_the_fixtures_own_and_not_a_resolved_one(self, league: SeededLeague) -> None:
        """
        A 2025 fixture never shows a 2026 disqualification, and this is the case the whole key exists for.

        `find_bracket_faults` reads every season in one pass, so the lookup cannot be keyed on a season
        the caller resolved. Lessing is disqualified in 2026 and plays match 8 in 2025; keying on
        `team_id` alone, or on a fixed current season, puts a badge on a match played a year before the
        decision was taken.
        """

        match_8 = spiel(league, 8, saison_id=PRIOR_SAISON)

        assert match_8["team2"]["name"] == "Lessing"
        assert match_8["team2"]["disqualifikation"] is None

    def test_a_side_whose_team_holds_no_row_for_the_season_carries_null(self, league: SeededLeague) -> None:
        """
        No junction row is not a disqualification, and this field answers only the second question.

        Helmholtz holds no 2025 row at all. That state IS refusable when a team is newly fielded
        (`REQ-ELIGIBILITY-002`), but it is a different fact and the read does not conflate the two.
        """

        assert spiel(league, 8, saison_id=PRIOR_SAISON)["team1"]["disqualifikation"] is None


class TestWhatTheMergeMustNotBreak:
    def test_an_unresolved_side_stays_null(self, league: SeededLeague) -> None:
        """
        A bracket slot with no occupant is `None`, never an object carrying only a disqualification.

        `FLSpielJoined.team1` is nullable and every card reads `team?.name ?? formatQuelle(...)`, so an
        empty object here would render as a resolved side with a blank name (ADR-0034).
        """

        assert spiel(league, 9)["team1"] is None

    def test_the_stored_keys_survive_the_merge(self, league: SeededLeague) -> None:
        """`$mergeObjects` ADDS one key. Listing the stored ones instead would drop whatever it missed."""

        team2 = spiel(league, 9)["team2"]

        assert team2["team_id"] == TEAM_OIDS["Bock"]
        assert team2["name"] == "Bock"
        assert team2["tore"] is None

    def test_the_lookup_rows_do_not_reach_the_result(self, league: SeededLeague) -> None:
        """
        The joined rows are working state and belong to no model.

        Pydantic ignores an undeclared key, so nothing else would report them and every response would
        carry the junction twice over.
        """

        assert SAISON_TEAMS_AS_NAME not in spiel(league, 3)


class TestTheFilterAndTheOrder:
    def test_the_filter_still_selects(self, league: SeededLeague) -> None:
        """The `$match` is the same document a `find` took, so the endpoints' parameters are unchanged."""

        canceled = list(league.database.spiele.aggregate(build_spiele_pipeline(db_filter={"saison_id": SAISON, "is_canceled": True})))

        # Sorted rather than taken in pipeline order: no `sort_by` is passed here, so the order is
        # the storage engine's and asserting it would make this test about something it is not.
        assert sorted(document["spiel_nr"] for document in canceled) == [4, 10, 11]

    def test_the_sort_and_the_limit_run_before_the_join(self, league: SeededLeague) -> None:
        """
        Ordering and truncation happen on the stored documents, so the lookup runs over what survives.

        Asserted through the result rather than the stage list: a `$sort` after the `$limit` would cut
        the wrong three fixtures, and both orders return three documents.
        """

        first_three = list(
            league.database.spiele.aggregate(build_spiele_pipeline(db_filter={"saison_id": SAISON}, sort_by=[("spiel_nr", 1)], limit=3))
        )

        assert [document["spiel_nr"] for document in first_three] == [1, 2, 3]

    def test_a_filter_matching_nothing_returns_nothing(self, league: SeededLeague) -> None:
        """The empty result is a list, which is why `get_spiel` raises its own 404 rather than reading a `None`."""

        assert list(league.database.spiele.aggregate(build_spiele_pipeline(db_filter={"_id": ObjectId()}))) == []
