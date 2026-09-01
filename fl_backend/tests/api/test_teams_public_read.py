from typing import Any, Awaitable, Callable, Iterator, get_type_hints

import pytest
from bson import ObjectId
from pydantic import BaseModel
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.cache import invalidate_saison_cache
from app.api.saisons.schemas import FLSaisonRules
from app.api.teams.admin_router import get_teams_for_admin
from app.api.teams.router import get_team, get_teams
from app.api.teams.schemas import FLGruppenTeam, FLTeam, FLTeamsFilterParams, FLTeamSingleFilterParams
from app.api.teams.services import build_team_pipeline
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.main import create_app
from tests.config import build_test_config
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.worker import worker_database

from .conftest import unwritten

DATABASE_NAME = worker_database("fl_teams_public_read_test")

SAISON = "2026"

TEAM_OIDS = {
    "Helmholtz": ObjectId("6890a1b2c3d4e5f607420001"),
    # The club that left the LEAGUE while still holding this season's junction row. The row is what
    # would carry it into a standing the moment the base match on `inactive_since` is dropped.
    "Lessing": ObjectId("6890a1b2c3d4e5f607420002"),
}

RETIRED_ON = "2026-03-01"

# The three values a leak would carry: a teacher's mailbox, the number the league runs its whole
# WhatsApp channel on, and a private person's date of birth.
KONTAKT_EMAIL = "a.koerner@helmholtz.example.de"
KONTAKT_TELEFON = "+49 170 1234567"
KONTAKT_GEBURTSDATUM = "1984-05-09"

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

Body = Callable[[AsyncDatabase], Awaitable[Any]]


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


def kontaktperson(nachname: str) -> dict[str, Any]:
    return {
        "vorname": "Anke",
        "nachname": nachname,
        "email": KONTAKT_EMAIL,
        "telefon": KONTAKT_TELEFON,
        "geburtsdatum": KONTAKT_GEBURTSDATUM,
        "einwilligung": {"umfang": "kontaktdaten", "erteilt_von": "person", "text_version": "v1", "datum": "2026-01-15"},
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
        "trikot_farbe": "dunkelblau",
        # What every case below is about. Stored on both clubs, so no read can pass by holding the
        # one team that happens to carry none.
        "kontakte": {
            "trainer": kontaktperson("Trainerin"),
            "ansprechperson": kontaktperson("Ansprechpartnerin"),
            "stellvertretung": kontaktperson("Vertretung"),
            "trainer_ist_zugleich": None,
        },
    }


# Module-scoped: every case below reads this corpus and none writes it, which `unwritten` keeps
# from being left as a claim.
@pytest.fixture(scope="module")
def seeded_url(mongo_url: str) -> Iterator[str]:
    """One season, a live club and a retired one, and a junction row per club carrying three people's contact records."""

    async def _seed() -> None:
        async with a_clean_database(mongo_url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_one(saison_document())
            await database[Collection.TEAMS].insert_many(
                [
                    team_document("Helmholtz", "HG", inactive_since=None),
                    team_document("Lessing", "LE", inactive_since=RETIRED_ON),
                ]
            )
            await database[Collection.SAISON_TEAMS].insert_many([junction_row("Helmholtz", "HG"), junction_row("Lessing", "LE")])

    on_the_seed_loop(_seed())

    with unwritten(mongo_url, DATABASE_NAME):
        yield mongo_url


def on_a_league(url: str, body: Body) -> Any:
    async def _run() -> Any:
        # Process-global and keyed by season id, so an entry another test left would answer here.
        invalidate_saison_cache()

        return await body(shared_client(url)[DATABASE_NAME])

    return on_the_seed_loop(_run())


def base_filters(**overrides: Any) -> BaseModel:
    """`model_validate`, not the constructor: the model is whatever `get_teams` declares, so its keywords are not known here statically."""

    return BASE_FILTERS.model_validate({"saison_id": SAISON, **overrides})


async def read_teams(database: AsyncDatabase, filters: Any) -> Any:
    return await get_teams(
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        filters=filters,
    )


async def read_teams_for_admin(database: AsyncDatabase, filters: FLTeamsFilterParams) -> Any:
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

    def test_the_corpus_really_holds_a_retired_club_in_this_seasons_group(self, seeded_url: str):
        """First, because every case below would pass just as well against a corpus where nobody had left the league."""

        async def body(database: AsyncDatabase) -> Any:
            club = await database[Collection.TEAMS].find_one({"_id": TEAM_OIDS["Lessing"]})
            row = await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM_OIDS["Lessing"]})

            return club, row

        club, row = on_a_league(seeded_url, body)

        assert club["inactive_since"] == RETIRED_ON
        assert row["gruppe"] == "A"

    def test_the_standings_leave_it_out(self, seeded_url: str):
        response = on_a_league(seeded_url, lambda database: read_teams(database, base_filters(in_gruppen=True)))

        assert standing_names(response) == ["Helmholtz"]

    def test_the_flat_list_leaves_it_out_as_well(self, seeded_url: str):
        """The switch left the ENDPOINT rather than one of its two shapes: the flat list is the same base-tier surface."""
        response = on_a_league(seeded_url, lambda database: read_teams(database, base_filters()))

        assert [team.name for team in response.teams] == ["Helmholtz"]

    def test_the_admin_read_still_un_hides_it(self, seeded_url: str):
        """Non-vacuity as well as the rule: the same corpus, one tier along, answers with the club every case above refused."""
        filters = FLTeamsFilterParams(saison_id=SAISON, in_gruppen=True, include_inactive=True)
        response = on_a_league(seeded_url, lambda database: read_teams_for_admin(database, filters))

        assert sorted(standing_names(response)) == ["Helmholtz", "Lessing"]


@pytest.mark.db
class TestTheBaseTierReadsWithholdTheJunctionsContactRecords:
    """Three people's email, phone number and date of birth sit on the junction row, and both base-tier team reads join it."""

    def test_the_corpus_really_stores_them(self, seeded_url: str):
        """First, because every case below would pass just as well against a season whose rows carried no contacts at all."""

        async def body(database: AsyncDatabase) -> Any:
            return await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM_OIDS["Helmholtz"]})

        row = on_a_league(seeded_url, body)

        assert row["kontakte"]["trainer"]["email"] == KONTAKT_EMAIL
        assert row["kontakte"]["stellvertretung"]["geburtsdatum"] == KONTAKT_GEBURTSDATUM

    def test_the_aggregation_carries_none_of_it_back(self, seeded_url: str):
        """The RAW documents, before any model sees them: what the driver returned is what a leak would have to travel in."""

        async def body(database: AsyncDatabase) -> Any:
            filters = FLTeamsFilterParams(saison_id=SAISON)
            rules = FLSaisonRules.model_validate(saison_document()["rules"])
            pipeline = build_team_pipeline(filters=filters, rules=rules)

            return await (await database[Collection.TEAMS].aggregate(pipeline)).to_list(length=None)

        rows = on_a_league(seeded_url, body)

        assert rows, "the pipeline matched nothing, so withholding is not what this proves"
        for row in rows:
            assert "kontakte" not in row
            assert KONTAKT_TELEFON not in repr(row)

    def test_the_list_endpoint_serves_none_of_it(self, seeded_url: str):
        response = on_a_league(seeded_url, lambda database: read_teams(database, base_filters()))

        assert response.teams
        assert KONTAKT_EMAIL not in response.model_dump_json()

    def test_the_single_team_endpoint_serves_none_of_it_either(self, seeded_url: str):
        """The other public caller of the same pipeline, and the one an anonymous visitor reaches with an id in hand."""

        async def body(database: AsyncDatabase) -> Any:
            return await get_team(
                team_id=TEAM_OIDS["Helmholtz"],
                teams_collection=database[Collection.TEAMS],
                saisons_collection=database[Collection.SAISONS],
                filters=FLTeamSingleFilterParams(saison_id=SAISON),
            )

        response = on_a_league(seeded_url, body)

        assert response.team.name == "Helmholtz"
        assert KONTAKT_EMAIL not in response.model_dump_json()
        assert KONTAKT_GEBURTSDATUM not in response.model_dump_json()
