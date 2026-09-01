"""API · that every server-ordered name list is ordered as German reads, not as bytes compare.

One corpus for all four reads: the same four names, chosen so binary order and German order disagree
twice over -- an umlaut that belongs beside its base letter, and a lower-case initial that belongs
beside its capital.
"""

import asyncio
from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.schiedsrichter.router import get_schiedsrichter
from app.api.schiedsrichter.schemas import FLSchiedsrichterFilterParams
from app.api.spieler.admin_router import get_spieler_memberships
from app.api.spielorte.router import get_spielorte
from app.api.spielorte.schemas import FLSpielorteFilterParams
from app.api.teams.admin_router import get_team_memberships
from app.core.collections import Collection
from tests.database import a_clean_database

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_name_ordering_test"

# „Ö" belongs beside „O" and „von" beside „V", where a byte comparison puts the first after every
# capital and the second after „Z".
NAMES = ("Zabel-Schule", "Ostermann-Schule", "Öztürk-Gymnasium", "von-Bülow-Schule")

GERMAN_ORDER = ["Ostermann-Schule", "Öztürk-Gymnasium", "von-Bülow-Schule", "Zabel-Schule"]

# What the same four sort to with no collation attached. Spelled out rather than described, so this
# file states the defect it exists to keep fixed.
BYTE_ORDER = ["Ostermann-Schule", "Zabel-Schule", "von-Bülow-Schule", "Öztürk-Gymnasium"]

# A forename apiece, ordered by the same disagreement: „Ö" after „Z" in bytes and beside „O" in German.
FORENAMES = ("Zeynep", "Olaf", "Ömer")
GERMAN_FORENAMES = ["Olaf", "Ömer", "Zeynep"]


def oid(index: int) -> ObjectId:
    return ObjectId(f"6890a1b2c3d4e5f6079{index:05d}")


def spielort_documents() -> list[dict[str, Any]]:
    return [
        {
            "_id": oid(index),
            "name": name,
            "maps_link": "Frankfurt am Main",
            "address": {"strasse": "Kaiserstraße", "hausnummer": "1", "plz": "60311", "stadtteil": "Innenstadt", "stadt": "Frankfurt am Main"},
            "default_mietpreis": 50,
            "inactive_since": None,
        }
        for index, name in enumerate(NAMES)
    ]


def schiedsrichter_documents() -> list[dict[str, Any]]:
    return [
        {
            "_id": oid(100 + index),
            "name": name,
            "schule": None,
            "default_payment": 20,
            "kontakt": {"telefon": None, "email": None},
            "inactive_since": None,
        }
        for index, name in enumerate(NAMES)
    ]


def team_documents() -> list[dict[str, Any]]:
    return [
        {
            "_id": oid(200 + index),
            "name": name,
            "shorthand": f"T{index}",
            "full_name": name,
            "schulform": "gymnasium_g9",
            "address": {"strasse": "Kaiserstraße", "hausnummer": "1", "plz": "60311", "stadtteil": "Innenstadt", "stadt": "Frankfurt am Main"},
            "description": "Eine Schule in Frankfurt am Main.",
            "website_url": None,
            "inactive_since": None,
        }
        for index, name in enumerate(NAMES)
    ]


def spieler_documents() -> list[dict[str, Any]]:
    return [
        {
            "_id": oid(300 + index),
            "vorname": vorname,
            "nachname": "Beispiel",
            "inactive_since": None,
            "einwilligung": {
                "umfang": "kader_oeffentlich",
                "erteilt_von": "erziehungsberechtigt",
                "datum": "2026-01-15",
                "bestaetigt_am": "2026-01-20",
            },
        }
        for index, vorname in enumerate(FORENAMES)
    ]


Body = Callable[[AsyncIOMotorDatabase], Awaitable[Any]]


def on_a_seeded_league(url: str, body: Body) -> Any:
    """One client and event loop per call: Motor binds to the loop it first ran on."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME) as (_, database):
            await database[Collection.SPIELORTE].insert_many(spielort_documents())
            await database[Collection.SCHIEDSRICHTER].insert_many(schiedsrichter_documents())
            await database[Collection.TEAMS].insert_many(team_documents())
            await database[Collection.SPIELER].insert_many(spieler_documents())

            return await body(database)

    return asyncio.run(_run())


class TestTheStoredOrderIsNotTheOrderAnyListServes:
    """The floor under every case below: without it each would pass on a corpus already in German order."""

    def test_the_two_orders_really_disagree(self):
        assert GERMAN_ORDER != BYTE_ORDER
        assert sorted(NAMES) == BYTE_ORDER, "Python's own byte comparison no longer produces the order this file calls binary"


class TestEveryNameListIsOrderedAsGermanReads:
    """Each read serves the same four names, and each attaches the collation at its own call site."""

    def test_the_venue_list_reads_in_german(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            response = await get_spielorte(spielorte_collection=database[Collection.SPIELORTE], filters=FLSpielorteFilterParams())

            return [spielort.name for spielort in response.spielorte]

        assert on_a_seeded_league(mongo_replica_set_url, body) == GERMAN_ORDER

    def test_the_referee_list_reads_in_german(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            response = await get_schiedsrichter(
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER], filters=FLSchiedsrichterFilterParams()
            )

            return [schiedsrichter.name for schiedsrichter in response.schiedsrichter]

        assert on_a_seeded_league(mongo_replica_set_url, body) == GERMAN_ORDER

    def test_the_club_memberships_read_in_german(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            response = await get_team_memberships(teams_collection=database[Collection.TEAMS])

            return [team.name for team in response.teams]

        assert on_a_seeded_league(mongo_replica_set_url, body) == GERMAN_ORDER

    def test_the_squad_memberships_read_in_german(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            response = await get_spieler_memberships(spieler_collection=database[Collection.SPIELER])

            return [spieler.vorname for spieler in response.spieler]

        assert on_a_seeded_league(mongo_replica_set_url, body) == GERMAN_FORENAMES
