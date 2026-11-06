from collections.abc import Awaitable, Callable, Iterable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.teams.admin_router import patch_team
from app.api.teams.schemas import FLPatchTeamPayload, FLPatchTeamResponse
from app.core.collections import Collection
from tests.database import DOCUMENT_VALIDATION_FAILED, a_clean_database, on_the_seed_loop
from tests.documents import ADDRESS, saison_document, saison_team_document, team_document
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_reference_fanout_test")

# Fixed rather than generated, so a failure names the same row every run.
TEAM_OID = ObjectId("6890a1b2c3d4e5f607400021")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607400022")

TEAM_NAMES = {
    TEAM_OID: ("Carl-Schurz", "CSX"),
    OTHER_TEAM_OID: ("Lessing", "LEX"),
}

RENAMED_TEAM = "Carl-Schurz-Gymnasium"
# Both copies change, so a pass writing one field and not the other shows on the row.
RENAMED_SHORTHAND = "CGX"

WEBSITE_URL = "https://example.com"

SAISON_ID = "2026"
PAST_SAISON_ID = "2025"


def seeded_team_document(team_id: ObjectId) -> dict[str, Any]:
    """Every field `FLTeamRecord` reads: the endpoint validates the document it wrote before echoing it."""

    name, shorthand = TEAM_NAMES[team_id]

    return team_document(team_id, name, shorthand, website_url=WEBSITE_URL)


def junction_document(team_id: ObjectId, saison_id: str) -> dict[str, Any]:
    """The season's own copy of the club's identity, which every fixture of the season reads its side's name from."""

    name, shorthand = TEAM_NAMES[team_id]

    return saison_team_document(saison_id, team_id, name, shorthand, gruppe="A")


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_database(url: str, body: Body, *, mutates_schema: bool = False) -> Any:
    """A replica set, not the standalone: the rename writes in a transaction, and seeding runs outside it.

    `mutates_schema=True` where the body attaches a validator (`tests/database.py :: a_clean_database`).
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, mutates_schema=mutates_schema) as (client, database):
            await database[Collection.TEAMS].insert_many([seeded_team_document(oid) for oid in TEAM_NAMES])
            # `status` is the only field `patch_team` reads of a season.
            await database[Collection.SAISONS].insert_many([saison_document(SAISON_ID, "active"), saison_document(PAST_SAISON_ID, "past")])
            # The renamed club is in both seasons; another club is in the open one, so the filter is proved to exclude a row.
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    junction_document(TEAM_OID, SAISON_ID),
                    junction_document(TEAM_OID, PAST_SAISON_ID),
                    junction_document(OTHER_TEAM_OID, SAISON_ID),
                ]
            )
            return await body(database, client)

    return on_the_seed_loop(_run())


def renamed_team_body() -> dict[str, Any]:
    return {
        "name": RENAMED_TEAM,
        "shorthand": RENAMED_SHORTHAND,
        "description": "",
        "full_name": f"{RENAMED_TEAM}-Schule",
        "website_url": WEBSITE_URL,
        # Sent because the payload defaults none of its fields, not because a rename touches it.
        "schulform": "gymnasium_g9",
        "address": dict(ADDRESS),
    }


async def rename_the_team(database: AsyncDatabase, client: AsyncMongoClient) -> FLPatchTeamResponse:
    """The shorthand moves with the name, because a match card shows whichever of the two fits."""

    return await patch_team(
        team_id=TEAM_OID,
        team_data=FLPatchTeamPayload.model_validate(renamed_team_body()),
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        db=client,
    )


async def stored_junctions(database: AsyncDatabase) -> dict[tuple[Any, str], Mapping[str, Any]]:
    """Keyed by the pair that identifies a row, so a failing assertion names the club and the season."""

    rows = await database[Collection.SAISON_TEAMS].find().to_list(length=None)

    return {(row["team_id"], row["saison_id"]): row for row in rows}


async def stored_teams(database: AsyncDatabase) -> dict[Any, Mapping[str, Any]]:
    return {row["_id"]: row for row in await database[Collection.TEAMS].find().to_list(length=None)}


def only_these_names(allowed: Iterable[str]) -> dict[str, Any]:
    """A `$jsonSchema` refusing any other value at `name`, which is how this repo forces a failure mid-transaction."""

    return {"bsonType": "object", "properties": {"name": {"enum": sorted(allowed)}}}


def after_renaming(url: str) -> dict[tuple[Any, str], Mapping[str, Any]]:
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await rename_the_team(database, client)

        return await stored_junctions(database)

    return on_a_database(url, body)


@pytest.mark.db
class TestAClubRenameReachesTheJunctionRowsOfItsOpenSeasons:
    """The season's own copy of the identity: without this pass every table and fixture would read the club's old name."""

    def test_the_open_seasons_row_is_rewritten(self, mongo_replica_set_url: str):
        junctions = after_renaming(mongo_replica_set_url)
        row = junctions[(TEAM_OID, SAISON_ID)]

        assert (row["name"], row["shorthand"]) == (RENAMED_TEAM, RENAMED_SHORTHAND)

    def test_a_closed_seasons_row_is_left_alone(self, mongo_replica_set_url: str):
        """A `past` season is the record of what happened, so its fixtures keep the name it was played under."""

        junctions = after_renaming(mongo_replica_set_url)
        row = junctions[(TEAM_OID, PAST_SAISON_ID)]

        assert (row["name"], row["shorthand"]) == TEAM_NAMES[TEAM_OID]

    def test_another_clubs_row_in_the_same_season_is_untouched(self, mongo_replica_set_url: str):
        """Without this the case above passes for a pass that ignores `team_id` and rewrites the season."""

        junctions = after_renaming(mongo_replica_set_url)
        row = junctions[(OTHER_TEAM_OID, SAISON_ID)]

        assert (row["name"], row["shorthand"]) == TEAM_NAMES[OTHER_TEAM_OID]

    def test_the_group_survives_the_rewrite(self, mongo_replica_set_url: str):
        """`gruppe` and `austritt` are the row's own state: a `$set` reaching them would move a club between groups on a rename."""

        junctions = after_renaming(mongo_replica_set_url)
        row = junctions[(TEAM_OID, SAISON_ID)]

        assert (row["gruppe"], row["austritt"]) == ("A", None)


@pytest.mark.db
class TestAMidFlightFailureTakesTheWholeRenameBack:
    def test_the_club_keeps_no_rename_its_season_rows_could_not_take(self, mongo_replica_set_url: str):
        """The club write and the rows' are one transaction: the club document has landed when the rows' write is refused."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            allowed = [name for name, _ in TEAM_NAMES.values()]
            # Installed after the seeding, so it constrains only what the rename is about to write.
            await database.command(
                "collMod", Collection.SAISON_TEAMS.value, validator={"$jsonSchema": only_these_names(allowed)}, validationLevel="strict"
            )

            with pytest.raises(OperationFailure) as failure:
                await rename_the_team(database, client)

            return failure.value.code, await stored_teams(database)

        code, teams = on_a_database(mongo_replica_set_url, body, mutates_schema=True)

        assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the rows' write, got code {code}"
        assert (teams[TEAM_OID]["name"], teams[TEAM_OID]["shorthand"]) == TEAM_NAMES[TEAM_OID], "the club kept a rename its rows never got"
