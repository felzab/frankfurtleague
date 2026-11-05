import re
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.identity.schemas import FLErasureResponse, FLErasureViewResponse
from app.api.identity.services import build_erasure_seat_pipeline
from app.api.kontakte.crud import erase_kontaktperson_in_session
from app.api.kontakte.services import (
    build_clearing_update,
    departing_names,
    same_address,
    seat_image_edits,
)
from app.api.spielbestaetigungen.services import halter_of
from app.api.teams.schemas import FLSaisonTeamKontakte
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, patch_one_in_db
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier
from app.shared.schemas.literals import KONTAKT_ROLLEN
from app.shared.tokens import hash_token
from tests import documents
from tests.config import build_test_config
from tests.database import DOCUMENT_VALIDATION_FAILED, a_clean_database, on_the_seed_loop
from tests.documents import confirmed_kenntnisnahme, minted_confirmations
from tests.erasure import erased
from tests.worker import worker_database

from .test_loeschung_auf_anfrage import revealed

DATABASE_NAME = worker_database("fl_kontakt_loeschung_test")


# Fixed rather than generated, so a failure names the same row every run.
TEAM_A_OID = ObjectId("6890a1b2c3d4e5f607810001")
TEAM_B_OID = ObjectId("6890a1b2c3d4e5f607810002")
ROW_A_EARLIER_OID = ObjectId("6890a1b2c3d4e5f607810011")
ROW_A_LATER_OID = ObjectId("6890a1b2c3d4e5f607810012")
ROW_B_OID = ObjectId("6890a1b2c3d4e5f607810013")
BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607810021")
OTHER_BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607810022")

EARLIER_SAISON = "2425"
LATER_SAISON = "2526"

# Deliberately unusual, so a hit in the whole-database sweep below cannot be a coincidence: no
# fixture, no other suite and no seeded default anywhere spells any of these.
ERASED_EMAIL = "wiltrudis.quastenflosser@example.com"
ERASED_TELEFON = "+49 69 5550101"
ERASED_FORMER_TELEFON = "+49 69 5559901"
ERASED_NACHNAME = "Quastenflosser"

# The person beside them in the SAME block, whose record must survive untouched.
BYSTANDER_EMAIL = "ortwinia.pfeffernuss@example.com"
BYSTANDER_TELEFON = "+49 69 5550202"
BYSTANDER_FORMER_TELEFON = "+49 69 5559902"
BYSTANDER_NACHNAME = "Pfeffernuss"

# The third slot, and the whole of the row that must not be reached at all.
UNREACHED_EMAIL = "baldur.krautzberger@example.com"
UNREACHED_TELEFON = "+49 69 5550303"
UNREACHED_FORMER_TELEFON = "+49 69 5559903"
UNREACHED_NACHNAME = "Krautzberger"

# An address stored nowhere, for the no-op case.
UNKNOWN_EMAIL = "niemand.hierverzeichnet@example.com"

# The request the two tables below are erased with: the same mailbox as `ERASED_EMAIL`, in a spelling
# no seeded row holds. Nothing but the match's own keying (`app/shared/folding.py :: sign_in_identifier`)
# normalises it.
VARIANT_REQUEST_EMAIL = "Wiltrudis.Quastenflosser@EXAMPLE.COM"

# Every spelling of that one mailbox a hand-typed grant may hold, which the grant erasure's pattern
# (`app/api/kontakte/services.py :: same_address`) must take: the domain differing, the local part differing, and both.
CASE_VARIANTS: tuple[str, ...] = (
    ERASED_EMAIL,
    ERASED_EMAIL.replace("example.com", "EXAMPLE.COM"),
    "Wiltrudis.Quastenflosser@example.com",
    ERASED_EMAIL.upper(),
)

# Addresses the same request must leave standing. The pattern reads those at another domain, the fold
# refusing them; unanchored, or with the `.` unescaped, it reads the other local parts too.
OTHER_DOMAINS: tuple[str, ...] = ("wiltrudis.quastenflosser@example.org", "wiltrudis.quastenflosser@example.community")
OTHER_LOCAL_PARTS: tuple[str, ...] = ("nichtwiltrudis.quastenflosser@example.com", "wiltrudisXquastenflosser@example.com")
NEAR_MISSES: tuple[str, ...] = (*OTHER_DOMAINS, *OTHER_LOCAL_PARTS)

# One row holding the mailbox as a payload stores it, and one per near miss, ids fixed so a failure names the spelling.
MATCHED_ROW_OID = ObjectId("6890a1b2c3d4e5f607813000")
NEAR_ROW_OIDS = {email: ObjectId(f"6890a1b2c3d4e5f60781{4000 + index:04d}") for index, email in enumerate(NEAR_MISSES)}

# The row an ordinary contact edit moves the erased person OUT of, and one it never stood in. Both
# hold their FORMER number, which the edit then replaces, so that number lives in the log alone.
SWAPPED_ROW_OID = ObjectId("6890a1b2c3d4e5f607815001")
UNTOUCHED_ROW_OID = ObjectId("6890a1b2c3d4e5f607815002")
SWAP_SAISON = "2627"

# Injected through `get_germany_now`, and in summer, so the conversion below moves the clock.
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# Written out rather than computed from `log_stamp`, which would agree with any conversion of `NOW`, including none.
REDACTED_AT = "2026-04-01T10:30:00+00:00"


# Every seeded person, by surname: the address that identifies them, the number they hold now, and
# the number an earlier write replaced. The replaced one lives in the LOG alone, which is the copy an
# erasure stopping at the collections leaves standing.
PEOPLE: dict[str, tuple[str, str, str]] = {
    ERASED_NACHNAME: (ERASED_EMAIL, ERASED_TELEFON, ERASED_FORMER_TELEFON),
    BYSTANDER_NACHNAME: (BYSTANDER_EMAIL, BYSTANDER_TELEFON, BYSTANDER_FORMER_TELEFON),
    UNREACHED_NACHNAME: (UNREACHED_EMAIL, UNREACHED_TELEFON, UNREACHED_FORMER_TELEFON),
}

# Who stands in each slot of each seeded row, in `KONTAKT_ROLLEN` order, plus which seat the form said
# the Trainer also holds. Every case the erasure has to answer is one row here.
SEEDED_ROLES: dict[ObjectId, tuple[tuple[str, str, str], str | None]] = {
    # One slot naming the erased person, and two people beside them who asked for nothing.
    ROW_A_EARLIER_OID: ((ERASED_NACHNAME, BYSTANDER_NACHNAME, UNREACHED_NACHNAME), None),
    # The same person a season later, and in TWO slots: `trainer_is_also` stores one
    # person twice, so clearing the first alone would leave this block naming them.
    ROW_A_LATER_OID: ((ERASED_NACHNAME, ERASED_NACHNAME, BYSTANDER_NACHNAME), "ansprechperson"),
    # Nobody the erasure may reach.
    ROW_B_OID: ((UNREACHED_NACHNAME, BYSTANDER_NACHNAME, UNREACHED_NACHNAME), None),
    # The second store this branch adds, with the person in a different slot than on the junction.
    BEWERBUNG_OID: ((BYSTANDER_NACHNAME, ERASED_NACHNAME, UNREACHED_NACHNAME), None),
    OTHER_BEWERBUNG_OID: ((UNREACHED_NACHNAME, BYSTANDER_NACHNAME, UNREACHED_NACHNAME), None),
}


def person(nachname: str, telefon: str) -> dict[str, Any]:
    """Every field `app/api/teams/schemas.py :: FLKontaktperson` requires, all six of them present."""

    email, _, _ = PEOPLE[nachname]

    return {
        "vorname": "Vor" + nachname[:4],
        "nachname": nachname,
        "email": email,
        "telefon": telefon,
        "geburtsdatum": "1979-03-14",
        "einwilligung": confirmed_kenntnisnahme(date="2026-01-05"),
    }


def blocks(*, live: bool) -> dict[ObjectId, dict[str, Any]]:
    """The five seeded blocks in one of their two states, keyed by the row that holds them.

    The two states differ in every telephone number and in nothing else, so a value found in the log
    can be attributed to the state it came from.
    """

    telefone = {nachname: (held if live else replaced) for nachname, (_, held, replaced) in PEOPLE.items()}

    return {
        row_id: {
            **{slot: person(nachname, telefone[nachname]) for slot, nachname in zip(KONTAKT_ROLLEN, roles, strict=True)},
            "trainer_is_also": zugleich,
        }
        for row_id, (roles, zugleich) in SEEDED_ROLES.items()
    }


FORMER_BLOCKS = blocks(live=False)
LIVE_BLOCKS = blocks(live=True)

SAISON_TEAM_OIDS = (ROW_A_EARLIER_OID, ROW_A_LATER_OID, ROW_B_OID)
BEWERBUNG_OIDS = (BEWERBUNG_OID, OTHER_BEWERBUNG_OID)

# Which rows the erasure must reach, and how many slots each one owes it. Stated here so a failure
# names the expectation rather than a number computed beside the code under test.
EXPECTED_SLOTS = {ROW_A_EARLIER_OID: 1, ROW_A_LATER_OID: 2, BEWERBUNG_OID: 1}


def saison_team_document(row_id: ObjectId, saison_id: str, team_id: ObjectId) -> dict[str, Any]:
    return documents.saison_team_document(
        saison_id, team_id, "Testschule", "TSX", _id=row_id, trikot_farbe="blau", kontakte=FORMER_BLOCKS[row_id]
    )


# The three live links every seeded application carries, so an erasure has bookkeeping to reach.
# Minted as the shared application builder mints them, from this prefix on the submission's day.
LINK_PREFIX = "link"
BESTAETIGUNGEN = minted_confirmations(hashes={slot: hash_token(f"{LINK_PREFIX}-{slot}") for slot in KONTAKT_ROLLEN}, today="2026-01-05")


def bewerbung_document(row_id: ObjectId, team_id: ObjectId) -> dict[str, Any]:
    """The same, for `Collection.BEWERBUNGEN`, whose `kontakte` is a REQUIRED, non-nullable block."""

    return documents.bewerbung_document(
        row_id,
        LATER_SAISON,
        "submitted",
        kontakte=FORMER_BLOCKS[row_id],
        submitted_at="2026-01-05",
        confirmation_deadline="2026-01-19",
        team_id=team_id,
        link_prefix=LINK_PREFIX,
        kader={"expected_size": 12, "good_spieler": 3},
    )


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]

# The counts, both collections keyed by `_id`, and the whole log -- what most cases below read.
Snapshot = tuple[FLErasureResponse, dict[Any, Mapping[str, Any]], list[Mapping[str, Any]]]


async def a_row_with_a_history(database: AsyncDatabase, collection: str, row_id: ObjectId) -> None:
    """Two recorded writes over a seeded row, which is what leaves the log holding these people.

    The first replaces the FORMER block, so the numbers it held live in the log alone; the second
    touches another field, whose image is the block as it stands.
    """

    await patch_one_in_db(
        collection=database[collection],
        db_filter={"_id": row_id},
        update={"$set": {"kontakte": LIVE_BLOCKS[row_id]}},
        return_document=ReturnDocument.BEFORE,
    )
    await patch_one_in_db(
        collection=database[collection], db_filter={"_id": row_id}, update={"$set": {"gruppe": "B"}}, return_document=ReturnDocument.BEFORE
    )


async def a_bewerbung_with_a_history(database: AsyncDatabase, row_id: ObjectId) -> None:
    """The junction's shape, with the second write over a field an application actually carries."""

    collection = database[Collection.BEWERBUNGEN]

    await patch_one_in_db(
        collection=collection,
        db_filter={"_id": row_id},
        update={"$set": {"kontakte": LIVE_BLOCKS[row_id]}},
        return_document=ReturnDocument.BEFORE,
    )
    await patch_one_in_db(
        collection=collection, db_filter={"_id": row_id}, update={"$set": {"kader.good_spieler": 4}}, return_document=ReturnDocument.BEFORE
    )


def on_a_league(url: str, body: Body, *, mutates_schema: bool = False) -> Any:
    """The shipped support indexes, so a namespace a transaction cannot create is there.

    `mutates_schema=True` where the body plants a validator of its own to make one write fail.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    saison_team_document(ROW_A_EARLIER_OID, EARLIER_SAISON, TEAM_A_OID),
                    saison_team_document(ROW_A_LATER_OID, LATER_SAISON, TEAM_A_OID),
                    saison_team_document(ROW_B_OID, EARLIER_SAISON, TEAM_B_OID),
                ]
            )
            await database[Collection.BEWERBUNGEN].insert_many(
                [bewerbung_document(BEWERBUNG_OID, TEAM_A_OID), bewerbung_document(OTHER_BEWERBUNG_OID, TEAM_B_OID)]
            )
            for row_id in SAISON_TEAM_OIDS:
                await a_row_with_a_history(database, Collection.SAISON_TEAMS, row_id)
            for row_id in BEWERBUNG_OIDS:
                await a_bewerbung_with_a_history(database, row_id)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def call_erasure(database: AsyncDatabase, client: AsyncMongoClient, email: str = ERASED_EMAIL) -> FLErasureResponse:
    return await erased(database, client, email, germany_now=NOW)


async def call_ansicht(database: AsyncDatabase, client: AsyncMongoClient, email: str = ERASED_EMAIL) -> FLErasureViewResponse:
    """The administrator's reveal of the address, whose seats are the erasure's own selection."""

    return await revealed(database, client, email)


async def stored_rows(database: AsyncDatabase) -> dict[Any, Mapping[str, Any]]:
    """Both collections keyed by `_id`, so a failing assertion names the row rather than a list position."""

    found: dict[Any, Mapping[str, Any]] = {}
    for collection in (Collection.SAISON_TEAMS, Collection.BEWERBUNGEN):
        for row in await database[collection].find().to_list(length=None):
            found[row["_id"]] = row

    return found


async def log_rows_naming(database: AsyncDatabase, collection: Collection, row_id: ObjectId) -> list[Mapping[str, Any]]:
    """Every log row about this document, spelled out here rather than taken from the endpoint's own filter.

    A wrong filter in the endpoint cannot then make these assertions agree with it.
    """

    rows = database[Collection.ACTION_LOG].find({"collection": str(collection), "document_id": row_id})

    return await rows.to_list(length=None)


def a_block_holding(trainer: Mapping[str, Any]) -> dict[str, Any]:
    """One person in the Trainer slot, the other two empty, all four keys present."""

    return {**{slot: None for slot in KONTAKT_ROLLEN}, "trainer": dict(trainer), "trainer_is_also": None}


def a_junction_row(row_id: ObjectId, saison_id: str, block: Mapping[str, Any]) -> dict[str, Any]:
    """A valid `saison_teams` row carrying exactly this block, its own id standing in as `team_id`.

    Which is what lets a case seed as many rows as it likes under `uniq_saison_id_team_id`.
    """

    return documents.saison_team_document(saison_id, row_id, "Testschule", "TSX", _id=row_id, trikot_farbe="blau", kontakte=dict(block))


def a_row_naming(row_id: ObjectId, email: str) -> dict[str, Any]:
    """A junction row whose Trainer holds exactly this address, inserted straight past pydantic.

    Which is how an application reaches it in any case: `bewerbungen` has no create endpoint, so
    `bsonType: "string"` is all a stored address is held to.
    """

    return a_junction_row(row_id, LATER_SAISON, a_block_holding({**person(UNREACHED_NACHNAME, UNREACHED_TELEFON), "email": email}))


async def a_swap_moves_them_out(database: AsyncDatabase) -> None:
    """The auditor's sequence: seed the person into a row, then edit her out of it through a real write.

    `patch_one_in_db` is what an administrator's contact edit runs through, so the pre-image it files
    here is the one a swap files in production.
    """

    await database[Collection.SAISON_TEAMS].insert_many(
        [
            a_junction_row(
                SWAPPED_ROW_OID,
                SWAP_SAISON,
                a_block_holding({**person(ERASED_NACHNAME, ERASED_FORMER_TELEFON), "email": ERASED_EMAIL}),
            ),
            a_junction_row(UNTOUCHED_ROW_OID, SWAP_SAISON, a_block_holding(person(BYSTANDER_NACHNAME, BYSTANDER_FORMER_TELEFON))),
        ]
    )

    collection = database[Collection.SAISON_TEAMS]
    # The swap itself, and a plain edit beside it. Each replaces the number its row was seeded with,
    # so after both, every FORMER number in this league exists in the log and nowhere else.
    await patch_one_in_db(
        collection=collection,
        db_filter={"_id": SWAPPED_ROW_OID},
        update={"$set": {"kontakte.trainer": person(UNREACHED_NACHNAME, UNREACHED_TELEFON)}},
        return_document=ReturnDocument.BEFORE,
    )
    await patch_one_in_db(
        collection=collection,
        db_filter={"_id": UNTOUCHED_ROW_OID},
        update={"$set": {"kontakte.trainer.telefon": BYSTANDER_TELEFON}},
        return_document=ReturnDocument.BEFORE,
    )


def after_loeschen_a_swapped_out_person(url: str) -> Snapshot:
    """A league where the erasure runs against rows that no longer name the person it is given."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await a_swap_moves_them_out(database)
            response = await call_erasure(database, client)
            log = await database[Collection.ACTION_LOG].find().sort("_id", 1).to_list(length=None)

            return response, await stored_rows(database), log

    return on_the_seed_loop(_run())


def after_loeschen_the_near_misses(url: str) -> tuple[FLErasureResponse, dict[Any, Mapping[str, Any]]]:
    """The seeded league plus the stored mailbox and its near misses, erased with an unfolded spelling of the mailbox."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SAISON_TEAMS].insert_many(
            [a_row_naming(row_id, email) for email, row_id in ((ERASED_EMAIL, MATCHED_ROW_OID), *NEAR_ROW_OIDS.items())]
        )
        response = await call_erasure(database, client, VARIANT_REQUEST_EMAIL)

        return response, await stored_rows(database)

    return on_a_league(url, body)


def after_erasure(url: str, email: str = ERASED_EMAIL) -> Snapshot:
    """The counts, both collections and the whole log together: one seeded database serves all three."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        response = await call_erasure(database, client, email)
        log = await database[Collection.ACTION_LOG].find().sort("_id", 1).to_list(length=None)

        return response, await stored_rows(database), log

    return on_a_league(url, body)


class TestTheSlotsAreReadOffTheModel:
    """The spelling the write turns on, apart from a database."""

    def test_every_slot_the_model_declares_is_covered(self):
        """A role added to the block alone is cleared by nothing, and one added out of order is listed out of it."""

        declared = tuple(name for name in FLSaisonTeamKontakte.model_fields if name != "trainer_is_also")

        assert declared == KONTAKT_ROLLEN


@pytest.mark.db
def test_the_matching_slot_is_nulled_in_every_season(mongo_replica_set_url: str):
    """The case the endpoint exists for. Kills scoping the erasure to one row, and a transaction that never commits."""

    _, rows, _ = after_erasure(mongo_replica_set_url)

    assert rows[ROW_A_EARLIER_OID]["kontakte"]["trainer"] is None
    assert rows[ROW_A_LATER_OID]["kontakte"]["trainer"] is None


@pytest.mark.db
def test_one_person_in_two_slots_of_one_row_loses_both(mongo_replica_set_url: str):
    """Kills stopping at the first match: `trainer_is_also` stores one person twice."""

    _, rows, _ = after_erasure(mongo_replica_set_url)
    kontakte = rows[ROW_A_LATER_OID]["kontakte"]

    assert (kontakte["trainer"], kontakte["ansprechperson"]) == (None, None)


@pytest.mark.db
def test_the_application_is_cleared_as_well_as_the_junction(mongo_replica_set_url: str):
    """Kills an erasure reaching one store: this branch adds a SECOND copy of the same three people."""

    _, rows, _ = after_erasure(mongo_replica_set_url)

    assert rows[BEWERBUNG_OID]["kontakte"]["ansprechperson"] is None


@pytest.mark.db
def test_the_geloescht_seats_link_goes_with_the_person_and_no_other_seats_does(mongo_replica_set_url: str):
    """Kills an erasure stopping at `kontakte`: a live link would outlive the person and confirm a slot naming nobody."""

    _, rows, _ = after_erasure(mongo_replica_set_url)
    block = rows[BEWERBUNG_OID]["confirmations"]

    assert block["ansprechperson"] is None
    assert block["trainer"] == BESTAETIGUNGEN["trainer"]
    assert block["stellvertretung"] == BESTAETIGUNGEN["stellvertretung"]
    assert rows[OTHER_BEWERBUNG_OID]["confirmations"] == BESTAETIGUNGEN


@pytest.mark.db
def test_a_junction_row_gains_no_bookkeeping_block(mongo_replica_set_url: str):
    """Kills a clearing that nulls the seat's bookkeeping unconditionally: a dotted `$set` into an absent block creates one."""

    _, rows, _ = after_erasure(mongo_replica_set_url)

    assert all("confirmations" not in rows[row_id] for row_id in SAISON_TEAM_OIDS)


def test_the_clearing_names_the_bookkeeping_only_where_told_to_and_the_digest_always():
    """The pure half: a season row holding no block gets no key created.

    The digest goes either way: an `$unset` creates nothing.
    """

    assert build_clearing_update(("trainer",)) == {"$set": {"kontakte.trainer": None}, "$unset": {"idempotency_fingerprint": ""}}
    assert build_clearing_update(("trainer",), confirmations=True) == {
        "$set": {"kontakte.trainer": None, "confirmations.trainer": None},
        "$unset": {"idempotency_fingerprint": ""},
    }


CORRECTED_ROW_OID = ObjectId("6890a1b2c3d4e5f607817301")
MISTYPED_EMAIL = "wiltrudis.quastenflosser@exmaple.com"


@pytest.mark.db
def test_a_seat_held_under_an_address_since_corrected_leaves_the_rows_images(mongo_replica_set_url: str):
    """Match the reached row's images on the address alone and this fails: the mistyped one sits beside her name and number."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        mistyped = a_block_holding({**person(ERASED_NACHNAME, ERASED_TELEFON), "email": MISTYPED_EMAIL})
        await database[Collection.SAISON_TEAMS].insert_one(a_junction_row(CORRECTED_ROW_OID, LATER_SAISON, mistyped))
        # The save correcting the address alone, which files the image holding the mistyped one.
        await patch_one_in_db(
            collection=database[Collection.SAISON_TEAMS],
            db_filter={"_id": CORRECTED_ROW_OID},
            update={"$set": {"kontakte.trainer.email": ERASED_EMAIL}},
            return_document=ReturnDocument.BEFORE,
        )
        await call_erasure(database, client)

        return await log_rows_naming(database, Collection.SAISON_TEAMS, CORRECTED_ROW_OID)

    log = on_a_league(mongo_replica_set_url, body)

    assert len(log) == 2, "the correction and the clearing each file one image"
    assert all((row["before"]["kontakte"]["trainer"], row["redacted_at"]) == (None, REDACTED_AT) for row in log)
    assert MISTYPED_EMAIL not in str(log)


@pytest.mark.db
def test_the_two_people_beside_them_are_untouched(mongo_replica_set_url: str):
    """The over-breadth floor. Kills nulling the whole `kontakte` block, which would destroy two records nobody asked about."""

    _, rows, _ = after_erasure(mongo_replica_set_url)
    kontakte = rows[ROW_A_EARLIER_OID]["kontakte"]

    assert kontakte["ansprechperson"] == LIVE_BLOCKS[ROW_A_EARLIER_OID]["ansprechperson"]
    assert kontakte["stellvertretung"] == LIVE_BLOCKS[ROW_A_EARLIER_OID]["stellvertretung"]
    # Kept through the erasure: it is a fact about the FORM, not about either slot's occupant.
    assert kontakte["trainer_is_also"] is None


@pytest.mark.db
def test_the_rows_naming_nobody_geloescht_are_not_reached(mongo_replica_set_url: str):
    """The other half of the floor. Kills a write that ignores its filter: every case above passes for one that clears both collections."""

    _, rows, _ = after_erasure(mongo_replica_set_url)

    assert rows[ROW_B_OID]["kontakte"] == LIVE_BLOCKS[ROW_B_OID]
    assert rows[OTHER_BEWERBUNG_OID]["kontakte"] == LIVE_BLOCKS[OTHER_BEWERBUNG_OID]


@pytest.mark.db
def test_a_bystanders_earlier_state_survives_with_only_the_geloescht_seat_null(mongo_replica_set_url: str):
    """Restore the whole-image redaction and this fails: the people beside them lose their consent trail.

    The image the seeding's first write filed holds a block that exists in the log alone.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await call_erasure(database, client)

        return await log_rows_naming(database, Collection.SAISON_TEAMS, ROW_A_EARLIER_OID)

    former = FORMER_BLOCKS[ROW_A_EARLIER_OID]
    images = [row["before"] for row in on_a_league(mongo_replica_set_url, body)]
    earlier = [image for image in images if image["kontakte"]["ansprechperson"]["telefon"] == BYSTANDER_FORMER_TELEFON]

    assert len(earlier) == 1, "the seeded history filed no image of the former block"
    earliest = earlier[0]
    assert earliest["kontakte"] == {**former, "trainer": None}
    # The rest of the row's state stands as recorded, the row's own values with it.
    assert (earliest["trikot_farbe"], earliest["saison_id"]) == ("blau", EARLIER_SAISON)


@pytest.mark.db
def test_an_applications_image_loses_the_seats_link_and_the_submission_digest_with_it(mongo_replica_set_url: str):
    """The seat's link and a digest over its details are this person's too; the two links beside it are not."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.BEWERBUNGEN].update_one({"_id": BEWERBUNG_OID}, {"$set": {"idempotency_fingerprint": "digest"}})
        await call_erasure(database, client)

        return await log_rows_naming(database, Collection.BEWERBUNGEN, BEWERBUNG_OID)

    # The clearing's own image, the one filed after the digest was written.
    clearing = [row["before"] for row in on_a_league(mongo_replica_set_url, body) if "idempotency_fingerprint" in row["before"]]

    assert len(clearing) == 1, "no image holding the digest was filed"
    assert clearing[0]["confirmations"] == {**BESTAETIGUNGEN, "ansprechperson": None}
    assert clearing[0]["idempotency_fingerprint"] is None


@pytest.mark.db
def test_a_spelling_handed_in_unfolded_still_clears_and_redacts(mongo_replica_set_url: str):
    """Drop the fold at the erasure's entry and this fails: both callers read rows on the fold, and the variant handed on matches no seat."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        folded = sign_in_identifier(VARIANT_REQUEST_EMAIL)

        async def in_session(session: Any) -> Any:
            reached = {
                collection: await aggregate_many_from_db(
                    collection=database[collection], pipeline=build_erasure_seat_pipeline(folded), session=session
                )
                for collection in (Collection.SAISON_TEAMS, Collection.BEWERBUNGEN)
            }
            return await erase_kontaktperson_in_session(
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                bewerbungen_collection=database[Collection.BEWERBUNGEN],
                action_log_collection=database[Collection.ACTION_LOG],
                spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                identifier=VARIANT_REQUEST_EMAIL,
                key=build_test_config().sperrliste_key,
                saison_team_rows=reached[Collection.SAISON_TEAMS],
                bewerbung_rows=reached[Collection.BEWERBUNGEN],
                stamp=REDACTED_AT,
                session=session,
            )

        async with transaction_session(client) as session:
            cleared = await session.with_transaction(in_session)

        return cleared, await database[Collection.ACTION_LOG].find().to_list(length=None)

    cleared, log = on_a_league(mongo_replica_set_url, body)

    assert cleared.kontakt_slots == sum(EXPECTED_SLOTS.values())
    assert ERASED_EMAIL not in str(log)


@pytest.mark.db
def test_no_value_of_theirs_survives_anywhere_in_the_database(mongo_replica_set_url: str):
    """The whole database swept as text, not the rows a filter named. Kills a redaction narrowed to some of them.

    A bystander's replaced number is asserted present, without which a database emptied wholesale
    would pass.
    """

    _, rows, log = after_erasure(mongo_replica_set_url)
    rendered = str(log) + str(sorted(rows.items(), key=lambda pair: str(pair[0])))
    theirs = (ERASED_EMAIL, ERASED_TELEFON, ERASED_FORMER_TELEFON, ERASED_NACHNAME)

    assert [value for value in theirs if value in rendered] == []
    assert BYSTANDER_FORMER_TELEFON in rendered, "the sweep would pass over a database emptied wholesale"
    assert UNREACHED_FORMER_TELEFON in rendered


@pytest.mark.db
def test_the_log_rows_of_a_row_nobody_geloescht_keep_their_images(mongo_replica_set_url: str):
    """Kills a filter matching on `collection` alone, which would empty every club's rows at once."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await call_erasure(database, client)

        return (
            await log_rows_naming(database, Collection.SAISON_TEAMS, ROW_B_OID),
            await log_rows_naming(database, Collection.BEWERBUNGEN, OTHER_BEWERBUNG_OID),
        )

    for rows in on_a_league(mongo_replica_set_url, body):
        assert [row for row in rows if row["before"] is not None], "an untouched row's log images were emptied too"
        assert all(row["redacted_at"] is None for row in rows)


@pytest.mark.db
def test_an_address_naming_nobody_is_a_clean_no_op(mongo_replica_set_url: str):
    """Kills a redaction overwriting what the fold never judged: an address naming nobody stamps no row."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        before_count = await database[Collection.ACTION_LOG].count_documents({})
        response = await call_erasure(database, client, UNKNOWN_EMAIL)

        return (
            response,
            await stored_rows(database),
            before_count,
            await database[Collection.ACTION_LOG].count_documents({}),
            await database[Collection.ACTION_LOG].count_documents({"redacted_at": {"$ne": None}}),
        )

    response, rows, before_count, after_count, stamped = on_a_league(mongo_replica_set_url, body)

    assert response.kontakt_seats == 0
    assert all(rows[row_id]["kontakte"] == LIVE_BLOCKS[row_id] for row_id in (*SAISON_TEAM_OIDS, *BEWERBUNG_OIDS))
    # No clearing patch ran, and the redaction records nothing about itself, so the log is untouched.
    assert (after_count, stamped) == (before_count, 0)


@pytest.mark.db
def test_a_refused_redaction_takes_every_clearing_back(mongo_replica_set_url: str):
    """Kills running the writes outside one transaction, and dropping the session from any of them.

    A `$jsonSchema` refusing a stamped row fails the LAST write, once both collections are cleared.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        # Narrow enough to refuse the redaction's `$set`, wide enough to admit the clearing patches'
        # own rows, which are recorded with `redacted_at` null.
        await database.command(
            "collMod",
            Collection.ACTION_LOG.value,
            validator={"$jsonSchema": {"bsonType": "object", "properties": {"redacted_at": {"bsonType": "null"}}}},
            validationLevel="strict",
        )

        with pytest.raises(OperationFailure) as failure:
            await call_erasure(database, client)

        return failure.value.code, await stored_rows(database), await log_rows_naming(database, Collection.SAISON_TEAMS, ROW_A_EARLIER_OID)

    code, rows, log = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

    # Asserted on the code, so this cannot pass because something else failed before any write.
    assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the redaction, got code {code}"
    assert all(rows[row_id]["kontakte"] == LIVE_BLOCKS[row_id] for row_id in EXPECTED_SLOTS), "a clearing outlived a redaction that failed"
    assert [row for row in log if row["before"] is not None], "the log lost its image to a transaction that never committed"
    assert all(row["redacted_at"] is None for row in log)


@pytest.mark.db
def test_an_address_asked_unfolded_clears_its_stored_fold_and_no_near_miss(mongo_replica_set_url: str):
    """Another mailbox keeps its seat and adds nothing to the count; the asked spelling's fold is what meets the stored one."""

    response, rows = after_loeschen_the_near_misses(mongo_replica_set_url)
    cleared = [email for email, row_id in NEAR_ROW_OIDS.items() if rows[row_id]["kontakte"]["trainer"] is None]

    assert cleared == [], "the match reached an address that is not this person"
    assert rows[MATCHED_ROW_OID]["kontakte"]["trainer"] is None, "the unfolded request missed the stored fold"
    assert response.kontakt_seats == sum(EXPECTED_SLOTS.values()) + 1, "the read reached a seat that is somebody else's"


# An identifier holding no `@`: the spellings the fold claims, and a value each anchor keeps out, the end two of them
# and the start one.
NO_AT_IDENTIFIER = "no-at"
NO_AT_CLAIMED: tuple[str, ...] = (NO_AT_IDENTIFIER, "NO-AT", f"{chr(0x20)}no-at{chr(0xA0)}")
NO_AT_UNCLAIMED: tuple[str, ...] = ("kein-atx", "kein-at@example.com", "xkein-at")


# A stored address carrying what the fold trims, the start and the end each: the pattern has to
# take every value the fold would claim. Built from code points, since both are whitespace.
PADDED_SPELLINGS: tuple[str, ...] = (f"{chr(0x20)}{ERASED_EMAIL}", f"{ERASED_EMAIL}{chr(0xA0)}")


@pytest.mark.parametrize(
    ("asked", "taken", "missed"),
    [
        pytest.param(VARIANT_REQUEST_EMAIL, (*CASE_VARIANTS, *PADDED_SPELLINGS), NEAR_MISSES, id="one spelling"),
        # Both ends are anchored; one anchor alone takes the start's or the end's near miss.
        pytest.param(NO_AT_IDENTIFIER, NO_AT_CLAIMED, NO_AT_UNCLAIMED, id="no @"),
        pytest.param("@x.de", ("@x.de", "@X.DE"), ("x@x.de", "@x.dex"), id="an empty local part"),
        # Padded or blank as stored, which a pattern built off that spelling reads less of than its fold claims.
        pytest.param(
            f"{chr(0x20)}{VARIANT_REQUEST_EMAIL}{chr(0xA0)}", (*CASE_VARIANTS, *PADDED_SPELLINGS), OTHER_LOCAL_PARTS, id="a padded spelling"
        ),
        pytest.param(chr(0x20) * 3, ("", chr(0x20), chr(0xA0)), ("x",), id="a blank"),
    ],
)
def test_the_pattern_takes_every_spelling_the_fold_claims_and_no_other_address(asked: str, taken: tuple[str, ...], missed: tuple[str, ...]):
    """Python's `re` stands in for the server's engine, the two agreeing on an escaped literal compared in ASCII.

    Each spelling taken is first held to the fold's claim, so the case never asks the pattern for more.
    """

    identifier = sign_in_identifier(asked)
    # As asked, never its fold: a caller may hand on a stored value unfolded, which the pattern folds itself.
    pattern = same_address(asked)
    matches = re.compile(pattern["$regex"], re.IGNORECASE if pattern["$options"] == "i" else 0).search

    assert [email for email in taken if sign_in_identifier(email) != identifier] == []
    assert [email for email in taken if not matches(email)] == []
    assert [email for email in missed if matches(email)] == []


# What a stored address may hold, as a hand-typed or older row may: blanks the fold trims, regex
# metacharacters, a NUL, case partners outside ASCII, and near misses of each identifier below. Built from code points.
SERVER_CORPUS: tuple[str, ...] = (
    *("", chr(0x20), chr(0x20) * 3, chr(0xA0), f"{chr(0x20)}{chr(0xA0)}{chr(0x09)}", chr(0x3000), chr(0xFEFF), chr(0x85)),
    *(f"{chr(0xFEFF)}no-at{chr(0x3000)}", f"{chr(0x85)}no-at", *NO_AT_CLAIMED, *NO_AT_UNCLAIMED),
    *("kein-at@", "KEIN-AT@", f"{chr(0x20)}kein-at@{chr(0xA0)}", "kein-at@@", "kein-at@x@y"),
    *("a@b@c", "A@B@C", f"{chr(0x20)}a@b@C{chr(0xA0)}", "a@b@cx", "a@b@x.de", "a@bx@c"),
    *("@x.de", f"@{chr(0xFF58)}.de", "@X.DE", "x@x.de", "@", "@@"),
    *("someone@example.org", f"{chr(0x017F)}omeone@example.org", f"{chr(0x212A)}im@example.org", "kim@example.org"),
    *("a.b@x.de", "axb@x.de", "a+b@x.de", "aab@x.de", "a(b)@x.de", "a\\b@x.de", "a[b]@x.de", "a$b@x.de", "a^b@x.de"),
    *("a|b@x.de", "a{2}@x.de", "aa@x.de", "a?b@x.de", "a*b@x.de", "ab@x.de", "b@x.de", "a\x00b@x.de"),
    *("wiltrudis.quastenflosser@example.com", "Wiltrudis.Quastenflosser@EXAMPLE.COM", "wiltrudisXquastenflosser@example.com"),
)
SERVER_IDENTIFIERS: tuple[str, ...] = (
    *(NO_AT_IDENTIFIER, "kein-at@", "KEIN-AT@", "a@b@c", chr(0x20) * 3, "", f"{chr(0xA0)}{chr(0x09)}", "@x.de", "@", "@@"),
    *("someone@example.org", "kim@example.org", "a.b@x.de", "a+b@x.de", "a(b)@x.de", "a\\b@x.de", "a[b]@x.de", "a$b@x.de"),
    *("a^b@x.de", "a|b@x.de", "a{2}@x.de", "a?b@x.de", "a*b@x.de", "a\x00b@x.de", "Wiltrudis.Quastenflosser@EXAMPLE.COM"),
)


@pytest.mark.db
def test_the_server_reads_each_pattern_as_python_does_and_misses_nothing_the_fold_claims(mongo_replica_set_url: str):
    """The case above's `re` held to the server's own engine, which reads `\\s` as ASCII alone: a no-break space it would miss."""

    row_ids = {value: ObjectId(f"6890a1b2c3d4e5f60783{index:04d}") for index, value in enumerate(SERVER_CORPUS)}

    async def body(database: AsyncDatabase, _: AsyncMongoClient) -> dict[str, set[ObjectId]]:
        await database[Collection.SAISON_TEAMS].insert_many(
            [a_row_naming(row_id, value) for value, row_id in row_ids.items()], bypass_document_validation=True
        )
        read: dict[str, set[ObjectId]] = {}
        for identifier in SERVER_IDENTIFIERS:
            # Any stored string serves the pattern: the grant erasure it reads for asks it of `berechtigungen.address`.
            pipeline = [{"$match": {"kontakte.trainer.email": same_address(identifier)}}]
            read[identifier] = {row["_id"] for row in await (await database[Collection.SAISON_TEAMS].aggregate(pipeline)).to_list()}

        return read

    read = on_a_league(mongo_replica_set_url, body)
    parted: dict[str, Any] = {}
    for identifier in SERVER_IDENTIFIERS:
        pattern = same_address(identifier)
        python = {value for value in SERVER_CORPUS if re.search(pattern["$regex"], value, re.IGNORECASE if pattern["$options"] == "i" else 0)}
        server = {value for value, row_id in row_ids.items() if row_id in read[identifier]}
        claimed = {value for value in SERVER_CORPUS if sign_in_identifier(value) == sign_in_identifier(identifier)}
        # The fold equates the value whole, so an ASCII read is the claim exactly: an end left open reads a near miss. A
        # case partner outside ASCII is the `i` flag's, which the fold then decides.
        unclaimed = {value for value in server - claimed if value.isascii()}
        # The last, a whole-collection read for an identifier naming anything, is a pattern that takes nothing out.
        if server != python or claimed - server or unclaimed or (identifier.strip() and server == set(SERVER_CORPUS)):
            parted[identifier] = {
                "server alone": server - python,
                "python alone": python - server,
                "claimed and missed": claimed - server,
                "read and unclaimed": unclaimed,
            }

    assert parted == {}


class TestTheSeatJudgesReadWhateverAnImageHolds:
    """A log image is whatever its row held when the write ran; the pure half, apart from a database."""

    def test_a_name_reaches_no_document_but_the_one_whose_images_seat_it_at_their_address(self):
        """A namesake elsewhere is somebody else; the one-address rule's reach is the whole log, a name's one document."""

        named = {"vorname": "Klara", "nachname": "Musterfrau"}
        theirs = {"_id": BEWERBUNG_OID, "kontakte": {"stellvertretung": {**named, "email": "klara@example.com"}}}
        namesake = {"_id": OTHER_BEWERBUNG_OID, "kontakte": {"stellvertretung": {**named, "email": "klara@example.org"}}}

        assert departing_names([{"before": theirs}, {"before": [namesake]}], {"klara@example.com"}) == {
            BEWERBUNG_OID: frozenset({("klara", "musterfrau")})
        }

    def test_a_seat_holding_no_name_lends_none_to_match_by(self):
        """Match a blank name and every other unnamed seat of the document goes with theirs."""

        unnamed = {"vorname": "", "nachname": ""}
        image = {
            "_id": BEWERBUNG_OID,
            "kontakte": {"trainer": {**unnamed, "email": "x@example.com"}, "ansprechperson": {**unnamed, "email": "y@example.com"}},
        }
        assert departing_names([{"before": image}], {"x@example.com"}) == {}
        # Handed a blank name all the same, the judge still matches no unnamed seat by it.
        assert seat_image_edits(image, ("x@example.com",), links=False, names={("", "")}) == {"kontakte.trainer": None}


# Two domains to the sign-in fold, so two people an application may seat side by side.
SHARP_S_EMAIL = "wiltrudis.quastenflosser@straße.de"
DOUBLE_S_EMAIL = "wiltrudis.quastenflosser@strasse.de"
SHARP_S_ROW_OID = ObjectId("6890a1b2c3d4e5f607816001")

HAND_EDITED_ROW_OID = ObjectId("6890a1b2c3d4e5f607816002")


@pytest.mark.db
def test_loeschen_one_of_two_people_parted_by_sharp_s_leaves_the_other_seated(mongo_replica_set_url: str):
    """A fold wider than sign-in's clears the second person's seat on the first person's request."""

    block = {
        **a_block_holding({**person(UNREACHED_NACHNAME, UNREACHED_TELEFON), "email": SHARP_S_EMAIL}),
        "ansprechperson": {**person(BYSTANDER_NACHNAME, BYSTANDER_TELEFON), "email": DOUBLE_S_EMAIL},
    }

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SAISON_TEAMS].insert_one(a_junction_row(SHARP_S_ROW_OID, LATER_SAISON, block))
        await call_erasure(database, client, DOUBLE_S_EMAIL)

        return (await stored_rows(database))[SHARP_S_ROW_OID]["kontakte"]

    kontakte = on_a_league(mongo_replica_set_url, body)

    assert (kontakte["trainer"] is not None, kontakte["ansprechperson"]) == (True, None)


@pytest.mark.db
@pytest.mark.parametrize(
    "stored",
    [
        pytest.param("jürgen@schule.de", id="an umlaut in the local part"),
        # Built from its code point: it renders like the ASCII stop.
        pytest.param(f"anna{chr(0xFF0E)}@schule.de", id="a full-width stop in the local part"),
        pytest.param("anna..mueller@schule.de", id="an address the installed EmailStr refuses"),
    ],
)
def test_a_seat_stored_under_an_address_no_payload_takes_now_is_geloescht(mongo_replica_set_url: str, stored: str):
    """GDPR Art. 17: a row edited by hand past the address rule still names a person, so the lookup holds the request to no rule."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SAISON_TEAMS].insert_one(a_row_naming(HAND_EDITED_ROW_OID, stored))
        await call_erasure(database, client, stored)

        return (await stored_rows(database))[HAND_EDITED_ROW_OID]["kontakte"]["trainer"]

    assert on_a_league(mongo_replica_set_url, body) is None


@pytest.mark.db
def test_no_value_of_a_swapped_out_person_survives_anywhere(mongo_replica_set_url: str):
    """The sweep over the audited case, with a bystander's own pre-image as its floor."""

    _, rows, log = after_loeschen_a_swapped_out_person(mongo_replica_set_url)
    rendered = str(log) + str(sorted(rows.items(), key=lambda pair: str(pair[0])))

    theirs = (ERASED_EMAIL, ERASED_FORMER_TELEFON, ERASED_NACHNAME)

    assert [value for value in theirs if value in rendered] == []
    assert BYSTANDER_FORMER_TELEFON in rendered, "an unrelated row's pre-image was emptied as collateral"


# An application this person did NOT stand in until a later write put them there. Its own row, so
# the counts every case above asserts are untouched.
LATECOMER_BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607810023")


@pytest.mark.db
def test_an_image_of_their_application_naming_only_other_people_stays_as_recorded(mongo_replica_set_url: str):
    """Restore the redaction by document and this fails: the write that put them into the application filed an image of somebody else."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        application = database[Collection.BEWERBUNGEN]
        # Seeded holding nobody the erasure may reach, then patched to a block that names them: the
        # image that write filed is the one carrying no address of theirs.
        await application.insert_one({**bewerbung_document(OTHER_BEWERBUNG_OID, TEAM_B_OID), "_id": LATECOMER_BEWERBUNG_OID})
        await patch_one_in_db(
            collection=application,
            db_filter={"_id": LATECOMER_BEWERBUNG_OID},
            update={"$set": {"kontakte": LIVE_BLOCKS[BEWERBUNG_OID]}},
            return_document=ReturnDocument.BEFORE,
        )

        introducing = await log_rows_naming(database, Collection.BEWERBUNGEN, LATECOMER_BEWERBUNG_OID)
        response = await call_erasure(database, client)

        return introducing, response, await log_rows_naming(database, Collection.BEWERBUNGEN, LATECOMER_BEWERBUNG_OID)

    introducing, response, rows = on_a_league(mongo_replica_set_url, body)

    # The floor: the pre-image this case rests on must name somebody else and not this person, or
    # it would be theirs to lose.
    assert len(introducing) == 1
    assert ERASED_EMAIL not in str(introducing[0]["before"]), "the seeded image already names them"

    assert response.kontakt_seats == sum(EXPECTED_SLOTS.values()) + 1, "the application this case adds was not reached at all"
    kept = next(row for row in rows if row["_id"] == introducing[0]["_id"])
    assert (kept["before"], kept["redacted_at"]) == (introducing[0]["before"], None)
    # The clearing patch the erasure itself filed holds them, and loses their seat alone.
    (clearing,) = [row for row in rows if row["_id"] != introducing[0]["_id"]]
    assert (clearing["before"]["kontakte"]["ansprechperson"], clearing["redacted_at"]) == (None, REDACTED_AT)


# Two colleagues on ONE school mailbox, a season apart -- the case the confirmation exists for. The
# panel it is opened from names one of them, and the write empties both seats.
SHARED_INBOX = "sekretariat.quastenflosser@example.com"
SHARED_EARLIER_OID = ObjectId("6890a1b2c3d4e5f607816004")
SHARED_LATER_OID = ObjectId("6890a1b2c3d4e5f607816005")


def sharing_the_inbox(nachname: str, telefon: str) -> dict[str, Any]:
    return {**person(nachname, telefon), "email": SHARED_INBOX}


def after_revealing_a_shared_inbox(url: str) -> FLErasureViewResponse:
    """Its own league rather than the seeded one, whose people each hold an address nobody else does."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    a_junction_row(SHARED_EARLIER_OID, EARLIER_SAISON, a_block_holding(sharing_the_inbox(ERASED_NACHNAME, ERASED_TELEFON))),
                    a_junction_row(SHARED_LATER_OID, LATER_SAISON, a_block_holding(sharing_the_inbox(BYSTANDER_NACHNAME, BYSTANDER_TELEFON))),
                ]
            )

            return await call_ansicht(database, client, SHARED_INBOX)

    return on_the_seed_loop(_run())


@pytest.mark.db
def test_both_colleagues_on_one_shared_inbox_are_named(mongo_replica_set_url: str):
    """Kills a reveal answering for the seat it was opened from: two PEOPLE hold this address, one season apart."""

    view = after_revealing_a_shared_inbox(mongo_replica_set_url)

    assert [(seat.nachname, seat.saison_id) for seat in view.seats] == [
        (ERASED_NACHNAME, EARLIER_SAISON),
        (BYSTANDER_NACHNAME, LATER_SAISON),
    ]
    assert view.bewerbungen == []


@pytest.mark.db
def test_the_reveal_lists_exactly_the_seats_the_loeschung_then_clears(mongo_replica_set_url: str):
    """What one matcher buys: a confirmation naming a different set from the one the write reaches is worse than none."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        return await call_ansicht(database, client), await call_erasure(database, client)

    view, response = on_a_league(mongo_replica_set_url, body)
    named = len(view.seats) + len(view.bewerbungen)

    # Against the table above as well as the count: two figures agreeing on zero agree on nothing.
    assert named == sum(EXPECTED_SLOTS.values())
    assert named == response.kontakt_seats


def a_fixture_of(team_id: ObjectId, *, saison_id: str = LATER_SAISON, spiel_nr: int = 1) -> dict[str, Any]:
    """A fixture of this team's, never stored: a confirmation row is composed from it as the mint composes one."""

    side = {"team_id": team_id, "name": "Adler", "shorthand": "ADX", "tore": None}

    return documents.spiel_document(
        spiel_id=ObjectId(),
        saison_id=saison_id,
        spiel_nr=spiel_nr,
        spieltag_id=None,
        datum="2026-04-18",
        uhrzeit="14:00:00",
        team1=side,
        team2=side,
    )


def a_reason_of_theirs(saison_id: str = LATER_SAISON) -> dict[str, Any]:
    """A row the erased person declined with a reason, closed since; no seat they hold now need be the one it was typed from."""

    return documents.spielbestaetigung_document(
        a_fixture_of(TEAM_A_OID, saison_id=saison_id),
        party={"art": "team", "team_id": TEAM_A_OID},
        antwort=documents.kontakt_antwort_document("trainer", ERASED_EMAIL, begruendung="Wir sind auf Klassenfahrt"),
        closed={"at": "2026-04-02", "grund": "ansetzung_changed"},
    )


THEIR_HALTER = halter_of(ERASED_EMAIL, key=build_test_config().sperrliste_key)


@pytest.mark.db
def test_the_reason_steps_log_row_names_no_digest_of_theirs(mongo_replica_set_url: str):
    """The log keeps a fan-out's filter as text for twelve months, so the step's write names their rows by id alone."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SPIELBESTAETIGUNGEN].insert_many([a_reason_of_theirs(), a_reason_of_theirs()])
        await call_erasure(database, client)

        return (
            await database[Collection.SPIELBESTAETIGUNGEN].find({}, {"antwort": 1}).to_list(length=None),
            await database[Collection.ACTION_LOG].find({}).to_list(length=None),
        )

    stored, log = on_a_league(mongo_replica_set_url, body)

    # The premise: the step wrote both rows, and logged doing so.
    assert [row["antwort"]["begruendung"] for row in stored] == [None, None]
    assert [row["modified_count"] for row in log if row["collection"] == Collection.SPIELBESTAETIGUNGEN] == [2]
    assert THEIR_HALTER not in str(log)
