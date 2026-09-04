from datetime import datetime
from typing import Any, Awaitable, Callable, Mapping
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.einwilligung_router import post_einwilligung
from app.api.bewerbungen.schemas import FLBewerbungEinwilligungAntwortPayload
from app.api.bewerbungen.services import KONTAKT_SEATS, compose_bestaetigungen, hash_token
from app.core.collections import Collection
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

# Module level, as the execution suite marks its own: every test below reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_bewerbung_einwilligung_paar_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607960001")

SCHOOL_NAME = "Zorbanax"

RAW: Mapping[str, str] = {seat: f"raw-token-for-{seat}" for seat in KONTAKT_SEATS}
HASHES: Mapping[str, str] = {seat: hash_token(raw) for seat, raw in RAW.items()}

AN_ADULTS_BIRTHDATE = "1984-05-09"

ADDRESS: Mapping[str, Any] = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}


def person(vorname: str) -> dict[str, Any]:
    return {
        "vorname": vorname,
        "nachname": f"{vorname}-Mustermann",
        "email": f"{vorname.lower()}@example.com",
        "telefon": "+49 170 1234567",
        "geburtsdatum": None,
        "einwilligung": {
            "umfang": "kontaktdaten",
            "erteilt_von": "administrativ",
            "text_version": "v3",
            "datum": "2026-03-20",
            "bestaetigt_am": None,
        },
    }


def paired_kontakte(**overrides: Any) -> dict[str, Any]:
    """The double-seated Trainer as the submission stores them: one person in two slots, which `FLBewerbungPayload` holds equal."""

    return {
        "trainer": person("Wraxlington"),
        "ansprechperson": person("Wraxlington"),
        "stellvertretung": person("Bramblewick"),
        "trainer_ist_zugleich": "ansprechperson",
        **overrides,
    }


def bewerbung_document(**overrides: Any) -> dict[str, Any]:
    return {
        "_id": BEWERBUNG_OID,
        "saison_id": SAISON_ID,
        "eingereicht_am": "2026-03-20",
        "status": "eingereicht",
        "team_id": None,
        "schule": {
            "team_name": SCHOOL_NAME,
            "full_name": f"{SCHOOL_NAME}-Gesamtschule",
            "shorthand": "ZX",
            "schulform": "gesamtschule",
            "address": dict(ADDRESS),
            "website_url": None,
        },
        "kontakte": paired_kontakte(),
        "trikot": {"vorhandener_satz": "keiner", "wunschfarbe": "rot"},
        "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
        "wunschgegner": None,
        "entscheidung": None,
        "bestaetigungsfrist": "2026-04-03",
        "bestaetigungen": compose_bestaetigungen(hashes=HASHES, today="2026-03-20"),
        **overrides,
    }


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, documents: list[dict[str, Any]]) -> Any:
    """The SHIPPED validators, so a planted document production would refuse fails here too."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.BEWERBUNGEN].insert_many(documents)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def answer(database: AsyncDatabase, client: AsyncMongoClient, token: str, **overrides: Any) -> Any:
    body = {"token": token, "antwort": "erteilt", "geburtsdatum": AN_ADULTS_BIRTHDATE, "whatsapp": False, "text_version": "v4", **overrides}

    return await post_einwilligung(
        antwort_data=FLBewerbungEinwilligungAntwortPayload.model_validate(body),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


async def stored(database: AsyncDatabase) -> Mapping[str, Any]:
    found = await database[Collection.BEWERBUNGEN].find_one({"_id": BEWERBUNG_OID})
    assert found is not None, "the seeded application is gone"

    return found


async def log_rows(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return await database[Collection.AKTIONEN].find({"collection": str(Collection.BEWERBUNGEN)}).sort("_id", 1).to_list(length=None)


class TestAPairedDecline:
    def test_both_slots_are_emptied_both_days_recorded_and_the_log_redacted_once(self, mongo_replica_set_url: str):
        """One person, two seats, one refusal: a decline reaching one slot would leave the other holding the person who refused."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW["ansprechperson"], antwort="abgelehnt", geburtsdatum=None)

            return response, await stored(database), await log_rows(database)

        response, document, rows = on_a_league(mongo_replica_set_url, body, documents=[bewerbung_document()])

        assert (document["kontakte"]["trainer"], document["kontakte"]["ansprechperson"]) == (None, None)
        assert document["bestaetigungen"]["trainer"]["abgelehnt_am"] == TODAY
        assert document["bestaetigungen"]["ansprechperson"]["abgelehnt_am"] == TODAY
        # The third seat keeps its person, and no seat carries a stamp, so all three stay outstanding.
        assert document["kontakte"]["stellvertretung"] is not None
        assert (response.ergebnis, response.ausstehend) == ("abgelehnt", list(KONTAKT_SEATS))
        assert len(rows) == 1
        assert (rows[0]["before"], rows[0]["redacted_at"]) == (None, "2026-04-01T10:30:00+00:00")

    def test_a_partner_whose_bookkeeping_is_gone_is_left_alone(self, mongo_replica_set_url: str):
        """A dotted `$set` under a null parent aborts the transaction, so the person's own seat would be refused a 500 rather than declined."""

        emptied = bewerbung_document(
            bestaetigungen={**compose_bestaetigungen(hashes=HASHES, today="2026-03-20"), "trainer": None},
        )

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW["ansprechperson"], antwort="abgelehnt", geburtsdatum=None)

            return response, await stored(database)

        response, document = on_a_league(mongo_replica_set_url, body, documents=[emptied])

        assert response.ergebnis == "abgelehnt"
        assert document["kontakte"]["ansprechperson"] is None
        assert document["bestaetigungen"]["ansprechperson"]["abgelehnt_am"] == TODAY
        assert document["bestaetigungen"]["trainer"] is None
        assert document["kontakte"]["trainer"] == paired_kontakte()["trainer"]


class TestAPairedConfirmation:
    def test_a_partner_whose_slot_is_gone_is_left_alone(self, mongo_replica_set_url: str):
        """The mirror of the decline's hazard, on the branch that writes five keys into the partner's slot."""

        emptied = bewerbung_document(kontakte=paired_kontakte(trainer=None))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW["ansprechperson"])

            return response, await stored(database)

        response, document = on_a_league(mongo_replica_set_url, body, documents=[emptied])

        assert response.ergebnis == "bestaetigt"
        assert document["kontakte"]["ansprechperson"]["geburtsdatum"] == AN_ADULTS_BIRTHDATE
        assert document["kontakte"]["ansprechperson"]["einwilligung"]["bestaetigt_am"] == TODAY
        assert document["kontakte"]["trainer"] is None
        # The emptied seat has no stamp, so the application still cannot be accepted on it.
        assert response.ausstehend == ["trainer", "stellvertretung"]
