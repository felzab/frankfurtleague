from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.schemas import FLBewerbungZustellungAngenommenPayload, FLBewerbungZustellungEreignisPayload
from app.api.bewerbungen.services import KONTAKT_SEATS, compose_bestaetigungen, hash_token
from app.api.bewerbungen.zustellung_router import angenommen_zustellung, post_zustellung
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundException
from app.core.recording import SYSTEM_ACTOR_EMAIL
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

# Module level, as the other execution suites mark theirs: every test below reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_bewerbung_zustellung_test")

SAISON_ID = "2026"
MAILED_ON = "2026-03-29"

BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607970001")
ABSENT_OID = ObjectId("6890a1b2c3d4e5f607979999")

FIRST_MESSAGE = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"
SECOND_MESSAGE = "7c1f2b5e-3d44-4a91-9f0b-1e2d3c4b5a60"

ACCEPTED_AT = "2026-03-29T10:00:00.000000+00:00"
BOUNCED_AT = "2026-03-29T10:05:00.000000+00:00"
DELIVERED_AT = "2026-03-29T10:02:00.000000+00:00"
LATER_STILL = "2026-03-29T11:00:00.000000+00:00"

ADDRESS: Mapping[str, Any] = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}


def person(vorname: str, *, email: str | None = None) -> dict[str, Any]:
    return {
        "vorname": vorname,
        "nachname": f"{vorname}-Mustermann",
        "email": email or f"{vorname.lower()}@example.com",
        "telefon": "+49 170 1234567",
        "geburtsdatum": None,
        "einwilligung": {
            "umfang": "kontaktdaten",
            "erfasst_von": "administrativ",
            "text_version": "v3",
            "datum": "2026-03-20",
            "bestaetigt_am": None,
        },
    }


def kontakte() -> dict[str, Any]:
    """One person holding two seats, so one message covers two of them and the write has a pair to reach."""

    return {
        "trainer": person("Wraxlington"),
        "ansprechperson": person("Wraxlington"),
        "stellvertretung": person("Bramblewick"),
        "trainer_ist_zugleich": "ansprechperson",
    }


def application(**overrides: Any) -> dict[str, Any]:
    return {
        "_id": BEWERBUNG_OID,
        "saison_id": SAISON_ID,
        "eingereicht_am": MAILED_ON,
        "status": "eingereicht",
        "team_id": None,
        "schule": {
            "team_name": "Zorbanax",
            "full_name": "Zorbanax-Gesamtschule",
            "shorthand": "ZX",
            "schulform": "gesamtschule",
            "address": dict(ADDRESS),
            "website_url": None,
        },
        "kontakte": kontakte(),
        "trikot": {"vorhandener_satz": "keiner", "wunschfarbe": "rot"},
        "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
        "wunschgegner": None,
        "entscheidung": None,
        "bestaetigungsfrist": "2026-04-12",
        "bestaetigungen": compose_bestaetigungen(hashes={seat: hash_token(f"first-{seat}") for seat in KONTAKT_SEATS}, today=MAILED_ON),
        **overrides,
    }


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body) -> Any:
    """The SHIPPED validators, one submitted application, nothing yet known about any of its messages."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.BEWERBUNGEN].insert_one(application())

            return await body(database, client)

    return on_the_seed_loop(_run())


async def accept(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    *,
    rollen: list[str],
    nachricht_id: str = FIRST_MESSAGE,
    am: str = ACCEPTED_AT,
    bewerbung_id: ObjectId = BEWERBUNG_OID,
) -> Any:
    return await angenommen_zustellung(
        angenommen_data=FLBewerbungZustellungAngenommenPayload.model_validate(
            {"bewerbung_id": str(bewerbung_id), "rollen": rollen, "nachricht_id": nachricht_id, "am": am}
        ),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        db=client,
    )


async def report(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    *,
    rollen: list[str],
    stand: str,
    nachricht_id: str = FIRST_MESSAGE,
    grund: str | None = None,
    am: str = BOUNCED_AT,
    bewerbung_id: ObjectId = BEWERBUNG_OID,
) -> Any:
    return await post_zustellung(
        ereignis_data=FLBewerbungZustellungEreignisPayload.model_validate(
            {
                "bewerbung_id": str(bewerbung_id),
                "rollen": rollen,
                "nachricht_id": nachricht_id,
                "stand": stand,
                "grund": grund,
                "am": am,
            }
        ),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        db=client,
    )


async def state_of(database: AsyncDatabase, seat: str) -> Any:
    document = await database[Collection.BEWERBUNGEN].find_one({"_id": BEWERBUNG_OID})
    entry = (document or {}).get("bestaetigungen", {}).get(seat) or {}

    return entry.get("zustellung")


class TestTheAcceptedSend:
    def test_it_records_the_id_on_every_seat_that_message_covered(self, mongo_replica_set_url: str):
        """The id is the only join between a send and any later event, so a seat left without one discards every event about it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await accept(database, client, rollen=["ansprechperson", "trainer"])

            return (
                response,
                await state_of(database, "trainer"),
                await state_of(database, "ansprechperson"),
                await state_of(database, "stellvertretung"),
            )

        response, trainer, ansprechperson, untouched = on_a_league(mongo_replica_set_url, body)

        # In declaration order whatever order the caller named, so the answer reads one way.
        assert response.angewendet == ["trainer", "ansprechperson"]
        assert trainer == {"nachricht_id": FIRST_MESSAGE, "stand": "angenommen", "grund": None, "am": ACCEPTED_AT}
        assert ansprechperson == trainer
        assert untouched is None, "a seat the message did not cover was written to"

    def test_the_row_is_recorded_against_the_system_actor(self, mongo_replica_set_url: str):
        """No session stands behind the webhook or the sender, and `bind_system_actor` is what stops one being invented."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, rollen=["trainer"])

            return await database[Collection.AKTIONEN].find({"document_id": BEWERBUNG_OID}).to_list(length=None)

        rows = on_a_league(mongo_replica_set_url, body)

        assert [row["actor"]["email"] for row in rows] == [SYSTEM_ACTOR_EMAIL]

    def test_a_repeated_call_writes_nothing_a_second_time(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, rollen=["trainer"])
            second = await accept(database, client, rollen=["trainer"])

            return second.angewendet, await database[Collection.AKTIONEN].count_documents({"document_id": BEWERBUNG_OID})

        assert on_a_league(mongo_replica_set_url, body) == ([], 1)


class TestAnEventReachesTheSeatItWasSentTo:
    def test_a_bounce_marks_every_seat_the_message_covered(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, rollen=["trainer", "ansprechperson"])
            response = await report(database, client, rollen=["trainer", "ansprechperson"], stand="unzustellbar", grund="NoEmail")

            return response.angewendet, await state_of(database, "trainer"), await state_of(database, "ansprechperson")

        angewendet, trainer, ansprechperson = on_a_league(mongo_replica_set_url, body)

        assert angewendet == ["trainer", "ansprechperson"]
        assert trainer == {"nachricht_id": FIRST_MESSAGE, "stand": "unzustellbar", "grund": "NoEmail", "am": BOUNCED_AT}
        assert ansprechperson == trainer

    def test_an_event_for_a_superseded_message_leaves_the_fresh_one_alone(self, mongo_replica_set_url: str):
        """The entry's own case: a re-send mints a new message, and the old one's bounce would mark a link that works."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, rollen=["trainer"])
            await accept(database, client, rollen=["trainer"], nachricht_id=SECOND_MESSAGE, am=LATER_STILL)
            response = await report(database, client, rollen=["trainer"], stand="unzustellbar", grund="NoEmail", am="2026-03-29T12:00:00Z")

            return response.angewendet, await state_of(database, "trainer")

        angewendet, stored = on_a_league(mongo_replica_set_url, body)

        assert angewendet == []
        assert stored == {"nachricht_id": SECOND_MESSAGE, "stand": "angenommen", "grund": None, "am": LATER_STILL}

    def test_a_redelivered_event_changes_nothing(self, mongo_replica_set_url: str):
        """The provider delivers at least once, repeating the stamp it first carried; nothing else here dedupes."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, rollen=["trainer"])
            await report(database, client, rollen=["trainer"], stand="unzustellbar", grund="NoEmail")
            again = await report(database, client, rollen=["trainer"], stand="unzustellbar", grund="NoEmail")

            return again.angewendet, await database[Collection.AKTIONEN].count_documents({"document_id": BEWERBUNG_OID})

        angewendet, rows = on_a_league(mongo_replica_set_url, body)

        assert angewendet == []
        # Two writes and no more: the accept and the bounce. A third would be the redelivery landing.
        assert rows == 2

    def test_a_delivery_arriving_after_the_bounce_does_not_undo_it(self, mongo_replica_set_url: str):
        """Order is not guaranteed, and the wrong answer here reads exactly like a working one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, rollen=["trainer"])
            await report(database, client, rollen=["trainer"], stand="unzustellbar", grund="NoEmail", am=BOUNCED_AT)
            late = await report(database, client, rollen=["trainer"], stand="zugestellt", am=DELIVERED_AT)

            return late.angewendet, await state_of(database, "trainer")

        angewendet, stored = on_a_league(mongo_replica_set_url, body)

        assert angewendet == []
        assert stored is not None and stored["stand"] == "unzustellbar"

    def test_an_event_naming_no_seat_writes_nothing(self, mongo_replica_set_url: str):
        """The sign-in link carries no tags, so the route that verifies it has no seat to name; the answer is still a success."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, rollen=["trainer"])
            response = await report(database, client, rollen=[], stand="unzustellbar", grund="NoEmail")

            return response.angewendet, await state_of(database, "trainer")

        angewendet, stored = on_a_league(mongo_replica_set_url, body)

        assert angewendet == []
        assert stored is not None and stored["stand"] == "angenommen"

    def test_a_seat_the_erasure_emptied_is_skipped_rather_than_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, rollen=["stellvertretung"])
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": BEWERBUNG_OID}, {"$set": {"kontakte.stellvertretung": None, "bestaetigungen.stellvertretung": None}}
            )
            response = await report(database, client, rollen=["stellvertretung"], stand="unzustellbar", grund="NoEmail")

            return response.angewendet, await state_of(database, "stellvertretung")

        assert on_a_league(mongo_replica_set_url, body) == ([], None)

    @pytest.mark.parametrize("call", ["accept", "event"], ids=("the accepted send", "the delivery event"))
    def test_an_application_no_document_names_is_a_404(self, mongo_replica_set_url: str, call: str):
        """An erased application is the ordinary case, so the caller maps this rather than retrying it at the provider's schedule."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException) as failure:
                if call == "accept":
                    await accept(database, client, rollen=["trainer"], bewerbung_id=ABSENT_OID)
                else:
                    await report(database, client, rollen=["trainer"], stand="unzustellbar", bewerbung_id=ABSENT_OID)

            return failure.value.status_code

        assert on_a_league(mongo_replica_set_url, body) == 404
