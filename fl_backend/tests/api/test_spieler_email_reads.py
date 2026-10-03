from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.identitaet.crud import find_subjekt
from app.api.registrierungen.einwilligung_router import get_bestaetigung_ansicht
from app.api.registrierungen.person_router import aufnehmen, get_offene_registrierungen
from app.api.registrierungen.schemas import (
    FLOffeneRegistrierungenParams,
    FLRegistrierungAufnehmenPayload,
    FLRegistrierungBestaetigungAnsichtPayload,
)
from app.api.registrierungen.services import compose_bestaetigung, compose_confirmation_update, compose_registrierung
from app.api.saisons.cache import invalidate_saison_cache
from app.core.collections import Collection
from tests import documents
from tests.bans import ban_list
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

# Module level: a query plan is the server's to report.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spieler_email_reads_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
TEAM_OID = ObjectId("6890a1b2c3d4e5f607990001")
ANNA = "anna@example.com"
FOLDED_EMAIL = "thessaly.okonkwo@beispielschule.de"
TOKEN = "hwGqQ4kP6yJr3VnZbT8sXeM2dLuF9aCwR1oY5iN7pKg"

# Enough persons that the planner prefers an index wherever it can use one.
PERSONS = 60

Reader = Callable[[AsyncDatabase, AsyncMongoClient, ObjectId], Awaitable[Any]]


async def seed(database: AsyncDatabase) -> ObjectId:
    await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
    await database[Collection.TEAMS].insert_one(documents.team_document(TEAM_OID, "Zorbanax", "ZO"))
    await database[Collection.SAISON_TEAMS].insert_one(
        documents.saison_team_document(
            SAISON_ID,
            TEAM_OID,
            "Zorbanax",
            "ZO",
            kontakte={
                "trainer": None,
                "ansprechperson": documents.kontaktperson_document("Anna", bestaetigt_am="2026-03-21"),
                "stellvertretung": None,
                "trainer_ist_zugleich": None,
            },
        )
    )
    await database[Collection.SPIELER].insert_many(
        [
            documents.spieler_document(ObjectId(), f"Person{index}", "Muster", email=f"person{index}@beispielschule.de")
            for index in range(PERSONS)
        ]
        + [documents.spieler_document(ObjectId(), "Thessaly", "Okonkwo-Brandt", email=FOLDED_EMAIL)]
    )
    registrierung_id = ObjectId()
    await database[Collection.REGISTRIERUNGEN].insert_one(
        {
            "_id": registrierung_id,
            **compose_registrierung(
                saison_id=SAISON_ID,
                team_id=TEAM_OID,
                einladung_id=ObjectId(),
                vorname="Thessaly",
                nachname="Okonkwo-Brandt",
                email="Thessaly.Okonkwo@beispielschule.de",
                position=None,
                nummer=None,
                stufe=None,
                bestaetigung=compose_bestaetigung(token_hash=hash_token(TOKEN), today="2026-03-30", frist="2026-04-06"),
                today="2026-03-30",
            ),
            **compose_confirmation_update(
                geburtsdatum="2009-05-04",
                umfang="intern",
                medien=False,
                text_version="2026-09",
                today="2026-03-31",
                am="2026-03-31T08:00:00+00:00",
            )["$set"],
        }
    )

    return registrierung_id


async def the_subject_read(database: AsyncDatabase, client: AsyncMongoClient, registrierung_id: ObjectId) -> Any:
    return await find_subjekt(
        FOLDED_EMAIL,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
    )


async def the_confirmation_view(database: AsyncDatabase, client: AsyncMongoClient, registrierung_id: ObjectId) -> Any:
    return await get_bestaetigung_ansicht(
        ansicht_data=FLRegistrierungBestaetigungAnsichtPayload(token=TOKEN),
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        teams_collection=database[Collection.TEAMS],
        spieler_collection=database[Collection.SPIELER],
        sperrliste=ban_list(database),
        today=TODAY,
    )


async def the_pending_read(database: AsyncDatabase, client: AsyncMongoClient, registrierung_id: ObjectId) -> Any:
    return await get_offene_registrierungen(
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        params=FLOffeneRegistrierungenParams(),
        identifier=ANNA,
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        saisons_collection=database[Collection.SAISONS],
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        db=client,
    )


async def the_admission(database: AsyncDatabase, client: AsyncMongoClient, registrierung_id: ObjectId) -> Any:
    return await aufnehmen(
        registrierung_id=registrierung_id,
        aufnahme_data=FLRegistrierungAufnehmenPayload(spieler_id=None),
        identifier=ANNA,
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        saisons_collection=database[Collection.SAISONS],
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spieltage_collection=database[Collection.SPIELTAGE],
        aktionen_collection=database[Collection.AKTIONEN],
        sperrliste=ban_list(database),
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


def names_an_address(entry: Mapping[str, Any]) -> bool:
    """Whether a profiled `spieler` operation matched on a stored address, rather than on an id or on no address at all."""

    command = entry.get("command") or {}
    stages = [stage.get("$match", {}) for stage in command.get("pipeline", [])]
    filters = [command.get("filter") or {}, *stages]

    return any(isinstance(term := matched.get("email"), (str, Mapping)) and term is not None for matched in filters)


def plans_reading_addresses(url: str, reader: Reader) -> list[str]:
    """The plan of every `spieler` operation the reader matched on an address, as the server's profiler reports it."""

    async def _run() -> list[str]:
        # `mutates_schema`: the profiler writes `system.profile`, a namespace the next case's clear must not meet.
        async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=True) as (client, database):
            invalidate_saison_cache()
            registrierung_id = await seed(database)
            await database.command("profile", 2)
            try:
                await reader(database, client, registrierung_id)
            finally:
                await database.command("profile", 0)
            profiled = await database["system.profile"].find({"ns": f"{DATABASE_NAME}.{Collection.SPIELER}"}).to_list(length=None)
            await database.drop_collection("system.profile")

            return [str(entry.get("planSummary")) for entry in profiled if names_an_address(entry)]

    return on_the_seed_loop(_run())


class TestEveryAddressReadUsesTheIndex:
    """`uniq_spieler_email` is partial on `$type: "string"`, which an equality alone does not imply.

    Driven through each caller and read off the profiler: a call site dropping the term goes red here
    where a builder's own case would not.
    """

    @pytest.mark.parametrize(
        "reader",
        [the_subject_read, the_confirmation_view, the_pending_read, the_admission],
        ids=lambda reader: reader.__name__,
    )
    def test_the_plan_walks_the_unique_index(self, mongo_replica_set_url: str, reader: Reader):
        plans = plans_reading_addresses(mongo_replica_set_url, reader)

        # The premise: a reader the profiler never saw matching an address would pass the next line vacuously.
        assert plans
        assert all("IXSCAN { email: 1 }" in plan for plan in plans), plans
