from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import WriteError

from app.api.zustellung.router import angenommen_zustellung, post_zustellung
from app.api.zustellung.schemas import FLZustellungAngenommenPayload, FLZustellungEreignisPayload, FLZustellungZiel
from app.api.zustellung.services import ZIEL_PFADE, zustellung_pfad
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundException
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_zustellung_test")

ZIEL_OID = ObjectId("6890a1b2c3d4e5f607970001")
ABSENT_OID = ObjectId("6890a1b2c3d4e5f607979999")

FIRST_MESSAGE = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"
SECOND_MESSAGE = "7c1f2b5e-3d44-4a91-9f0b-1e2d3c4b5a60"

ACCEPTED_AT = "2026-03-29T10:00:00.000000+00:00"
DELIVERED_AT = "2026-03-29T10:02:00.000000+00:00"
BOUNCED_AT = "2026-03-29T10:05:00.000000+00:00"
LATER_STILL = "2026-03-29T11:00:00.000000+00:00"

# A kind added to `ZIEL_PFADE` with no row here fails the floor below by name; a suite reading the
# first member alone would leave its endpoint undriven and stay green.
ZIEL_FIXTURES: Mapping[FLZustellungZiel, Mapping[str, Any]] = {
    "schiedsrichter": {
        "_id": ZIEL_OID,
        "name": "Bramblewick Quillon",
        "schule": "Zorbanax-Gesamtschule",
        "default_payment": 25,
        "kontakt": {"telefon": "+49 170 1234567", "email": "bramblewick@example.com"},
        "inactive_since": None,
    },
    "einladung": {
        "_id": ZIEL_OID,
        "saison_id": "2026",
        "team_id": ObjectId("6890a1b2c3d4e5f607970002"),
        "token_hash": "9f2b1c4d7e8a0b3c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4",
        "erstellt_am": "2026-03-28",
        "erstellt_von": "admin@frankfurtleague.de",
        "widerrufen_am": None,
    },
}

ZIELE = sorted(ZIEL_PFADE)


def target(ziel: FLZustellungZiel, *, carrier: bool = True) -> dict[str, Any]:
    """One row of that kind's own collection, carrying the confirmation bookkeeping a message is sent about.

    Empty because the validator declares nothing inside the carrier but the delivery state: a key
    seeded beside it is one no schema checks.
    """

    row = dict(ZIEL_FIXTURES[ziel])

    return {**row, ZIEL_PFADE[ziel].traeger: {}} if carrier else row


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, ziel: FLZustellungZiel, body: Body, *, carrier: bool = True) -> Any:
    """The SHIPPED validators, one target row, nothing yet known about any message to it."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[ZIEL_PFADE[ziel].collection].insert_one(target(ziel, carrier=carrier))

            return await body(database, client)

    return on_the_seed_loop(_run())


async def accept(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    *,
    ziel: FLZustellungZiel,
    nachricht_id: str = FIRST_MESSAGE,
    am: str = ACCEPTED_AT,
    ziel_id: ObjectId = ZIEL_OID,
) -> Any:
    return await angenommen_zustellung(
        angenommen_data=FLZustellungAngenommenPayload.model_validate(
            {"ziel": ziel, "ziel_id": str(ziel_id), "nachricht_id": nachricht_id, "am": am}
        ),
        db=database,
        db_client=client,
    )


async def report(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    *,
    ziel: FLZustellungZiel,
    stand: str,
    nachricht_id: str = FIRST_MESSAGE,
    grund: str | None = None,
    am: str = BOUNCED_AT,
    ziel_id: ObjectId = ZIEL_OID,
) -> Any:
    return await post_zustellung(
        ereignis_data=FLZustellungEreignisPayload.model_validate(
            {"ziel": ziel, "ziel_id": str(ziel_id), "nachricht_id": nachricht_id, "stand": stand, "grund": grund, "am": am}
        ),
        db=database,
        db_client=client,
    )


async def state_of(database: AsyncDatabase, ziel: FLZustellungZiel) -> Any:
    document = await database[ZIEL_PFADE[ziel].collection].find_one({"_id": ZIEL_OID})
    carrier = (document or {}).get(ZIEL_PFADE[ziel].traeger) or {}

    return carrier.get("zustellung")


def test_every_kind_the_register_carries_has_a_stored_row_here():
    """The floor every case below rests on: a kind with no fixture would parametrise nothing and take its endpoint out of this suite."""

    assert set(ZIEL_FIXTURES) == set(ZIEL_PFADE)


@pytest.mark.db
class TestTheCarrierIsValidated:
    """`_object` emits no `additionalProperties`, so an undeclared carrier would store any shape at all.

    The ordering the whole idempotency rests on is a string comparison over `am`, which is worth
    nothing where a record can be stored without one.
    """

    @pytest.mark.parametrize("ziel", ZIELE, ids=lambda ziel: ziel)
    def test_a_record_missing_a_required_key_is_refused(self, ziel: FLZustellungZiel, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            with pytest.raises(WriteError):
                await database[ZIEL_PFADE[ziel].collection].update_one(
                    {"_id": ZIEL_OID}, {"$set": {zustellung_pfad(ZIEL_PFADE[ziel]): {"nachricht_id": FIRST_MESSAGE}}}
                )

            return None

        on_a_league(mongo_replica_set_url, ziel, body)

    @pytest.mark.parametrize("ziel", ZIELE, ids=lambda ziel: ziel)
    def test_a_state_outside_the_six_is_refused(self, ziel: FLZustellungZiel, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            record = {"nachricht_id": FIRST_MESSAGE, "stand": "erfunden", "grund": None, "am": ACCEPTED_AT}

            with pytest.raises(WriteError):
                await database[ZIEL_PFADE[ziel].collection].update_one({"_id": ZIEL_OID}, {"$set": {zustellung_pfad(ZIEL_PFADE[ziel]): record}})

            return None

        on_a_league(mongo_replica_set_url, ziel, body)


@pytest.mark.db
class TestTheAcceptedSend:
    @pytest.mark.parametrize("ziel", ZIELE, ids=lambda ziel: ziel)
    def test_it_records_the_id_the_provider_answered_with(self, ziel: FLZustellungZiel, mongo_replica_set_url: str):
        """The id is the only join between a send and any later event, so a record left without one discards every event about it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await accept(database, client, ziel=ziel), await state_of(database, ziel)

        response, stored = on_a_league(mongo_replica_set_url, ziel, body)

        assert response.angewendet is True
        assert stored == {"nachricht_id": FIRST_MESSAGE, "stand": "angenommen", "grund": None, "am": ACCEPTED_AT}

    @pytest.mark.parametrize("ziel", ZIELE, ids=lambda ziel: ziel)
    def test_a_send_older_than_the_accept_the_record_holds_writes_nothing(self, ziel: FLZustellungZiel, mongo_replica_set_url: str):
        """A call retried after the reminder's own send landed: one host stamped both, so the newer state stands."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, ziel=ziel, nachricht_id=SECOND_MESSAGE, am=LATER_STILL)

            return await accept(database, client, ziel=ziel), await state_of(database, ziel)

        response, stored = on_a_league(mongo_replica_set_url, ziel, body)

        assert response.angewendet is False
        assert stored["nachricht_id"] == SECOND_MESSAGE

    @pytest.mark.parametrize("ziel", ZIELE, ids=lambda ziel: ziel)
    def test_a_re_send_stamped_before_the_event_the_record_holds_takes_the_record(self, ziel: FLZustellungZiel, mongo_replica_set_url: str):
        """A provider clock ahead of this host's, at both ends: the re-send has to land, or every event about the fresh message is discarded."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, ziel=ziel)
            await report(database, client, ziel=ziel, stand="unzustellbar", grund="NoEmail")
            resent = await accept(database, client, ziel=ziel, nachricht_id=SECOND_MESSAGE)
            followed = await report(database, client, ziel=ziel, stand="zugestellt", nachricht_id=SECOND_MESSAGE, am=LATER_STILL)

            return resent, followed, await state_of(database, ziel)

        resent, followed, stored = on_a_league(mongo_replica_set_url, ziel, body)

        assert (resent.angewendet, followed.angewendet) == (True, True)
        assert stored == {"nachricht_id": SECOND_MESSAGE, "stand": "zugestellt", "grund": None, "am": LATER_STILL}

    @pytest.mark.parametrize("ziel", ZIELE, ids=lambda ziel: ziel)
    def test_a_row_carrying_no_confirmation_bookkeeping_is_skipped_rather_than_refused(
        self, ziel: FLZustellungZiel, mongo_replica_set_url: str
    ):
        """Nothing was ever mailed about it, so there is no message for a state to hang off; a refusal would be retried for hours."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await accept(database, client, ziel=ziel), await state_of(database, ziel)

        response, stored = on_a_league(mongo_replica_set_url, ziel, body, carrier=False)

        assert response.angewendet is False
        assert stored is None

    @pytest.mark.parametrize("ziel", ZIELE, ids=lambda ziel: ziel)
    def test_the_write_reaches_the_action_log(self, ziel: FLZustellungZiel, mongo_replica_set_url: str):
        """Which ACTOR the row carries belongs to `tests/api/test_actor_binding.py`.

        The binder is a dependency, so a direct call to the endpoint below never runs it and could
        assert only the context variable's own default.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, ziel=ziel)

            return await database[Collection.AKTIONEN].find({"document_id": ZIEL_OID}).to_list(length=None)

        rows = on_a_league(mongo_replica_set_url, ziel, body)

        assert [(row["collection"], row["operation"]) for row in rows] == [(ZIEL_PFADE[ziel].collection, "patch_one")]


@pytest.mark.db
class TestADeliveryEvent:
    @pytest.mark.parametrize("ziel", ZIELE, ids=lambda ziel: ziel)
    def test_it_writes_the_record_the_register_names_and_nothing_beside_it(self, ziel: FLZustellungZiel, mongo_replica_set_url: str):
        """The dotted path is what a misfiled target lands at, and the carrier is compared whole: a second key here is one no read expects."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, ziel=ziel)
            response = await report(database, client, ziel=ziel, stand="unzustellbar", grund="NoEmail")

            return response, await database[ZIEL_PFADE[ziel].collection].find_one({"_id": ZIEL_OID})

        response, document = on_a_league(mongo_replica_set_url, ziel, body)
        carrier, _, feld = zustellung_pfad(ZIEL_PFADE[ziel]).partition(".")

        assert response.angewendet is True
        assert document[carrier] == {feld: {"nachricht_id": FIRST_MESSAGE, "stand": "unzustellbar", "grund": "NoEmail", "am": BOUNCED_AT}}

    @pytest.mark.parametrize("ziel", ZIELE, ids=lambda ziel: ziel)
    def test_an_event_naming_a_superseded_message_writes_nothing(self, ziel: FLZustellungZiel, mongo_replica_set_url: str):
        """A re-send mints a new message, and the old one's bounce would otherwise mark a link that works."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, ziel=ziel, nachricht_id=SECOND_MESSAGE)
            response = await report(database, client, ziel=ziel, stand="unzustellbar", nachricht_id=FIRST_MESSAGE)

            return response, await state_of(database, ziel)

        response, stored = on_a_league(mongo_replica_set_url, ziel, body)

        assert response.angewendet is False
        assert stored["stand"] == "angenommen"

    @pytest.mark.parametrize("ziel", ZIELE, ids=lambda ziel: ziel)
    def test_the_same_event_twice_is_written_once(self, ziel: FLZustellungZiel, mongo_replica_set_url: str):
        """The provider delivers an event more than once, and no store of its ids sits beside this: the stamp is the whole of it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, ziel=ziel)
            first = await report(database, client, ziel=ziel, stand="unzustellbar", grund="NoEmail")
            again = await report(database, client, ziel=ziel, stand="unzustellbar", grund="NoEmail")

            return first, again, await state_of(database, ziel)

        first, again, stored = on_a_league(mongo_replica_set_url, ziel, body)

        assert (first.angewendet, again.angewendet) == (True, False)
        assert stored["am"] == BOUNCED_AT

    @pytest.mark.parametrize("ziel", ZIELE, ids=lambda ziel: ziel)
    def test_a_delivery_stamped_before_the_bounce_does_not_overtake_it(self, ziel: FLZustellungZiel, mongo_replica_set_url: str):
        """Two events about one message arrive out of order, and the earlier one would otherwise clear a refusal."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, ziel=ziel)
            await report(database, client, ziel=ziel, stand="unzustellbar", grund="NoEmail", am=BOUNCED_AT)
            response = await report(database, client, ziel=ziel, stand="zugestellt", am=DELIVERED_AT)

            return response, await state_of(database, ziel)

        response, stored = on_a_league(mongo_replica_set_url, ziel, body)

        assert response.angewendet is False
        assert stored["stand"] == "unzustellbar"

    @pytest.mark.parametrize("ziel", ZIELE, ids=lambda ziel: ziel)
    def test_a_row_that_no_longer_exists_is_a_404(self, ziel: FLZustellungZiel, mongo_replica_set_url: str):
        """An erasure between the send and the event: the webhook maps this rather than retrying, which would spend the endpoint's standing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await report(database, client, ziel=ziel, stand="zugestellt", ziel_id=ABSENT_OID)

            return None

        on_a_league(mongo_replica_set_url, ziel, body)
