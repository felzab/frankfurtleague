"""
API · the erasure's last pass over the log, driven against the shipped indexes

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

from app.api.adresswechsel.services import compose_end_update, compose_genehmigung
from app.api.aktionen.crud import redact_address_in_images
from app.api.aktionen.services import IMAGE_ADDRESSES, address_image_edits
from app.api.berechtigungen.antraege import compose_antrag
from app.api.einladungen.services import compose_einladung, compose_widerruf_update
from app.core.collections import Collection
from app.core.crud import delete_many_from_db, patch_one_in_db
from app.core.recording import GELOESCHT_ACTOR_MARKER
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_aktionen_redaction_test")

# Deliberately unusual, so a hit in the log cannot be a coincidence.
GELOESCHT = "eduarda.fuchsbau@example.com"
# The same mailbox as a request or a pasted grant may spell it, which only the fold makes theirs.
GELOESCHT_AS_TYPED = "Eduarda.Fuchsbau@EXAMPLE.com"
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
READDRESSED_PUPIL = ObjectId("6890a1b2c3d4e5f607840043")
TO_THEM = ObjectId("6890a1b2c3d4e5f607840061")
STARTED_BY_THEM = ObjectId("6890a1b2c3d4e5f607840062")
TEAM = ObjectId("6890a1b2c3d4e5f607840051")
ASKED_FOR_THEM = ObjectId("6890a1b2c3d4e5f607840071")
ASKED_BY_THEM = ObjectId("6890a1b2c3d4e5f607840072")

ENTSCHEIDUNG = {"getroffen_am": "2026-03-01", "von": GELOESCHT, "grund": "Zu spät eingereicht"}


def grant(grant_id: ObjectId, adresse: str, erteilt_von: str) -> dict[str, Any]:
    return {"_id": grant_id, "adresse": adresse, "verwaltung": "administration", "erteilt_von": erteilt_von, "erteilt_am": GRANTED_AT}


async def patched(database: AsyncDatabase, collection: Collection, document_id: Any, update: Mapping[str, Any]) -> None:
    """Through the recording helper, so the image this files is the one a real write leaves."""

    await patch_one_in_db(collection=database[collection], db_filter={"_id": document_id}, update=update, return_document=ReturnDocument.BEFORE)


async def a_league_holding_their_images(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    """One image per store the pass reaches, each filed by the kind of write that files it in production."""

    await database[Collection.BERECHTIGUNGEN].insert_many(
        [grant(OWN_GRANT, GELOESCHT, OTHER_ADMIN), grant(THEIR_GRANT, GRANTEE, GELOESCHT), grant(CONTROL_GRANT, "x@example.com", OTHER_ADMIN)]
    )
    # Their own grant's tier change, and a grant they made revoked: the second keeps an array of images.
    await patched(database, Collection.BERECHTIGUNGEN, OWN_GRANT, {"$set": {"verwaltung": "owner"}})
    await patched(database, Collection.BERECHTIGUNGEN, CONTROL_GRANT, {"$set": {"verwaltung": "owner"}})
    ban = documents.ban_document("gesperrt@example.com", bis="2030", erstellt_von=GELOESCHT)
    await database[Collection.SPERRLISTE].insert_one(ban)
    await database[Collection.EINLADUNGEN].insert_one(
        {
            "_id": EINLADUNG,
            **compose_einladung(saison_id="2026", team_id=TEAM, token_hashes=["h" * 64], erstellt_von=GELOESCHT, today="2026-03-01"),
        }
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
                READDRESSED_REFEREE, email=GELOESCHT, name="Hiltrud Kesselring", default_payment=20, einwilligung=None
            )
        ]
    )
    # An unconfirmed referee's address corrected to another mailbox, which the referee step does not reach.
    await patched(database, Collection.SCHIEDSRICHTER, READDRESSED_REFEREE, {"$set": {"kontakt.email": REFEREE_NOW}})
    # The referee's twin among the pupils, whose row the pupil step does not reach either.
    await database[Collection.SPIELER].insert_one(documents.spieler_document(READDRESSED_PUPIL, "Wendelin", "Kesselring", email=GELOESCHT))
    await patched(database, Collection.SPIELER, READDRESSED_PUPIL, {"$set": {"email": PUPIL_NOW}})
    # A change once bound for their mailbox, and one they started as an administrator: each since ended.
    await database[Collection.ADRESSWECHSEL].insert_many(
        [
            {"_id": TO_THEM, **documents.adresswechsel_document(adresse=PUPIL_STORED, email=GELOESCHT, token_hash="v" * 64, day="2026-03-01")},
            {
                "_id": STARTED_BY_THEM,
                **documents.adresswechsel_document(
                    adresse=REFEREE_STORED,
                    email="ortrun.neupost@example.org",
                    token_hash="w" * 64,
                    day="2026-03-01",
                    weg="wartezeit",
                    genehmigung=compose_genehmigung(verwaltung="administration", gestartet_von=GELOESCHT, now=GRANTED_AT),
                ),
            },
        ]
    )
    for change in (TO_THEM, STARTED_BY_THEM):
        await patched(database, Collection.ADRESSWECHSEL, change, compose_end_update(art="verworfen", now=GRANTED_AT))
    # A grant asked for them and one they asked for, each decided since, which removes it with its image.
    await database[Collection.BERECHTIGUNGEN_ANTRAEGE].insert_many(
        [
            {
                "_id": ASKED_FOR_THEM,
                **compose_antrag(
                    adresse=GELOESCHT, verwaltung="administration", berechtigung_id=None, gestartet_von=OTHER_ADMIN, now=GRANTED_AT
                ),
            },
            {
                "_id": ASKED_BY_THEM,
                **compose_antrag(adresse=GRANTEE, verwaltung="administration", berechtigung_id=None, gestartet_von=GELOESCHT, now=GRANTED_AT),
            },
        ]
    )
    async with client.start_session() as session:
        await delete_many_from_db(collection=database[Collection.BERECHTIGUNGEN], db_filter={"_id": THEIR_GRANT}, session=session)
        await delete_many_from_db(collection=database[Collection.SPERRLISTE], db_filter={"_id": ban["_id"]}, session=session)
        for antrag in (ASKED_FOR_THEM, ASKED_BY_THEM):
            await delete_many_from_db(collection=database[Collection.BERECHTIGUNGEN_ANTRAEGE], db_filter={"_id": antrag}, session=session)


async def run_the_pass(database: AsyncDatabase, client: AsyncMongoClient, identifier: str) -> int:
    async def in_session(session: Any) -> int:
        return await redact_address_in_images(
            aktionen_collection=database[Collection.AKTIONEN], identifier=identifier, stamp=STAMP, session=session
        )

    async with transaction_session(client) as session:
        return await session.with_transaction(in_session)


def after_the_pass(
    url: str, *, runs: int = 1, identifier: str = sign_in_identifier(GELOESCHT)
) -> tuple[list[Mapping[str, Any]], list[Mapping[str, Any]], list[int]]:
    """The log before, the log after, and each run's count."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await a_league_holding_their_images(database, client)
            seeded = await database[Collection.AKTIONEN].find().sort("_id", 1).to_list(length=None)
            counts = [await run_the_pass(database, client, identifier) for _ in range(runs)]

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

    def test_a_grant_image_holding_a_pasted_spelling_is_judged_on_the_fold(self):
        addresses = IMAGE_ADDRESSES[Collection.BERECHTIGUNGEN]

        assert address_image_edits({"adresse": GELOESCHT_AS_TYPED, "erteilt_von": OTHER_ADMIN}, identifier=GELOESCHT, addresses=addresses) == {
            "adresse": None
        }

    def test_a_nested_actor_takes_the_marker_where_it_is_theirs_and_stays_where_it_is_not(self):
        addresses = IMAGE_ADDRESSES[Collection.ADRESSWECHSEL]
        image = {"adresse": REFEREE_STORED, "genehmigung": {"gestartet_von": GELOESCHT, "genehmigt_von": OTHER_ADMIN}}

        assert address_image_edits(image, identifier=GELOESCHT, addresses=addresses) == {"genehmigung.gestartet_von": GELOESCHT_ACTOR_MARKER}

    def test_every_field_naming_who_acted_takes_the_marker_and_every_own_address_goes_null(self):
        """The marker keeps a replayed image valid where its record model requires the field; a person's own address is nobody's to keep."""

        authored = {
            (collection, address.path) for collection, addresses in IMAGE_ADDRESSES.items() for address in addresses if address.replacement
        }

        assert authored == {
            (Collection.BERECHTIGUNGEN, "erteilt_von"),
            (Collection.SPERRLISTE, "erstellt_von"),
            (Collection.EINLADUNGEN, "erstellt_von"),
            (Collection.BEWERBUNGEN, "entscheidung.von"),
            (Collection.REGISTRIERUNGEN, "entscheidung.von"),
            (Collection.ADRESSWECHSEL, "genehmigung.gestartet_von"),
            (Collection.ADRESSWECHSEL, "genehmigung.genehmigt_von"),
            (Collection.BERECHTIGUNGEN_ANTRAEGE, "genehmigung.gestartet_von"),
        }
        assert {address.replacement for addresses in IMAGE_ADDRESSES.values() for address in addresses} == {GELOESCHT_ACTOR_MARKER, None}


@pytest.mark.db
def test_no_image_holds_the_address_afterwards(mongo_replica_set_url: str):
    """Skip the pass and this fails; the floor is that the seeded log held it in every store."""

    seeded, log, counts = after_the_pass(mongo_replica_set_url)

    held_before = {row["collection"] for row in seeded if GELOESCHT in str(row["before"]).lower()}
    assert held_before == {str(collection) for collection in IMAGE_ADDRESSES}, "a store's image was never seeded holding the address"
    assert GELOESCHT not in str(log).lower()
    # One row per store holding the address, each stamped once and counted once.
    assert counts == [len([row for row in log if row["redacted_at"] == STAMP])] == [12]


@pytest.mark.db
def test_a_spelling_handed_in_unfolded_still_takes_the_address_out(mongo_replica_set_url: str):
    """Drop the fold at the pass's entry and this fails: every image but a grant's is read by equality on the stored fold."""

    _, log, counts = after_the_pass(mongo_replica_set_url, identifier=GELOESCHT_AS_TYPED)

    assert GELOESCHT not in str(log).lower()
    # Every row the folded spelling's run stamps, each counted once.
    assert counts == [len([row for row in log if row["redacted_at"] == STAMP])] == [12]


@pytest.mark.db
def test_each_image_keeps_everything_but_the_address(mongo_replica_set_url: str):
    """Restore the whole-image redaction and this fails: a grant's own subject, a ban's reason and a referee's name are not theirs."""

    _, log, _ = after_the_pass(mongo_replica_set_url)

    own = image_of(log, Collection.BERECHTIGUNGEN, OWN_GRANT)["before"]
    assert (own["adresse"], own["erteilt_von"]) == (None, OTHER_ADMIN)
    (theirs,) = image_of(log, Collection.BERECHTIGUNGEN, THEIR_GRANT)["before"]
    assert (theirs["adresse"], theirs["erteilt_von"]) == (GRANTEE, GELOESCHT_ACTOR_MARKER)
    (ban,) = next(row for row in log if row["collection"] == str(Collection.SPERRLISTE))["before"]
    assert (ban["erstellt_von"], ban["grund"]) == (GELOESCHT_ACTOR_MARKER, "Falsches Geburtsdatum bei der Anmeldung")
    einladung = image_of(log, Collection.EINLADUNGEN, EINLADUNG)["before"]
    assert (einladung["erstellt_von"], einladung["token_hashes"]) == (GELOESCHT_ACTOR_MARKER, ["h" * 64])
    for collection, document_id in ((Collection.BEWERBUNGEN, BEWERBUNG), (Collection.REGISTRIERUNGEN, REGISTRIERUNG)):
        assert image_of(log, collection, document_id)["before"]["entscheidung"] == {**ENTSCHEIDUNG, "von": GELOESCHT_ACTOR_MARKER}
    readdressed = image_of(log, Collection.SCHIEDSRICHTER, READDRESSED_REFEREE)["before"]
    assert (readdressed["kontakt"]["email"], readdressed["name"]) == (None, "Hiltrud Kesselring")
    readdressed_pupil = image_of(log, Collection.SPIELER, READDRESSED_PUPIL)["before"]
    assert (readdressed_pupil["email"], readdressed_pupil["vorname"]) == (None, "Wendelin")
    to_them = image_of(log, Collection.ADRESSWECHSEL, TO_THEM)["before"]
    assert (to_them["email"], to_them["adresse"]) == (None, PUPIL_STORED)
    started = image_of(log, Collection.ADRESSWECHSEL, STARTED_BY_THEM)["before"]
    assert (started["adresse"], started["genehmigung"]["gestartet_von"]) == (REFEREE_STORED, GELOESCHT_ACTOR_MARKER)
    ((for_them,), (by_them,)) = (
        image_of(log, Collection.BERECHTIGUNGEN_ANTRAEGE, antrag)["before"] for antrag in (ASKED_FOR_THEM, ASKED_BY_THEM)
    )
    assert (for_them["adresse"], for_them["genehmigung"]["gestartet_von"]) == (None, OTHER_ADMIN)
    assert (by_them["adresse"], by_them["genehmigung"]["gestartet_von"]) == (GRANTEE, GELOESCHT_ACTOR_MARKER)


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

    assert counts == [12, 0]
    assert {row["redacted_at"] for row in log if row["redacted_at"] is not None} == {STAMP}
