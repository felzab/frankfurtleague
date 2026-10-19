from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spiele.services import ANSETZUNG_BESTAETIGT, SAISON_TEAMS_AS_NAME, SPIELBESTAETIGUNGEN_AS_NAME, build_spiele_pipeline
from app.core.collections import Collection
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import spiel_document, spielbestaetigung_document
from tests.worker import worker_database

from .conftest import AUSTRITT, PRIOR_SAISON, SAISON, TEAM_OIDS, SeededLeague

pytestmark = pytest.mark.db

# Its own database: the verdict's cases write rows and move a fixture, and `league` is shared.
VERDICT_DATABASE = worker_database("fl_spiele_verdict_test")


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


VERDICT_SPIEL_ID = ObjectId("6890a1b2c3d4e5f607250001")
VERDICT_HOME = ObjectId("6890a1b2c3d4e5f607250011")
VERDICT_AWAY = ObjectId("6890a1b2c3d4e5f607250012")
VERDICT_SPIELORT_ID = ObjectId("6890a1b2c3d4e5f607250021")

DATUM = "2026-05-02"
MOVED_DATUM = "2026-05-09"


def a_fixture(*, with_ground: bool = True) -> dict[str, Any]:
    ort = {"spielort_id": VERDICT_SPIELORT_ID, "name": "Sportplatz Ost", "maps_link": "Sportplatz Ost, Frankfurt", "mietpreis": 80}

    return spiel_document(
        spiel_id=VERDICT_SPIEL_ID,
        saison_id=SAISON,
        spiel_nr=1,
        spieltag_id=ObjectId("6890a1b2c3d4e5f6072500a1"),
        team1={"team_id": VERDICT_HOME, "name": "Alpha", "shorthand": "AL", "tore": None},
        team2={"team_id": VERDICT_AWAY, "name": "Beta", "shorthand": "BE", "tore": None},
        datum=DATUM,
        uhrzeit="18:00:00",
        ort=ort if with_ground else None,
    )


def zugesagt() -> dict[str, Any]:
    return {"art": "zugesagt", "am": "2026-04-20", "von": {"art": "kontakt", "rolle": "trainer"}, "vorschlag": None, "begruendung": None}


def a_row(fixture: Mapping[str, Any], team_id: ObjectId, **fields: Any) -> dict[str, Any]:
    return spielbestaetigung_document(fixture, partei={"art": "team", "team_id": team_id}, **fields)


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_fixture(url: str, fixture: dict[str, Any], rows: list[dict[str, Any]], body: Body) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, VERDICT_DATABASE, constraints=True) as (_, database):
            await database[Collection.SPIELE].insert_one(fixture)
            if rows:
                await database[Collection.SPIELBESTAETIGUNGEN].insert_many(rows)

            return await body(database)

    return on_the_seed_loop(_run())


async def joined(database: AsyncDatabase) -> dict[str, Any]:
    cursor = await database[Collection.SPIELE].aggregate(build_spiele_pipeline(db_filter={"_id": VERDICT_SPIEL_ID}))
    (document,) = await cursor.to_list()

    return document


async def verdict(database: AsyncDatabase) -> bool | None:
    return (await joined(database))[ANSETZUNG_BESTAETIGT]


class TestTheVerdictReadsTheAnsetzungAsItStandsNow:
    @pytest.mark.parametrize("with_ground", [pytest.param(True, id="with a ground"), pytest.param(False, id="without a ground")])
    def test_both_clubs_agreeing_confirms_it(self, mongo_url: str, with_ground: bool):
        """Without a ground the row stores a null the fixture's path lacks: drop an `$ifNull` from the `let` and no such fixture confirms."""

        fixture = a_fixture(with_ground=with_ground)
        rows = [a_row(fixture, VERDICT_HOME, antwort=zugesagt()), a_row(fixture, VERDICT_AWAY, antwort=zugesagt())]

        document = on_a_fixture(mongo_url, fixture, rows, joined)

        assert document[ANSETZUNG_BESTAETIGT] is True
        assert SPIELBESTAETIGUNGEN_AS_NAME not in document

    def test_a_club_yet_to_answer_leaves_it_provisional(self, mongo_url: str):
        fixture = a_fixture()
        rows = [a_row(fixture, VERDICT_HOME, antwort=zugesagt()), a_row(fixture, VERDICT_AWAY)]

        assert on_a_fixture(mongo_url, fixture, rows, verdict) is False

    def test_an_answer_whose_row_closed_stops_counting(self, mongo_url: str):
        """A discarded agreement stays on its row; read as open, it would go on confirming the fixture."""

        fixture = a_fixture()
        rows = [
            a_row(fixture, VERDICT_HOME, antwort=zugesagt()),
            a_row(fixture, VERDICT_AWAY, antwort=zugesagt(), geschlossen={"am": "2026-04-21", "grund": "verworfen"}),
        ]

        assert on_a_fixture(mongo_url, fixture, rows, verdict) is False

    def test_a_moved_fixture_reads_as_never_asked_in_the_very_next_read(self, mongo_url: str):
        """No sweep runs, so both agreements stay open: only the join's comparison keeps a date nobody agreed to off the card as confirmed."""

        fixture = a_fixture()
        rows = [a_row(fixture, VERDICT_HOME, antwort=zugesagt()), a_row(fixture, VERDICT_AWAY, antwort=zugesagt())]

        async def body(database: AsyncDatabase) -> tuple[bool | None, bool | None]:
            before = await verdict(database)
            await database[Collection.SPIELE].update_one({"_id": VERDICT_SPIEL_ID}, {"$set": {"datum": MOVED_DATUM}})

            return before, await verdict(database)

        assert on_a_fixture(mongo_url, fixture, rows, body) == (True, None)


def test_the_confirmation_lookup_plans_an_index_scan(mongo_url: str):
    """Every fixture of the most-read endpoint runs the sub-pipeline once, a scan no test database of a few rows shows."""

    fixture = a_fixture()

    async def body(database: AsyncDatabase) -> Mapping[str, Any]:
        command = {"aggregate": str(Collection.SPIELE), "pipeline": build_spiele_pipeline(db_filter={"_id": VERDICT_SPIEL_ID}), "cursor": {}}
        explained = await database.command({"explain": command, "verbosity": "executionStats"})

        # The `$lookup` reports what its sub-pipeline used beside the stage itself.
        (stage,) = [stage for stage in explained["stages"] if stage.get("$lookup", {}).get("from") == Collection.SPIELBESTAETIGUNGEN]
        return stage

    stage = on_a_fixture(mongo_url, fixture, [a_row(fixture, VERDICT_HOME), a_row(fixture, VERDICT_AWAY)], body)

    assert (stage["indexesUsed"], stage["collectionScans"]) == (["spielbestaetigungen_saison_id_spiel_id"], 0), stage
