from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import WriteError

from app.api.bewerbungen.services import days_after
from app.api.registrierungen.services import build_erinnerung_filter
from app.api.registrierungen.services import compose_bestaetigung as compose_registrierung_bestaetigung
from app.api.schiedsrichter.services import compose_adresswechsel, compose_bestaetigung
from app.api.teams.services import compose_kontakt_bestaetigung
from app.api.zustellung.router import abgewiesen_zustellung, angenommen_zustellung, post_zustellung
from app.api.zustellung.schemas import (
    ZIELE_JE_SITZ,
    FLZustellungAbgewiesenPayload,
    FLZustellungAngenommenPayload,
    FLZustellungEreignisPayload,
    FLZustellungZiel,
)
from app.api.zustellung.services import ZIEL_PFADE, traeger_halter, traeger_pfade, zustellung_pfad
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundException
from app.shared.schemas.bounds import REGISTRIERUNG_ERINNERUNG_TAGE
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import saison_team_document
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_zustellung_test")

ZIEL_OID = ObjectId("6890a1b2c3d4e5f607970001")
ABSENT_OID = ObjectId("6890a1b2c3d4e5f607979999")

FIRST_MESSAGE = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"
SECOND_MESSAGE = "7c1f2b5e-3d44-4a91-9f0b-1e2d3c4b5a60"

ACCEPTED_AT = "2026-03-29T10:00:00.000000+00:00"
# Before the accept above, which is the order that makes a stale refusal a no-op below.
REFUSED_AT = "2026-03-29T09:00:00.000000+00:00"
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
    "registrierung": {
        "_id": ZIEL_OID,
        "saison_id": "2026",
        "team_id": ObjectId("6890a1b2c3d4e5f607970002"),
        "einladung_id": ObjectId("6890a1b2c3d4e5f607970003"),
        "eingereicht_am": "2026-03-28",
        "status": "eingereicht",
        "vorname": "Thessaly",
        "nachname": "Okonkwo-Brandt",
        "email": "thessaly@example.invalid",
        "position": None,
        "nummer": None,
        "stufe": None,
        "geburtsdatum": None,
        "einwilligung": None,
        "entscheidung": None,
    },
    "kontakt": {"_id": ZIEL_OID, **saison_team_document("2026", ObjectId("6890a1b2c3d4e5f607970002"), "Adler", "AD")},
    # The referee row again: the address link's carrier sits beside the confirmation's on it.
    "schiedsrichter_adresswechsel": {
        "_id": ZIEL_OID,
        "name": "Bramblewick Quillon",
        "schule": "Zorbanax-Gesamtschule",
        "default_payment": 25,
        "kontakt": {"telefon": "+49 170 1234567", "email": "bramblewick@example.com"},
        "inactive_since": None,
    },
}

ZIELE = sorted(ZIEL_PFADE)

MINTED_ON = "2026-03-28"
SEEDED_TOKEN_HASH = "9f2b1c4d7e8a0b3c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4"

# Composed by the production mint rather than spelled here, so a key added to a carrier arrives in
# this fixture: a hand-written one the validator has outgrown refuses every insert below.
CARRIER_SEEDS: Mapping[FLZustellungZiel, Mapping[str, Any]] = {
    "schiedsrichter": compose_bestaetigung(token_hash=SEEDED_TOKEN_HASH, today=MINTED_ON),
    # Empty because the mint writes it empty (`app/api/einladungen/services.py ::
    # compose_einladung`): an invitation's carrier holds the delivery record and nothing beside it.
    "einladung": {},
    "registrierung": compose_registrierung_bestaetigung(token_hash=SEEDED_TOKEN_HASH, today=MINTED_ON, frist="2026-04-04"),
    # The Trainer's seat, the one every case below reports on; the seat axis's own cases reach the others.
    "kontakt": compose_kontakt_bestaetigung(token_hash=SEEDED_TOKEN_HASH, today=MINTED_ON),
    "schiedsrichter_adresswechsel": compose_adresswechsel(email="quillon@example.com", token_hash=SEEDED_TOKEN_HASH, today=MINTED_ON),
}

# The seats each kind's report names: the Trainer's for a seat kind, none for every other.
ROLLEN: Mapping[FLZustellungZiel, list[str]] = {ziel: ["trainer"] if ziel in ZIELE_JE_SITZ else [] for ziel in ZIEL_PFADE}

# The one carrier each kind's cases write, as the endpoint resolves it.
TRAEGER: Mapping[FLZustellungZiel, str] = {ziel: traeger_pfade(ziel, ROLLEN[ziel])[0] for ziel in ZIEL_PFADE}


def target(ziel: FLZustellungZiel, *, carrier: bool = True) -> dict[str, Any]:
    """One row of that kind's own collection, carrying the confirmation bookkeeping a message is sent about.

    `carrier=False` seeds the key nowhere at all, which is a record nothing was ever mailed about.
    """

    row = dict(ZIEL_FIXTURES[ziel])
    if not carrier:
        return row

    if ziel in ZIELE_JE_SITZ:
        # A whole block, the validator requiring every seat: the reported seat's entry, the others empty.
        block = {seat: dict(CARRIER_SEEDS[ziel]) if seat in ROLLEN[ziel] else None for seat in ("trainer", "ansprechperson", "stellvertretung")}
        return {**row, ZIEL_PFADE[ziel].traeger: block}

    return {**row, ZIEL_PFADE[ziel].traeger: dict(CARRIER_SEEDS[ziel])}


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
    rollen: list[str] | None = None,
) -> Any:
    return await angenommen_zustellung(
        angenommen_data=FLZustellungAngenommenPayload.model_validate(
            {
                "ziel": ziel,
                "ziel_id": str(ziel_id),
                "rollen": rollen if rollen is not None else ROLLEN[ziel],
                "nachricht_id": nachricht_id,
                "am": am,
            }
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
    rollen: list[str] | None = None,
) -> Any:
    return await post_zustellung(
        ereignis_data=FLZustellungEreignisPayload.model_validate(
            {
                "ziel": ziel,
                "ziel_id": str(ziel_id),
                "rollen": rollen if rollen is not None else ROLLEN[ziel],
                "nachricht_id": nachricht_id,
                "stand": stand,
                "grund": grund,
                "am": am,
            }
        ),
        db=database,
        db_client=client,
    )


async def refuse(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    *,
    ziel: FLZustellungZiel,
    grund: str | None = "validation_error",
    am: str = REFUSED_AT,
    ziel_id: ObjectId = ZIEL_OID,
) -> Any:
    return await abgewiesen_zustellung(
        abgewiesen_data=FLZustellungAbgewiesenPayload.model_validate(
            {"ziel": ziel, "ziel_id": str(ziel_id), "rollen": ROLLEN[ziel], "grund": grund, "am": am}
        ),
        db=database,
        db_client=client,
    )


def carrier_in(document: Any, traeger: str) -> Any:
    halter, schluessel = traeger_halter(document or {}, traeger)

    return halter.get(schluessel) if isinstance(halter, Mapping) else None


async def state_of(database: AsyncDatabase, ziel: FLZustellungZiel, traeger: str | None = None) -> Any:
    document = await database[ZIEL_PFADE[ziel].collection].find_one({"_id": ZIEL_OID})
    carrier = carrier_in(document, TRAEGER[ziel] if traeger is None else traeger) or {}

    return carrier.get("zustellung")


def test_every_kind_the_register_carries_has_a_stored_row_here():
    """The floor every case below rests on: a kind with no fixture would parametrise nothing and take its endpoint out of this suite."""

    assert set(ZIEL_FIXTURES) == set(ZIEL_PFADE)
    assert set(CARRIER_SEEDS) == set(ZIEL_PFADE)


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
                    {"_id": ZIEL_OID}, {"$set": {zustellung_pfad(TRAEGER[ziel]): {"nachricht_id": FIRST_MESSAGE}}}
                )

            return None

        on_a_league(mongo_replica_set_url, ziel, body)

    @pytest.mark.parametrize("ziel", ZIELE, ids=lambda ziel: ziel)
    def test_a_state_outside_the_six_is_refused(self, ziel: FLZustellungZiel, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            record = {"nachricht_id": FIRST_MESSAGE, "stand": "erfunden", "grund": None, "am": ACCEPTED_AT}

            with pytest.raises(WriteError):
                await database[ZIEL_PFADE[ziel].collection].update_one({"_id": ZIEL_OID}, {"$set": {zustellung_pfad(TRAEGER[ziel]): record}})

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
class TestTheRefusedSend:
    @pytest.mark.parametrize("ziel", ZIELE, ids=lambda ziel: ziel)
    def test_it_records_the_refusal_under_no_message_at_all(self, ziel: FLZustellungZiel, mongo_replica_set_url: str):
        """A refusal at submit time is the only thing ever learnt about that address: no message exists, so no event can follow."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await refuse(database, client, ziel=ziel), await state_of(database, ziel)

        response, stored = on_a_league(mongo_replica_set_url, ziel, body)

        assert response.angewendet is True
        assert stored == {"nachricht_id": "", "stand": "unzustellbar", "grund": "validation_error", "am": REFUSED_AT}

    @pytest.mark.parametrize("ziel", ZIELE, ids=lambda ziel: ziel)
    def test_a_refusal_older_than_the_accept_the_record_holds_writes_nothing(self, ziel: FLZustellungZiel, mongo_replica_set_url: str):
        """One fan-out settles a record's addresses together, so a refusal crossing the accept must not mark a link that works."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, ziel=ziel)

            return await refuse(database, client, ziel=ziel), await state_of(database, ziel)

        response, stored = on_a_league(mongo_replica_set_url, ziel, body)

        assert response.angewendet is False
        assert stored["stand"] == "angenommen"

    @pytest.mark.parametrize("ziel", ZIELE, ids=lambda ziel: ziel)
    def test_a_row_carrying_no_confirmation_bookkeeping_is_skipped_rather_than_refused(
        self, ziel: FLZustellungZiel, mongo_replica_set_url: str
    ):
        """Nothing was ever mailed about it, so there is no address for the provider to have refused."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await refuse(database, client, ziel=ziel), await state_of(database, ziel)

        response, stored = on_a_league(mongo_replica_set_url, ziel, body, carrier=False)

        assert response.angewendet is False
        assert stored is None

    def test_a_registration_the_provider_refused_leaves_the_reminder_clock_s_page(self, mongo_replica_set_url: str):
        """The whole reason the write exists, closed against the clock's own filter rather than against the state it reads."""

        heute = days_after(day=MINTED_ON, days=REGISTRIERUNG_ERINNERUNG_TAGE)
        gefiltert = build_erinnerung_filter(saison_id=ZIEL_FIXTURES["registrierung"]["saison_id"], today=heute)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            collection = database[Collection.REGISTRIERUNGEN]
            vorher = await collection.count_documents(gefiltert)
            await refuse(database, client, ziel="registrierung")

            return vorher, await collection.count_documents(gefiltert)

        vorher, nachher = on_a_league(mongo_replica_set_url, "registrierung", body)

        assert (vorher, nachher) == (1, 0)


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

        assert response.angewendet is True
        # The seed beside it, compared whole: the write touches the record's own path alone, and a
        # key of the person's bookkeeping it overwrote would be a link this call silently voided.
        expected = {"zustellung": {"nachricht_id": FIRST_MESSAGE, "stand": "unzustellbar", "grund": "NoEmail", "am": BOUNCED_AT}}
        assert carrier_in(document, TRAEGER[ziel]) == {**CARRIER_SEEDS[ziel], **expected}

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


@pytest.mark.db
class TestTheSeatAxis:
    """A contact seat's record: one message reaching every seat its person holds, and no seat it did not name."""

    def test_one_message_to_a_person_holding_two_seats_is_recorded_on_both(self, mongo_replica_set_url: str):
        """The re-send writes one entry to both seats, so a state written to one alone would leave the other stale."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            entry = compose_kontakt_bestaetigung(token_hash=SEEDED_TOKEN_HASH, today=MINTED_ON)
            await database[Collection.SAISON_TEAMS].update_one({"_id": ZIEL_OID}, {"$set": {"bestaetigungen.stellvertretung": entry}})
            response = await accept(database, client, ziel="kontakt", rollen=["trainer", "stellvertretung"])

            return response, [
                await state_of(database, "kontakt", f"bestaetigungen.{seat}") for seat in ("trainer", "ansprechperson", "stellvertretung")
            ]

        response, states = on_a_league(mongo_replica_set_url, "kontakt", body)

        accepted = {"nachricht_id": FIRST_MESSAGE, "stand": "angenommen", "grund": None, "am": ACCEPTED_AT}
        assert response.angewendet is True
        assert states == [accepted, None, accepted]

    def test_a_named_seat_holding_no_link_is_skipped_and_the_others_written(self, mongo_replica_set_url: str):
        """A seat emptied between the send and the report: refusing the whole report would drop the record of the seat still standing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await accept(database, client, ziel="kontakt", rollen=["trainer", "ansprechperson"])
            document = await database[Collection.SAISON_TEAMS].find_one({"_id": ZIEL_OID})

            return response, document

        response, document = on_a_league(mongo_replica_set_url, "kontakt", body)

        assert response.angewendet is True
        assert document["bestaetigungen"]["ansprechperson"] is None
        assert document["bestaetigungen"]["trainer"]["zustellung"]["nachricht_id"] == FIRST_MESSAGE

    def test_another_seat_s_message_is_not_written_to_this_one(self, mongo_replica_set_url: str):
        """Two people on one row are two records: a report naming the Trainer leaves a seat it did not name as it was."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            entry = compose_kontakt_bestaetigung(token_hash=SEEDED_TOKEN_HASH, today=MINTED_ON)
            await database[Collection.SAISON_TEAMS].update_one({"_id": ZIEL_OID}, {"$set": {"bestaetigungen.stellvertretung": entry}})
            await accept(database, client, ziel="kontakt")

            return await state_of(database, "kontakt", "bestaetigungen.stellvertretung")

        assert on_a_league(mongo_replica_set_url, "kontakt", body) is None
