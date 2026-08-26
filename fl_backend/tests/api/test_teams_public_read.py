import asyncio
from typing import Any, Awaitable, Callable, get_type_hints

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pydantic import BaseModel

from app.api.saisons.cache import invalidate_saison_cache
from app.api.teams.admin_router import get_teams_for_admin
from app.api.teams.router import get_teams
from app.api.teams.schemas import FLGruppenTeam, FLTeam, FLTeamsFilterParams
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.main import create_app
from tests.config import build_test_config

DATABASE_NAME = "fl_teams_public_read_test"

SAISON = "2026"

TEAM_OIDS = {
    "Helmholtz": ObjectId("6890a1b2c3d4e5f607420001"),
    # The club that left the LEAGUE while still holding this season's junction row. The row is what
    # would carry it into a standing the moment the base match on `inactive_since` is dropped.
    "Lessing": ObjectId("6890a1b2c3d4e5f607420002"),
}

RETIRED_ON = "2026-03-01"

# The models the two endpoints DECLARE: FastAPI builds the query parameters from these, so what a
# caller may ask for is settled here rather than by anything a handler body does with the answer.
BASE_FILTERS: type[BaseModel] = get_type_hints(get_teams)["filters"]
ADMIN_FILTERS: type[BaseModel] = get_type_hints(get_teams_for_admin)["filters"]

# What a caller may actually SEND, read off the app's own schema: a model's fields plus anything the
# handler declares beside them. Constructing a filter object asks for nothing -- `extra="ignore"`
# drops an undeclared key before any read sees it.
_PUBLISHED_PATHS = create_app(build_test_config()).openapi()["paths"]
BASE_QUERY_PARAMETERS = {parameter["name"] for parameter in _PUBLISHED_PATHS[f"/api/v{API_VERSION}/teams"]["get"]["parameters"]}
ADMIN_QUERY_PARAMETERS = {parameter["name"] for parameter in _PUBLISHED_PATHS[f"/api/v{API_VERSION}/teams/list/admin"]["get"]["parameters"]}

Body = Callable[[AsyncIOMotorDatabase], Awaitable[Any]]


def saison_document() -> dict[str, Any]:
    """Complete, rules included: the grouped read derives every figure in the table from them."""

    return {
        "_id": SAISON,
        "start_date": f"{SAISON}-01-01",
        "end_date": f"{SAISON}-06-30",
        "status": "active",
        "rules": {
            "win_points": 3,
            "draw_points": 1,
            "qualifiers_per_group": 2,
            "number_of_groups": 4,
            "teams_per_group": 4,
            "tiebreak_order": "tordifferenz",
            "max_kadergroesse": 18,
            "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
            "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
        },
    }


def team_document(key: str, shorthand: str, *, inactive_since: str | None) -> dict[str, Any]:
    return {
        "_id": TEAM_OIDS[key],
        "name": key,
        "shorthand": shorthand,
        "description": "",
        "full_name": f"{key}-Gymnasium",
        "website_url": f"https://{key.lower()}.example.de",
        "address": {
            "strasse": "Hanauer Landstraße",
            "hausnummer": "12a",
            "plz": "60314",
            "stadtteil": "Ostend",
            "stadt": "Frankfurt am Main",
        },
        "inactive_since": inactive_since,
    }


def junction_row(key: str, shorthand: str) -> dict[str, Any]:
    """A dict rather than a model: `saison_teams` has no model of the row."""

    return {
        "saison_id": SAISON,
        "team_id": TEAM_OIDS[key],
        "gruppe": "A",
        "austritt": None,
        "name": key,
        "shorthand": shorthand,
    }


def on_a_league(container: Any, body: Body) -> Any:
    """One client and event loop per call: Motor binds to the loop it first ran on."""

    async def _run() -> Any:
        client = AsyncIOMotorClient(container.get_connection_url())
        try:
            await client.drop_database(DATABASE_NAME)
            database = client[DATABASE_NAME]

            # Process-global and keyed by season id, so an entry another module left would answer here.
            invalidate_saison_cache()

            await database[Collection.SAISONS].insert_one(saison_document())
            await database[Collection.TEAMS].insert_many(
                [
                    team_document("Helmholtz", "HG", inactive_since=None),
                    team_document("Lessing", "LE", inactive_since=RETIRED_ON),
                ]
            )
            await database[Collection.SAISON_TEAMS].insert_many([junction_row("Helmholtz", "HG"), junction_row("Lessing", "LE")])

            return await body(database)
        finally:
            await client.drop_database(DATABASE_NAME)
            client.close()

    return asyncio.run(_run())


def base_filters(**overrides: Any) -> BaseModel:
    """`model_validate`, not the constructor: the model is whatever `get_teams` declares, so its keywords are not known here statically."""

    return BASE_FILTERS.model_validate({"saison_id": SAISON, **overrides})


async def read_teams(database: AsyncIOMotorDatabase, filters: Any) -> Any:
    return await get_teams(
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        filters=filters,
    )


async def read_teams_for_admin(database: AsyncIOMotorDatabase, filters: FLTeamsFilterParams) -> Any:
    return await get_teams_for_admin(
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        filters=filters,
    )


def standing_names(response: Any) -> list[str]:
    """Every club the four groups place, in the order the response ranked them."""

    return [row.name for rows in response.gruppen.root.values() for row in rows]


class TestTheBaseTierFilterSurface:
    def test_the_retirement_switch_is_not_among_its_query_parameters(self):
        """A standings row names no leaving date, so a read un-hiding retired clubs has no way to say which ones they are (`READ-SQUAD-002`)."""
        assert "include_inactive" not in BASE_QUERY_PARAMETERS
        # The contrast, so the name above is one FastAPI really publishes when a handler offers it.
        assert "include_inactive" in ADMIN_QUERY_PARAMETERS

    def test_the_base_tier_filter_set_is_exactly_this(self):
        """Every term the base tier may narrow on. A filter is part of the shape a read serves.

        The difference against the admin model cannot stand in: that model inherits this one, so a
        term added here propagates there and the difference is unchanged.
        """
        assert set(BASE_FILTERS.model_fields) == {
            "saison_id",
            "gruppe",
            "in_gruppen",
            "has_austritt",
            "austritt_type",
            "statistik_scope",
            "sort_by",
            "order",
            "limit",
        }

    def test_the_admin_filters_are_that_same_set_plus_the_switch(self):
        """Moved rather than dropped: the season editor has to list a retired club that still holds a junction row."""
        assert "include_inactive" in ADMIN_FILTERS.model_fields
        assert set(ADMIN_FILTERS.model_fields) - set(BASE_FILTERS.model_fields) == {"include_inactive"}

    def test_a_standings_row_carries_no_leaving_date(self):
        """Why the switch is off that surface. `austritt_type` is no substitute: it records leaving a SEASON, not leaving the league."""
        assert "inactive_since" not in FLGruppenTeam.model_fields
        assert "inactive_since" in FLTeam.model_fields


@pytest.mark.db
class TestARetiredClubStaysOutOfTheBaseTierReads:
    """The whole chain against a real mongod: what is stored, and what the two shapes of `GET /teams` answer over it."""

    def test_the_corpus_really_holds_a_retired_club_in_this_seasons_group(self, mongo_container: Any):
        """First, because every case below would pass just as well against a corpus where nobody had left the league."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            club = await database[Collection.TEAMS].find_one({"_id": TEAM_OIDS["Lessing"]})
            row = await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM_OIDS["Lessing"]})

            return club, row

        club, row = on_a_league(mongo_container, body)

        assert club["inactive_since"] == RETIRED_ON
        assert row["gruppe"] == "A"

    def test_the_standings_leave_it_out(self, mongo_container: Any):
        response = on_a_league(mongo_container, lambda database: read_teams(database, base_filters(in_gruppen=True)))

        assert standing_names(response) == ["Helmholtz"]

    def test_the_flat_list_leaves_it_out_as_well(self, mongo_container: Any):
        """The switch left the ENDPOINT rather than one of its two shapes: the flat list is the same base-tier surface."""
        response = on_a_league(mongo_container, lambda database: read_teams(database, base_filters()))

        assert [team.name for team in response.teams] == ["Helmholtz"]

    def test_the_admin_read_still_un_hides_it(self, mongo_container: Any):
        """Non-vacuity as well as the rule: the same corpus, one tier along, answers with the club every case above refused."""
        filters = FLTeamsFilterParams(saison_id=SAISON, in_gruppen=True, include_inactive=True)
        response = on_a_league(mongo_container, lambda database: read_teams_for_admin(database, filters))

        assert sorted(standing_names(response)) == ["Helmholtz", "Lessing"]
