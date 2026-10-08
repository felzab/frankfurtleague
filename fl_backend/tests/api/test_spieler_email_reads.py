from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identitaet.crud import find_anmeldung, find_subjekt
from app.api.konto.router import get_einwilligungen
from app.api.registrierungen.einwilligung_router import get_bestaetigung_ansicht
from app.api.registrierungen.person_router import aufnehmen, get_offene_registrierungen
from app.api.registrierungen.schemas import (
    FLOffeneRegistrierungenParams,
    FLRegistrierungAufnehmenPayload,
    FLRegistrierungBestaetigungAnsichtPayload,
)
from app.api.saisons.cache import invalidate_saison_cache
from app.api.spieler.schemas import FLSpielerSelbstEinwilligungPayload
from app.api.spieler.selbst_router import get_selbst, patch_einwilligung
from app.core.collections import Collection
from app.core.drosselung import get_drossel
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from tests import documents
from tests.bans import ban_list
from tests.database import a_clean_database, on_the_seed_loop
from tests.plans import plans_of_sent_reads
from tests.records import record_collections
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
        documents.registrierung_document(
            registrierung_id,
            "Thessaly.Okonkwo@beispielschule.de",
            saison_id=SAISON_ID,
            team_id=TEAM_OID,
            vorname="Thessaly",
            nachname="Okonkwo-Brandt",
            token=TOKEN,
            eingereicht_am="2026-03-30",
            frist="2026-04-06",
            bestaetigt={
                "geburtsdatum": "2009-05-04",
                "umfang": "intern",
                "medien": False,
                "text_version": "2026-09",
                "today": "2026-03-31",
                "am": "2026-03-31T08:00:00+00:00",
            },
        )
    )

    return registrierung_id


async def the_subject_read(database: AsyncDatabase, client: AsyncMongoClient, registrierung_id: ObjectId) -> Any:
    return await find_subjekt(FOLDED_EMAIL, record_collections(database))


async def the_gate_read(database: AsyncDatabase, client: AsyncMongoClient, registrierung_id: ObjectId) -> Any:
    return await find_anmeldung(FOLDED_EMAIL, record_collections(database))


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
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        spieler_collection=database[Collection.SPIELER],
        records=record_collections(database),
        db=client,
    )


async def the_admission(database: AsyncDatabase, client: AsyncMongoClient, registrierung_id: ObjectId) -> Any:
    return await aufnehmen(
        registrierung_id=registrierung_id,
        aufnahme_data=FLRegistrierungAufnehmenPayload(spieler_id=None),
        identifier=ANNA,
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        saisons_collection=database[Collection.SAISONS],
        spieler_collection=database[Collection.SPIELER],
        records=record_collections(database),
        spieltage_collection=database[Collection.SPIELTAGE],
        aktionen_collection=database[Collection.AKTIONEN],
        sperrliste=ban_list(database),
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


async def the_account_read(database: AsyncDatabase, client: AsyncMongoClient, registrierung_id: ObjectId) -> Any:
    return await get_einwilligungen(
        identifier=FOLDED_EMAIL,
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        teams_collection=database[Collection.TEAMS],
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        records=record_collections(database),
        db=client,
        today=TODAY,
    )


async def the_own_record_read(database: AsyncDatabase, client: AsyncMongoClient, registrierung_id: ObjectId) -> Any:
    return await get_selbst(identifier=FOLDED_EMAIL, spieler_collection=database[Collection.SPIELER])


async def the_own_record_press(database: AsyncDatabase, client: AsyncMongoClient, registrierung_id: ObjectId) -> Any:
    return await patch_einwilligung(
        einwilligung_data=FLSpielerSelbstEinwilligungPayload.model_validate(
            {
                "umfang": "intern",
                "medien": False,
                "text_version": LAUFENDE_FASSUNGEN["konto_spieler"],
                "nachweis_stand": {"umfang": None, "medien": None},
            }
        ),
        identifier=FOLDED_EMAIL,
        spieler_collection=database[Collection.SPIELER],
        records=record_collections(database),
        db=client,
        # A withdrawal: the ceiling counts a grant alone, so this press spends nothing.
        drossel=get_drossel(drosselung_collection=database[Collection.DROSSELUNG], germany_now=NOW),
        today=TODAY,
        germany_now=NOW,
    )


def names_an_address(command: Mapping[str, Any]) -> bool:
    """Whether a `spieler` find or aggregate matches on a stored address, rather than on an id or on no address at all."""

    stages = [stage.get("$match", {}) for stage in command.get("pipeline", [])]
    filters = [command.get("filter") or {}, *stages]

    return any(isinstance(term := matched.get("email"), (str, Mapping)) and term is not None for matched in filters)


def plans_reading_addresses(url: str, reader: Reader) -> tuple[Any, ObjectId, list[str]]:
    """The reader's answer, the seeded registration's id, and the server's plan for every `spieler` read it sent matching an address."""

    async def _run() -> tuple[Any, ObjectId, list[str]]:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            invalidate_saison_cache()
            registrierung_id = await seed(database)
            answer, plans = await plans_of_sent_reads(
                url,
                database,
                lambda watched, client: reader(watched, client, registrierung_id),
                lambda collection, command: collection == Collection.SPIELER and names_an_address(command),
            )

            return answer, registrierung_id, [plan for _, plan in plans]

    return on_the_seed_loop(_run())


class TestEveryAddressReadUsesTheIndex:
    """`uniq_spieler_email` is partial on `$type: "string"`, which an equality alone does not imply.

    Driven through each caller, its address reads explained: a call site dropping the term goes red
    here where a builder's own case would not.
    """

    @pytest.mark.parametrize(
        "reader",
        [
            the_subject_read,
            the_gate_read,
            the_confirmation_view,
            the_pending_read,
            the_admission,
            the_account_read,
            the_own_record_read,
            the_own_record_press,
        ],
        ids=lambda reader: reader.__name__,
    )
    def test_the_plan_walks_the_unique_index(self, mongo_replica_set_url: str, reader: Reader):
        answer, registrierung_id, plans = plans_reading_addresses(mongo_replica_set_url, reader)

        # The pending read asks `spieler` for a person only for a confirmed row it served, so a read
        # serving none skips the lookup this case is for; this names that rather than an empty list.
        if reader is the_pending_read:
            served = [row.registrierung_id for row in answer.registrierungen if row.aufnehmbar]
            assert served == [registrierung_id], f"the pending read served {served}, not the seeded confirmed row"

        # The premise: a reader sending no address read would pass the next line vacuously.
        assert plans
        assert all("IXSCAN { email: 1 }" in plan for plan in plans), plans
