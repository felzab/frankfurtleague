"""
API · the erasure's last pass over the log, driven against the shipped validators

Every image this league's writes file of a document the erasure neither removes nor clears holds the
erased address once; the pass leaves none, the marker standing where the address named who acted.
"""

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from app.api.aktionen.crud import redact_address_in_images
from app.api.aktionen.services import IMAGE_ADDRESSES, ImageAddress, address_image_edits
from app.api.einladungen.services import compose_einladung, compose_widerruf_update
from app.api.schiedsrichter.services import ADRESSWECHSEL_FELD, compose_adresswechsel
from app.core.collections import Collection
from app.core.crud import delete_many_from_db, patch_one_in_db
from app.core.recording import ERASED_ACTOR_MARKER
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_aktionen_redaction_test")

# Deliberately unusual, so a hit in the log cannot be a coincidence.
ERASED = "eduarda.fuchsbau@example.com"
# The same mailbox as one row stored it, which only the fold makes theirs.
ERASED_AS_TYPED = "Eduarda.Fuchsbau@EXAMPLE.com"
# The administrator beside them, whose authorship the pass must leave standing.
OTHER_ADMIN = "rainald.kesselflick@example.com"
# A person the erased administrator granted access, who keeps their own grant's record.
GRANTEE = "gunhild.zwirbel@example.com"
REFEREE_NOW = "hiltrud.neupost@example.org"
REFEREE_STORED = "ortrun.altpost@example.org"
PUPIL_NOW = "wendelin.neupost@example.org"
PUPIL_STORED = "walburga.altpost@example.org"

STAMP = "2026-04-01T10:30:00+00:00"
GRANTED_AT = datetime(2026, 1, 5, tzinfo=UTC)

OWN_GRANT = ObjectId("6890a1b2c3d4e5f607840001")
THEIR_GRANT = ObjectId("6890a1b2c3d4e5f607840002")
CONTROL_GRANT = ObjectId("6890a1b2c3d4e5f607840003")
EINLADUNG = ObjectId("6890a1b2c3d4e5f607840011")
BEWERBUNG = ObjectId("6890a1b2c3d4e5f607840021")
REGISTRIERUNG = ObjectId("6890a1b2c3d4e5f607840031")
READDRESSED_REFEREE = ObjectId("6890a1b2c3d4e5f607840041")
PENDING_REFEREE = ObjectId("6890a1b2c3d4e5f607840042")
READDRESSED_PUPIL = ObjectId("6890a1b2c3d4e5f607840043")
PENDING_PUPIL = ObjectId("6890a1b2c3d4e5f607840044")
TEAM = ObjectId("6890a1b2c3d4e5f607840051")

ENTSCHEIDUNG = {"getroffen_am": "2026-03-01", "von": ERASED, "grund": "Zu spät eingereicht"}


def grant(grant_id: ObjectId, adresse: str, erteilt_von: str) -> dict[str, Any]:
    return {"_id": grant_id, "adresse": adresse, "verwaltung": "administration", "erteilt_von": erteilt_von, "erteilt_am": GRANTED_AT}


async def patched(database: AsyncDatabase, collection: Collection, document_id: Any, update: Mapping[str, Any]) -> None:
    """Through the recording helper, so the image this files is the one a real write leaves."""

    await patch_one_in_db(collection=database[collection], db_filter={"_id": document_id}, update=update, return_document=ReturnDocument.BEFORE)


async def a_league_holding_their_images(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    """One image per store the pass reaches, each filed by the kind of write that files it in production."""

    await database[Collection.BERECHTIGUNGEN].insert_many(
        [grant(OWN_GRANT, ERASED, OTHER_ADMIN), grant(THEIR_GRANT, GRANTEE, ERASED), grant(CONTROL_GRANT, "x@example.com", OTHER_ADMIN)]
    )
    # Their own grant's tier change, and a grant they made revoked: the second keeps an array of images.
    await patched(database, Collection.BERECHTIGUNGEN, OWN_GRANT, {"$set": {"verwaltung": "owner"}})
    await patched(database, Collection.BERECHTIGUNGEN, CONTROL_GRANT, {"$set": {"verwaltung": "owner"}})
    ban = documents.ban_document("gesperrt@example.com", bis="2030", erstellt_von=ERASED)
    await database[Collection.SPERRLISTE].insert_one(ban)
    await database[Collection.EINLADUNGEN].insert_one(
        {"_id": EINLADUNG, **compose_einladung(saison_id="2026", team_id=TEAM, token_hash="h" * 64, erstellt_von=ERASED, today="2026-03-01")}
    )
    await patched(database, Collection.EINLADUNGEN, EINLADUNG, compose_widerruf_update(today="2026-03-02"))
    await database[Collection.BEWERBUNGEN].insert_one(
        documents.bewerbung_document(
            BEWERBUNG, "2026", "abgelehnt", kontakte=documents.kontakte_document(), eingereicht_am="2026-02-01", entscheidung=ENTSCHEIDUNG
        )
    )
    await patched(database, Collection.BEWERBUNGEN, BEWERBUNG, {"$set": {"loeschung_angekuendigt_am": "2026-03-05"}})
    await database[Collection.REGISTRIERUNGEN].insert_one(
        documents.registrierung_document(
            REGISTRIERUNG,
            "pupil@example.com",
            saison_id="2026",
            team_id=TEAM,
            vorname="Pia",
            nachname="Muster",
            token="registrierung",
            eingereicht_am="2026-02-01",
            frist="2026-02-08",
            status="abgelehnt",
            entscheidung=ENTSCHEIDUNG,
        )
    )
    await patched(database, Collection.REGISTRIERUNGEN, REGISTRIERUNG, {"$set": {"entscheidung.grund": "Anderes Team"}})
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            documents.schiedsrichter_document(
                READDRESSED_REFEREE, email=ERASED_AS_TYPED, name="Hiltrud Kesselring", default_payment=20, einwilligung=None
            ),
            {
                **documents.schiedsrichter_document(
                    PENDING_REFEREE, email=REFEREE_STORED, name="Ortrun Fadenbach", default_payment=20, einwilligung=None
                ),
                ADRESSWECHSEL_FELD: compose_adresswechsel(email=ERASED, token_hash="w" * 64, today="2026-03-01"),
            },
        ]
    )
    # An unconfirmed referee's address corrected to another mailbox, which the referee step does not reach.
    await patched(database, Collection.SCHIEDSRICHTER, READDRESSED_REFEREE, {"$set": {"kontakt.email": REFEREE_NOW}})
    await patched(database, Collection.SCHIEDSRICHTER, PENDING_REFEREE, {"$unset": {ADRESSWECHSEL_FELD: ""}})
    # The referees' twins among the pupils, whose rows the pupil step does not reach either.
    await database[Collection.SPIELER].insert_many(
        [
            documents.spieler_document(READDRESSED_PUPIL, "Wendelin", "Kesselring", email=ERASED_AS_TYPED),
            documents.spieler_document(
                PENDING_PUPIL,
                "Walburga",
                "Fadenbach",
                email=PUPIL_STORED,
                **{ADRESSWECHSEL_FELD: compose_adresswechsel(email=ERASED, token_hash="v" * 64, today="2026-03-01")},
            ),
        ]
    )
    await patched(database, Collection.SPIELER, READDRESSED_PUPIL, {"$set": {"email": PUPIL_NOW}})
    await patched(database, Collection.SPIELER, PENDING_PUPIL, {"$unset": {ADRESSWECHSEL_FELD: ""}})
    async with client.start_session() as session:
        await delete_many_from_db(collection=database[Collection.BERECHTIGUNGEN], db_filter={"_id": THEIR_GRANT}, session=session)
        await delete_many_from_db(collection=database[Collection.SPERRLISTE], db_filter={"_id": ban["_id"]}, session=session)


async def run_the_pass(database: AsyncDatabase, client: AsyncMongoClient) -> int:
    async def in_session(session: Any) -> int:
        return await redact_address_in_images(
            aktionen_collection=database[Collection.AKTIONEN], identifier=sign_in_identifier(ERASED), stamp=STAMP, session=session
        )

    async with transaction_session(client) as session:
        return await session.with_transaction(in_session)


def after_the_pass(url: str, *, runs: int = 1) -> tuple[list[Mapping[str, Any]], list[Mapping[str, Any]], list[int]]:
    """The log before, the log after, and each run's count."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await a_league_holding_their_images(database, client)
            seeded = await database[Collection.AKTIONEN].find().sort("_id", 1).to_list(length=None)
            counts = [await run_the_pass(database, client) for _ in range(runs)]

            return seeded, await database[Collection.AKTIONEN].find().sort("_id", 1).to_list(length=None), counts

    return on_the_seed_loop(_run())


def image_of(log: list[Mapping[str, Any]], collection: Collection, document_id: Any) -> Any:
    """The one row naming this document, a removal's array of ids included."""

    def names(row: Mapping[str, Any]) -> bool:
        named = row["document_id"]
        return named == document_id or (isinstance(named, list) and document_id in named)

    (row,) = [row for row in log if row["collection"] == str(collection) and names(row)]

    return row


class TestTheJudgement:
    """The pure half, apart from a database."""

    def test_an_address_held_in_another_spelling_is_judged_on_the_fold(self):
        addresses = (ImageAddress("kontakt.email", "kontakt.email", None),)

        assert address_image_edits({"kontakt": {"email": ERASED_AS_TYPED}}, identifier=ERASED, addresses=addresses) == {"kontakt.email": None}

    def test_a_block_is_emptied_whole_where_its_address_is_theirs_and_left_where_it_is_not(self):
        (_, pending) = IMAGE_ADDRESSES[Collection.SCHIEDSRICHTER]

        assert address_image_edits({ADRESSWECHSEL_FELD: {"email": ERASED}}, identifier=ERASED, addresses=(pending,)) == {
            ADRESSWECHSEL_FELD: None
        }
        assert address_image_edits({ADRESSWECHSEL_FELD: {"email": OTHER_ADMIN}}, identifier=ERASED, addresses=(pending,)) == {}

    def test_every_field_naming_who_acted_takes_the_marker_and_every_own_address_goes_null(self):
        """The marker keeps a replayed image valid where the validator requires the field; a person's own address is nobody's to keep."""

        authored = {
            (collection, address.path) for collection, addresses in IMAGE_ADDRESSES.items() for address in addresses if address.replacement
        }

        assert authored == {
            (Collection.BERECHTIGUNGEN, "erteilt_von"),
            (Collection.SPERRLISTE, "erstellt_von"),
            (Collection.EINLADUNGEN, "erstellt_von"),
            (Collection.BEWERBUNGEN, "entscheidung.von"),
            (Collection.REGISTRIERUNGEN, "entscheidung.von"),
        }
        assert {address.replacement for addresses in IMAGE_ADDRESSES.values() for address in addresses} == {ERASED_ACTOR_MARKER, None}


@pytest.mark.db
def test_no_image_holds_the_address_afterwards(mongo_replica_set_url: str):
    """Skip the pass and this fails; the floor is that the seeded log held it in every store."""

    seeded, log, counts = after_the_pass(mongo_replica_set_url)

    held_before = {row["collection"] for row in seeded if ERASED in str(row["before"]).lower()}
    assert held_before == {str(collection) for collection in IMAGE_ADDRESSES}, "a store's image was never seeded holding the address"
    assert ERASED not in str(log).lower()
    # One row per store holding the address, each stamped once and counted once.
    assert counts == [len([row for row in log if row["redacted_at"] == STAMP])] == [10]


@pytest.mark.db
def test_each_image_keeps_everything_but_the_address(mongo_replica_set_url: str):
    """Restore the whole-image redaction and this fails: a grant's own subject, a ban's reason and a referee's name are not theirs."""

    _, log, _ = after_the_pass(mongo_replica_set_url)

    own = image_of(log, Collection.BERECHTIGUNGEN, OWN_GRANT)["before"]
    assert (own["adresse"], own["erteilt_von"]) == (None, OTHER_ADMIN)
    (theirs,) = image_of(log, Collection.BERECHTIGUNGEN, THEIR_GRANT)["before"]
    assert (theirs["adresse"], theirs["erteilt_von"]) == (GRANTEE, ERASED_ACTOR_MARKER)
    (ban,) = next(row for row in log if row["collection"] == str(Collection.SPERRLISTE))["before"]
    assert (ban["erstellt_von"], ban["grund"]) == (ERASED_ACTOR_MARKER, "Falsches Geburtsdatum bei der Anmeldung")
    einladung = image_of(log, Collection.EINLADUNGEN, EINLADUNG)["before"]
    assert (einladung["erstellt_von"], einladung["token_hash"]) == (ERASED_ACTOR_MARKER, "h" * 64)
    for collection, document_id in ((Collection.BEWERBUNGEN, BEWERBUNG), (Collection.REGISTRIERUNGEN, REGISTRIERUNG)):
        assert image_of(log, collection, document_id)["before"]["entscheidung"] == {**ENTSCHEIDUNG, "von": ERASED_ACTOR_MARKER}
    readdressed = image_of(log, Collection.SCHIEDSRICHTER, READDRESSED_REFEREE)["before"]
    assert (readdressed["kontakt"]["email"], readdressed["name"]) == (None, "Hiltrud Kesselring")
    pending = image_of(log, Collection.SCHIEDSRICHTER, PENDING_REFEREE)["before"]
    assert (pending[ADRESSWECHSEL_FELD], pending["kontakt"]["email"]) == (None, REFEREE_STORED)
    readdressed_pupil = image_of(log, Collection.SPIELER, READDRESSED_PUPIL)["before"]
    assert (readdressed_pupil["email"], readdressed_pupil["vorname"]) == (None, "Wendelin")
    pending_pupil = image_of(log, Collection.SPIELER, PENDING_PUPIL)["before"]
    assert (pending_pupil[ADRESSWECHSEL_FELD], pending_pupil["email"]) == (None, PUPIL_STORED)


@pytest.mark.db
def test_an_image_naming_another_administrator_stays_as_recorded(mongo_replica_set_url: str):
    """Kills a pass overwriting by collection alone."""

    seeded, log, _ = after_the_pass(mongo_replica_set_url)

    before, after = image_of(seeded, Collection.BERECHTIGUNGEN, CONTROL_GRANT), image_of(log, Collection.BERECHTIGUNGEN, CONTROL_GRANT)
    assert (after["before"], after["redacted_at"]) == (before["before"], None)


@pytest.mark.db
def test_a_second_run_finds_nothing_left_to_take(mongo_replica_set_url: str):
    """The marker and the nulls fold to no address, so a retried erasure stamps nothing over the first."""

    _, log, counts = after_the_pass(mongo_replica_set_url, runs=2)

    assert counts == [10, 0]
    assert {row["redacted_at"] for row in log if row["redacted_at"] is not None} == {STAMP}
