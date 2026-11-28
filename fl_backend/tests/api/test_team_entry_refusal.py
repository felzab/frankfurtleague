from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.teams.admin_router import post_team_entry
from app.api.teams.schemas import FLPostTeamEntryPayload
from app.api.teams.services import (
    find_entry_refusal,
    find_entry_saison_refusal,
    find_replacement_pair_refusal,
)
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundError
from app.shared.schemas.literals import FLSpielerStufe
from tests.database import a_clean_database
from tests.documents import saison_document, team_document
from tests.isolation import refused_code
from tests.worker import worker_database

# Typed as the `Literal` list `FLSaisonRules` declares: a bare `list[str]` is invariant against it.
STUFEN: list[FLSpielerStufe] = ["E1", "Q1", "Q2", "Q3", "Q4"]

RULES = FLSaisonRules(
    win_points=3,
    draw_points=1,
    loss_points=0,
    qualifiers_per_gruppe=2,
    number_of_gruppen=2,
    teams_per_gruppe=4,
    tiebreak_order="tordifferenz",
    max_kader_size=50,
    forfeit_ergebnis=FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0),
    allowed_stufen=STUFEN,
)


class TestEnteringASeason:
    def test_the_active_season_is_refused(self):
        refusal = find_entry_saison_refusal(saison_status="active")
        assert refusal is not None
        assert refusal.error_code == Code.ENTRY_SAISON_NOT_FUTURE

    def test_a_past_season_is_refused(self):
        refusal = find_entry_saison_refusal(saison_status="past")
        assert refusal is not None
        assert refusal.error_code == Code.ENTRY_SAISON_NOT_FUTURE

    def test_a_group_the_season_does_not_run_is_refused(self):
        refusal = find_entry_refusal(gruppe="C", rules=RULES, occupied=0)
        assert refusal is not None
        assert refusal.error_code == Code.ENTRY_GRUPPE_NOT_OFFERED

    def test_one_team_named_on_both_ends_of_a_replacement_is_refused_as_the_payload(self):
        """Judged before any read, on no box: the incoming picker offers no club the season holds. Another club is no refusal of this rule."""

        team = ObjectId("6890a1b2c3d4e5f607230009")

        refusal = find_replacement_pair_refusal(team_id=team, incoming_team_id=team)

        assert refusal is not None
        assert (refusal.error_code, refusal.faults, refusal.subject) == (Code.REPLACE_ONE_TEAM_ON_BOTH_ENDS, (), None)
        assert find_replacement_pair_refusal(team_id=team, incoming_team_id=ObjectId("6890a1b2c3d4e5f60723000a")) is None


DATABASE_NAME = worker_database("fl_team_entry_test")
SAISON_ID = "2026"

# Fixed rather than generated, so a failure names the same club every run.
LIVE_OID = ObjectId("6890a1b2c3d4e5f607230001")
RETIRED_OID = ObjectId("6890a1b2c3d4e5f607230002")
ABSENT_OID = ObjectId("6890a1b2c3d4e5f607230003")

TEAM_NAMES = {LIVE_OID: ("Adler", "ADX"), RETIRED_OID: ("Bieber", "BIX")}


def seeded_team(team_id: ObjectId, inactive_since: str | None) -> dict[str, Any]:
    name, shorthand = TEAM_NAMES[team_id]

    return team_document(team_id, name, shorthand, website_url="https://example.com", inactive_since=inactive_since)


Body = Callable[[AsyncDatabase], Awaitable[Any]]


async def on_a_league(url: str, body: Body, *, saison_status: str = "future") -> Any:
    async with a_clean_database(url, DATABASE_NAME) as (_, database):
        await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, saison_status, rules=RULES.model_dump(mode="json")))
        await database[Collection.TEAMS].insert_many([seeded_team(LIVE_OID, None), seeded_team(RETIRED_OID, "2026-03-01")])

        return await body(database)


async def enter(database: AsyncDatabase, team_id: ObjectId) -> Any:
    return await post_team_entry(
        saison_id=SAISON_ID,
        entry_data=FLPostTeamEntryPayload.model_validate({"team": {"kind": "known", "team_id": team_id}, "gruppe": "A", "trikot_farbe": None}),
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        db=database.client,
    )


async def junction_rows(database: AsyncDatabase) -> list[dict[str, Any]]:
    return await database[Collection.SAISON_TEAMS].find().to_list(length=None)


@pytest.mark.db
class TestEnteringATeamThroughTheEndpoint:
    """`team_retired` and the 404 beside it, against a real mongod: a refusal that exists is not a refusal that is reached."""

    async def test_a_retired_team_is_refused_with_the_rule_that_stopped_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            return await refused_code(enter(database, RETIRED_OID)), await junction_rows(database)

        code, rows = await on_a_league(mongo_replica_set_url, body)

        assert code == Code.TEAM_RETIRED
        # The refusal has to stop the write, not merely accompany it.
        assert rows == []

    async def test_a_team_no_document_names_is_a_404_and_writes_nothing(self, mongo_replica_set_url: str):
        """The referential hole the club read closes: without it, the row would name a club `teams` does not hold."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(DocumentNotFoundError):
                await enter(database, ABSENT_OID)

            return await junction_rows(database)

        assert await on_a_league(mongo_replica_set_url, body) == []

    async def test_a_running_season_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        """The status gate is the entry's own call, so a route that skipped it would enter a club into a season under way."""

        async def body(database: AsyncDatabase) -> Any:
            return await refused_code(enter(database, LIVE_OID)), await junction_rows(database)

        assert await on_a_league(mongo_replica_set_url, body, saison_status="active") == (Code.ENTRY_SAISON_NOT_FUTURE, [])
