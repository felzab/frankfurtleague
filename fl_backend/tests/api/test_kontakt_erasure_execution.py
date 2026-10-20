import re
import unicodedata
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pydantic import TypeAdapter
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.bewerbungen.services import compose_bestaetigungen, hash_token
from app.api.identitaet.schemas import FLErasureAnsichtResponse, FLErasureResponse
from app.api.identitaet.services import build_erasure_seat_pipeline
from app.api.kontakte.crud import erase_kontaktperson_in_session
from app.api.kontakte.services import (
    build_clearing_update,
    contact_block_image_edits,
    departing_names,
    find_matching_slots,
    same_address,
    seat_image_edits,
)
from app.api.spielbestaetigungen.services import halter_of
from app.api.teams.schemas import KONTAKT_ROLLEN, FLSaisonTeamKontakte
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, delete_many_from_db, patch_one_in_db
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier
from app.shared.schemas.kontakt import CustomEmail
from tests import documents
from tests.config import build_test_config
from tests.database import DOCUMENT_VALIDATION_FAILED, a_clean_database, on_the_seed_loop
from tests.documents import bestaetigte_kenntnisnahme
from tests.erasure import erased
from tests.plans import plans_of_sent_reads
from tests.wire import commands_sent
from tests.worker import worker_database

from .test_erasure_auf_anfrage import revealed

DATABASE_NAME = worker_database("fl_kontakt_erasure_test")


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
    # The same person a season later, and in TWO slots: `trainer_ist_zugleich` stores one
    # person twice, so clearing the first alone would leave this block naming them.
    ROW_A_LATER_OID: ((ERASED_NACHNAME, ERASED_NACHNAME, BYSTANDER_NACHNAME), "ansprechperson"),
    # Nobody the erasure may reach.
    ROW_B_OID: ((UNREACHED_NACHNAME, BYSTANDER_NACHNAME, UNREACHED_NACHNAME), None),
    # The second store this branch adds, with the person in a different slot than on the junction.
    BEWERBUNG_OID: ((BYSTANDER_NACHNAME, ERASED_NACHNAME, UNREACHED_NACHNAME), None),
    OTHER_BEWERBUNG_OID: ((UNREACHED_NACHNAME, BYSTANDER_NACHNAME, UNREACHED_NACHNAME), None),
}


def person(nachname: str, telefon: str) -> dict[str, Any]:
    """Every field `app/core/constraints.py :: _KONTAKTPERSON` requires, all six of them present."""

    email, _, _ = PEOPLE[nachname]

    return {
        "vorname": "Vor" + nachname[:4],
        "nachname": nachname,
        "email": email,
        "telefon": telefon,
        "geburtsdatum": "1979-03-14",
        "einwilligung": bestaetigte_kenntnisnahme(datum="2026-01-05"),
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
            "trainer_ist_zugleich": zugleich,
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

# Two writes seed each row's history and the clearing patch files a third, so every reached row owes
# the redaction three log rows.
LOG_ROWS_PER_REACHED_ROW = 3


def saison_team_document(row_id: ObjectId, saison_id: str, team_id: ObjectId) -> dict[str, Any]:
    return documents.saison_team_document(
        saison_id, team_id, "Testschule", "TS", _id=row_id, trikot_farbe="blau", kontakte=FORMER_BLOCKS[row_id]
    )


# The three live links every seeded application carries, so an erasure has bookkeeping to reach.
# Minted as the shared application builder mints them, from this prefix on the submission's day.
LINK_PREFIX = "link"
BESTAETIGUNGEN = compose_bestaetigungen(hashes={slot: hash_token(f"{LINK_PREFIX}-{slot}") for slot in KONTAKT_ROLLEN}, today="2026-01-05")


def bewerbung_document(row_id: ObjectId, team_id: ObjectId) -> dict[str, Any]:
    """The same, for `Collection.BEWERBUNGEN`, whose `kontakte` is a REQUIRED, non-nullable block."""

    return documents.bewerbung_document(
        row_id,
        LATER_SAISON,
        "eingereicht",
        kontakte=FORMER_BLOCKS[row_id],
        eingereicht_am="2026-01-05",
        bestaetigungsfrist="2026-01-19",
        team_id=team_id,
        link_prefix=LINK_PREFIX,
        kader={"voraussichtliche_groesse": 12, "gute_spieler": 3},
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
        collection=collection, db_filter={"_id": row_id}, update={"$set": {"kader.gute_spieler": 4}}, return_document=ReturnDocument.BEFORE
    )


def on_a_league(url: str, body: Body, *, mutates_schema: bool = False) -> Any:
    """The REAL validators and support indexes, so a namespace a transaction cannot create is there.

    `mutates_schema=True` where the body narrows one of those validators (`tests/database.py :: a_clean_database`).
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


async def call_ansicht(database: AsyncDatabase, client: AsyncMongoClient, email: str = ERASED_EMAIL) -> FLErasureAnsichtResponse:
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

    rows = database[Collection.AKTIONEN].find({"collection": str(collection), "document_id": row_id})

    return await rows.to_list(length=None)


def a_block_holding(trainer: Mapping[str, Any]) -> dict[str, Any]:
    """One person in the Trainer slot, the other two empty, all four keys present."""

    return {**{slot: None for slot in KONTAKT_ROLLEN}, "trainer": dict(trainer), "trainer_ist_zugleich": None}


def a_junction_row(row_id: ObjectId, saison_id: str, block: Mapping[str, Any]) -> dict[str, Any]:
    """A valid `saison_teams` row carrying exactly this block, its own id standing in as `team_id`.

    Which is what lets a case seed as many rows as it likes under `uniq_saison_id_team_id`.
    """

    return documents.saison_team_document(saison_id, row_id, "Testschule", "TS", _id=row_id, trikot_farbe="blau", kontakte=dict(block))


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


def after_erasing_a_swapped_out_person(url: str) -> Snapshot:
    """A league where the erasure runs against rows that no longer name the person it is given."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await a_swap_moves_them_out(database)
            response = await call_erasure(database, client)
            log = await database[Collection.AKTIONEN].find().sort("_id", 1).to_list(length=None)

            return response, await stored_rows(database), log

    return on_the_seed_loop(_run())


def after_erasing_the_near_misses(url: str) -> tuple[FLErasureResponse, dict[Any, Mapping[str, Any]]]:
    """The seeded league plus the stored mailbox and its near misses, erased with an unfolded spelling of the mailbox."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SAISON_TEAMS].insert_many(
            [a_row_naming(row_id, email) for email, row_id in ((ERASED_EMAIL, MATCHED_ROW_OID), *NEAR_ROW_OIDS.items())]
        )
        response = await call_erasure(database, client, VARIANT_REQUEST_EMAIL)

        return response, await stored_rows(database)

    return on_a_league(url, body)


def after_erasing(url: str, email: str = ERASED_EMAIL) -> Snapshot:
    """The counts, both collections and the whole log together: one seeded database serves all three."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        response = await call_erasure(database, client, email)
        log = await database[Collection.AKTIONEN].find().sort("_id", 1).to_list(length=None)

        return response, await stored_rows(database), log

    return on_a_league(url, body)


class TestTheSlotsAreReadOffTheModel:
    """The spelling the write turns on, apart from a database."""

    def test_the_person_valued_slots_are_the_three_roles(self):
        assert KONTAKT_ROLLEN == ("trainer", "ansprechperson", "stellvertretung")

    def test_every_slot_the_model_declares_is_covered(self):
        """A role added to the block alone is cleared by nothing, and one added out of order is listed out of it."""

        declared = tuple(name for name in FLSaisonTeamKontakte.model_fields if name != "trainer_ist_zugleich")

        assert declared == KONTAKT_ROLLEN

    def test_a_block_with_every_slot_empty_still_validates(self):
        """The read model is what a junction row is served through, so a slot that stopped being nullable is a 500."""

        cleared = FLSaisonTeamKontakte.model_validate({**{slot: None for slot in KONTAKT_ROLLEN}, "trainer_ist_zugleich": "ansprechperson"})

        assert (cleared.trainer, cleared.ansprechperson, cleared.stellvertretung) == (None, None, None)


@pytest.mark.db
def test_the_matching_slot_is_nulled_in_every_season(mongo_replica_set_url: str):
    """The case the endpoint exists for. Kills scoping the erasure to one row, and a transaction that never commits."""

    _, rows, _ = after_erasing(mongo_replica_set_url)

    assert rows[ROW_A_EARLIER_OID]["kontakte"]["trainer"] is None
    assert rows[ROW_A_LATER_OID]["kontakte"]["trainer"] is None


@pytest.mark.db
def test_one_person_in_two_slots_of_one_row_loses_both(mongo_replica_set_url: str):
    """Kills stopping at the first match: `trainer_ist_zugleich` stores one person twice."""

    _, rows, _ = after_erasing(mongo_replica_set_url)
    kontakte = rows[ROW_A_LATER_OID]["kontakte"]

    assert (kontakte["trainer"], kontakte["ansprechperson"]) == (None, None)


@pytest.mark.db
def test_the_application_is_cleared_as_well_as_the_junction(mongo_replica_set_url: str):
    """Kills an erasure reaching one store: this branch adds a SECOND copy of the same three people."""

    _, rows, _ = after_erasing(mongo_replica_set_url)

    assert rows[BEWERBUNG_OID]["kontakte"]["ansprechperson"] is None


@pytest.mark.db
def test_the_erased_seats_link_goes_with_the_person_and_no_other_seats_does(mongo_replica_set_url: str):
    """Kills an erasure stopping at `kontakte`: a live link would outlive the person and confirm a slot naming nobody."""

    _, rows, _ = after_erasing(mongo_replica_set_url)
    block = rows[BEWERBUNG_OID]["bestaetigungen"]

    assert block["ansprechperson"] is None
    assert block["trainer"] == BESTAETIGUNGEN["trainer"]
    assert block["stellvertretung"] == BESTAETIGUNGEN["stellvertretung"]
    assert rows[OTHER_BEWERBUNG_OID]["bestaetigungen"] == BESTAETIGUNGEN


@pytest.mark.db
def test_a_junction_row_gains_no_bookkeeping_block(mongo_replica_set_url: str):
    """Kills a clearing that nulls the seat's bookkeeping unconditionally: a dotted `$set` into an absent block creates one."""

    _, rows, _ = after_erasing(mongo_replica_set_url)

    assert all("bestaetigungen" not in rows[row_id] for row_id in SAISON_TEAM_OIDS)


def test_the_clearing_names_the_bookkeeping_only_where_told_to_and_the_digest_always():
    """The pure half: a season row holding no block gets no key created.

    The digest goes either way: an `$unset` creates nothing.
    """

    assert build_clearing_update(("trainer",)) == {"$set": {"kontakte.trainer": None}, "$unset": {"idempotenz_fingerabdruck": ""}}
    assert build_clearing_update(("trainer",), bestaetigungen=True) == {
        "$set": {"kontakte.trainer": None, "bestaetigungen.trainer": None},
        "$unset": {"idempotenz_fingerabdruck": ""},
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

    _, rows, _ = after_erasing(mongo_replica_set_url)
    kontakte = rows[ROW_A_EARLIER_OID]["kontakte"]

    assert kontakte["ansprechperson"] == LIVE_BLOCKS[ROW_A_EARLIER_OID]["ansprechperson"]
    assert kontakte["stellvertretung"] == LIVE_BLOCKS[ROW_A_EARLIER_OID]["stellvertretung"]
    # Kept through the erasure: it is a fact about the FORM, not about either slot's occupant.
    assert kontakte["trainer_ist_zugleich"] is None


@pytest.mark.db
def test_the_rows_naming_nobody_erased_are_not_reached(mongo_replica_set_url: str):
    """The other half of the floor. Kills a write that ignores its filter: every case above passes for one that clears both collections."""

    _, rows, _ = after_erasing(mongo_replica_set_url)

    assert rows[ROW_B_OID]["kontakte"] == LIVE_BLOCKS[ROW_B_OID]
    assert rows[OTHER_BEWERBUNG_OID]["kontakte"] == LIVE_BLOCKS[OTHER_BEWERBUNG_OID]


@pytest.mark.db
def test_the_block_survives_with_all_four_of_its_keys(mongo_replica_set_url: str):
    """Kills clearing by `$unset`, which satisfies the cases above on a database without the validator."""

    _, rows, _ = after_erasing(mongo_replica_set_url)

    for row_id in EXPECTED_SLOTS:
        assert set(rows[row_id]["kontakte"]) == {*KONTAKT_ROLLEN, "trainer_ist_zugleich"}, f"{row_id} lost a key"


@pytest.mark.db
def test_nulling_an_applications_whole_block_is_what_the_validator_refuses(mongo_replica_set_url: str):
    """Without this the dotted keys read as style. `bewerbungen.kontakte` is required and non-nullable as a BLOCK."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
        try:
            await database[Collection.BEWERBUNGEN].update_one({"_id": BEWERBUNG_OID}, {"$set": {"kontakte": None}})
        except OperationFailure as failure:
            assert failure.code == DOCUMENT_VALIDATION_FAILED, f"expected a validation failure, got {failure.code}: {failure}"
            return "rejected"
        return "accepted"

    assert on_a_league(mongo_replica_set_url, body) == "rejected"


@pytest.mark.db
def test_the_echo_reports_counts_and_names_nobody(mongo_replica_set_url: str):
    """Kills echoing the person: a response repeating the address hands back exactly what was destroyed."""

    response, _, _ = after_erasing(mongo_replica_set_url)
    rendered = response.model_dump_json()

    assert response.kontakt_sitze == sum(EXPECTED_SLOTS.values())
    assert ERASED_EMAIL not in rendered and ERASED_NACHNAME not in rendered


@pytest.mark.db
def test_every_image_of_a_reached_document_loses_their_seat_and_is_stamped(mongo_replica_set_url: str):
    """Kills dropping the redaction, one that stamps without clearing, and one that clears without stamping."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        seeded = await log_rows_naming(database, Collection.SAISON_TEAMS, ROW_A_EARLIER_OID)
        await call_erasure(database, client)

        return seeded, await log_rows_naming(database, Collection.SAISON_TEAMS, ROW_A_EARLIER_OID)

    seeded, rows = on_a_league(mongo_replica_set_url, body)

    # The pre-state, without which a filter matching nothing would pass.
    assert [row for row in seeded if row["before"]["kontakte"]["trainer"] is not None], "the seeded log held no image to redact"
    assert len(rows) > len(seeded), "the erasure's own patch recorded no row"
    assert [row["before"]["kontakte"]["trainer"] for row in rows] == [None] * len(rows)
    assert {row["redacted_at"] for row in rows} == {REDACTED_AT}


@pytest.mark.db
def test_a_bystanders_earlier_state_survives_with_only_the_erased_seat_null(mongo_replica_set_url: str):
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
def test_the_row_the_erasures_own_patch_wrote_loses_both_seats_and_keeps_the_third(mongo_replica_set_url: str):
    """Kills redacting BEFORE the clearing: each clearing patch files a pre-image of the block still holding this person.

    Kills `patch_many_in_db` for the clearing too: that helper records no `document_id`, so its row
    would not be found here.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        seeded = {row["_id"] for row in await log_rows_naming(database, Collection.SAISON_TEAMS, ROW_A_LATER_OID)}
        await call_erasure(database, client)
        rows = await log_rows_naming(database, Collection.SAISON_TEAMS, ROW_A_LATER_OID)

        return seeded, [row for row in rows if row["_id"] not in seeded]

    seeded, added = on_a_league(mongo_replica_set_url, body)

    assert seeded, "the seeded history left no row to tell the new one from"
    assert len(added) == 1, "the clearing wrote no addressable log row of its own"
    assert added[0]["before"]["kontakte"] == {**LIVE_BLOCKS[ROW_A_LATER_OID], "trainer": None, "ansprechperson": None}
    assert added[0]["redacted_at"] == REDACTED_AT


@pytest.mark.db
def test_an_applications_image_loses_the_seats_link_and_the_submission_digest_with_it(mongo_replica_set_url: str):
    """The seat's link and a digest over its details are this person's too; the two links beside it are not."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.BEWERBUNGEN].update_one({"_id": BEWERBUNG_OID}, {"$set": {"idempotenz_fingerabdruck": "digest"}})
        await call_erasure(database, client)

        return await log_rows_naming(database, Collection.BEWERBUNGEN, BEWERBUNG_OID)

    # The clearing's own image, the one filed after the digest was written.
    clearing = [row["before"] for row in on_a_league(mongo_replica_set_url, body) if "idempotenz_fingerabdruck" in row["before"]]

    assert len(clearing) == 1, "no image holding the digest was filed"
    assert clearing[0]["bestaetigungen"] == {**BESTAETIGUNGEN, "ansprechperson": None}
    assert clearing[0]["idempotenz_fingerabdruck"] is None


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
                aktionen_collection=database[Collection.AKTIONEN],
                spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                identifier=VARIANT_REQUEST_EMAIL,
                schluessel=build_test_config().sperrliste_schluessel,
                saison_team_rows=reached[Collection.SAISON_TEAMS],
                bewerbung_rows=reached[Collection.BEWERBUNGEN],
                stamp=REDACTED_AT,
                session=session,
            )

        async with transaction_session(client) as session:
            cleared = await session.with_transaction(in_session)

        return cleared, await database[Collection.AKTIONEN].find().to_list(length=None)

    cleared, log = on_a_league(mongo_replica_set_url, body)

    assert cleared.kontakt_slots == sum(EXPECTED_SLOTS.values())
    assert ERASED_EMAIL not in str(log)


@pytest.mark.db
def test_no_value_of_theirs_survives_anywhere_in_the_database(mongo_replica_set_url: str):
    """The whole database swept as text, not the rows a filter named. Kills a redaction narrowed to some of them.

    A bystander's replaced number is asserted present, without which a database emptied wholesale
    would pass.
    """

    _, rows, log = after_erasing(mongo_replica_set_url)
    rendered = str(log) + str(sorted(rows.items(), key=lambda pair: str(pair[0])))
    theirs = (ERASED_EMAIL, ERASED_TELEFON, ERASED_FORMER_TELEFON, ERASED_NACHNAME)

    assert [value for value in theirs if value in rendered] == []
    assert BYSTANDER_FORMER_TELEFON in rendered, "the sweep would pass over a database emptied wholesale"
    assert UNREACHED_FORMER_TELEFON in rendered


@pytest.mark.db
def test_the_log_rows_of_a_row_nobody_erased_keep_their_images(mongo_replica_set_url: str):
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
def test_the_redaction_writes_no_row_of_its_own(mongo_replica_set_url: str):
    """Kills removing `record_write`'s early return on the log: the redaction would record a copy of what it cleared.

    Exactly one row is added per cleared document, each a clearing patch's own, and none names the log.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        before_count = await database[Collection.AKTIONEN].count_documents({})
        await call_erasure(database, client)

        return (
            before_count,
            await database[Collection.AKTIONEN].count_documents({}),
            await database[Collection.AKTIONEN].count_documents({"collection": str(Collection.AKTIONEN)}),
        )

    before_count, after_count, self_recorded = on_a_league(mongo_replica_set_url, body)

    assert after_count == before_count + len(EXPECTED_SLOTS)
    assert self_recorded == 0


@pytest.mark.db
def test_an_address_naming_nobody_is_a_clean_no_op(mongo_replica_set_url: str):
    """Kills a redaction overwriting what the fold never judged: an address naming nobody stamps no row."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        before_count = await database[Collection.AKTIONEN].count_documents({})
        response = await call_erasure(database, client, UNKNOWN_EMAIL)

        return (
            response,
            await stored_rows(database),
            before_count,
            await database[Collection.AKTIONEN].count_documents({}),
            await database[Collection.AKTIONEN].count_documents({"redacted_at": {"$ne": None}}),
        )

    response, rows, before_count, after_count, stamped = on_a_league(mongo_replica_set_url, body)

    assert response.kontakt_sitze == 0
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
            Collection.AKTIONEN.value,
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

    response, rows = after_erasing_the_near_misses(mongo_replica_set_url)
    cleared = [email for email, row_id in NEAR_ROW_OIDS.items() if rows[row_id]["kontakte"]["trainer"] is None]

    assert cleared == [], "the match reached an address that is not this person"
    assert rows[MATCHED_ROW_OID]["kontakte"]["trainer"] is None, "the unfolded request missed the stored fold"
    assert response.kontakt_sitze == sum(EXPECTED_SLOTS.values()) + 1, "the read reached a seat that is somebody else's"


# An identifier holding no `@`: the spellings the fold claims, and a value each anchor keeps out, the end two of them
# and the start one.
NO_AT_IDENTIFIER = "kein-at"
NO_AT_CLAIMED: tuple[str, ...] = (NO_AT_IDENTIFIER, "KEIN-AT", f"{chr(0x20)}kein-at{chr(0xA0)}")
NO_AT_UNCLAIMED: tuple[str, ...] = ("kein-atx", "kein-at@example.com", "xkein-at")


# A stored address carrying what the fold trims, the start and the end each: the pattern has to
# take every value the fold would claim. Built from code points, since both are whitespace.
PADDED_SPELLINGS: tuple[str, ...] = (f"{chr(0x20)}{ERASED_EMAIL}", f"{ERASED_EMAIL}{chr(0xA0)}")

# Domains a hand-typed row may spell otherwise than the punycode or ASCII a payload stores, each folding
# to it under the international domain-name rules: more spellings than any pattern listing them holds.
UNICODE_DOMAIN = "anna@xn--mller-kva.de"
UNICODE_DOMAIN_SPELLINGS: tuple[str, ...] = (
    "anna@müller.de",
    unicodedata.normalize("NFD", "anna@müller.de"),
    f"anna@müller{chr(0xFF0E)}de",
)
ASCII_DOMAIN_SPELLINGS: tuple[str, ...] = (
    ERASED_EMAIL.replace("example", "".join(chr(ord(letter) + 0xFEE0) for letter in "example")),
    ERASED_EMAIL.replace("example.com", f"example{chr(0x3002)}com"),
    ERASED_EMAIL.replace("@e", f"@{chr(0x212F)}"),
)


@pytest.mark.parametrize(
    ("asked", "taken", "missed"),
    [
        pytest.param(VARIANT_REQUEST_EMAIL, (*CASE_VARIANTS, *PADDED_SPELLINGS, *ASCII_DOMAIN_SPELLINGS), OTHER_LOCAL_PARTS, id="one spelling"),
        # Asked in Unicode, which the fold converts before the pattern is built from it.
        pytest.param(
            "anna@MÜLLER.de", ("anna@xn--mller-kva.de", "ANNA@xn--mller-kva.de"), ("xanna@xn--mller-kva.de",), id="a Unicode domain asked"
        ),
        pytest.param(UNICODE_DOMAIN, (UNICODE_DOMAIN, *UNICODE_DOMAIN_SPELLINGS), ("xanna@müller.de",), id="a Unicode domain stored otherwise"),
        # The fold equates it whole, so both ends are anchored; one anchor alone takes the start's or the end's near miss.
        pytest.param(NO_AT_IDENTIFIER, NO_AT_CLAIMED, NO_AT_UNCLAIMED, id="no @"),
        # An `@` and an empty local part: a prefix still, the domain folding beyond what a whole-value pattern spells.
        pytest.param("@x.de", ("@x.de", "@X.DE", f"@{chr(0xFF58)}.de"), ("x@x.de",), id="an empty local part"),
        # Padded or blank as stored, which a pattern built off that spelling reads less of than its fold claims.
        pytest.param(
            f"{chr(0x20)}{VARIANT_REQUEST_EMAIL}{chr(0xA0)}", (*CASE_VARIANTS, *PADDED_SPELLINGS), OTHER_LOCAL_PARTS, id="a padded spelling"
        ),
        pytest.param(chr(0x20) * 3, ("", chr(0x20), chr(0xA0)), ("x",), id="a blank"),
    ],
)
def test_the_pattern_takes_every_spelling_the_fold_claims_and_no_other_local_part(asked: str, taken: tuple[str, ...], missed: tuple[str, ...]):
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


# What a stored address may hold, past the validator as a hand-typed or older row is: blanks the fold trims, regex
# metacharacters, a NUL, case partners outside ASCII, and near misses of each identifier below. Built from code points.
SERVER_CORPUS: tuple[str, ...] = (
    *("", chr(0x20), chr(0x20) * 3, chr(0xA0), f"{chr(0x20)}{chr(0xA0)}{chr(0x09)}", chr(0x3000), chr(0xFEFF), chr(0x85)),
    *(f"{chr(0xFEFF)}kein-at{chr(0x3000)}", f"{chr(0x85)}kein-at", *NO_AT_CLAIMED, *NO_AT_UNCLAIMED),
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
            # Any stored string serves the pattern: the grant erasure it reads for asks it of `berechtigungen.adresse`.
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
        # With no `@` the fold equates the value whole, so the read is the claim exactly: an end left open reads a near miss.
        whole = "@" not in sign_in_identifier(identifier)
        # The last, a whole-collection read for an identifier naming anything, is a pattern that takes nothing out.
        if server != python or claimed - server or (whole and server != claimed) or (identifier.strip() and server == set(SERVER_CORPUS)):
            parted[identifier] = {
                "server alone": server - python,
                "python alone": python - server,
                "claimed and missed": claimed - server,
                "read and unclaimed": server - claimed if whole else set(),
            }

    assert parted == {}


class TestTheSeatJudgesReadWhateverAnImageHolds:
    """A log image is whatever its row held when the write ran; the pure half, apart from a database."""

    @pytest.mark.parametrize(
        "kontakte",
        [
            pytest.param("Ida Musterfrau", id="a block held as a string"),
            pytest.param(["ida@example.com"], id="a block held as a list"),
            pytest.param({"trainer": "ida@example.com"}, id="a seat held as a string"),
            pytest.param({"trainer": {"email": 7}}, id="an address held as a number"),
        ],
    )
    def test_an_older_shape_names_nobody_and_raises_nothing(self, kontakte: Any):
        image = {"_id": BEWERBUNG_OID, "kontakte": kontakte}

        assert find_matching_slots(image, "ida@example.com") == ()
        assert seat_image_edits(image, ("ida@example.com",), links=True, names={("ida", "musterfrau")}) == {}

    def test_an_image_recorded_before_links_existed_gains_no_links_block(self):
        assert contact_block_image_edits({"kontakte": {"trainer": {"email": "ida@example.com"}}}) == {"kontakte": None}

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


# Two domains to IDNA 2008 and to sign-in, so two people an application may seat side by side.
SHARP_S_EMAIL = "wiltrudis.quastenflosser@straße.de"
DOUBLE_S_EMAIL = "wiltrudis.quastenflosser@strasse.de"
SHARP_S_ROW_OID = ObjectId("6890a1b2c3d4e5f607816001")

HAND_EDITED_ROW_OID = ObjectId("6890a1b2c3d4e5f607816002")


@pytest.mark.db
def test_erasing_one_of_two_people_parted_by_sharp_s_leaves_the_other_seated(mongo_replica_set_url: str):
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
def test_a_seat_stored_under_an_address_no_payload_takes_now_is_erased(mongo_replica_set_url: str, stored: str):
    """GDPR Art. 17: a row edited by hand past the address rule still names a person, so the lookup holds the request to no rule."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SAISON_TEAMS].insert_one(a_row_naming(HAND_EDITED_ROW_OID, stored))
        await call_erasure(database, client, stored)

        return (await stored_rows(database))[HAND_EDITED_ROW_OID]["kontakte"]["trainer"]

    assert on_a_league(mongo_replica_set_url, body) is None


IDNA_ROW_OID = ObjectId("6890a1b2c3d4e5f607816003")

CHEROKEE_CAPITALS = f"{chr(0x13A0)}{chr(0x13A1)}"

# A seat as a payload stores it, asked for in another spelling of the same mailbox. Built from code
# points where a character renders like its neighbour.
IDNA_SPELLINGS = [
    pytest.param("anna@xn--mller-kva.de", "anna@MÜLLER.de", id="stored in punycode, asked in Unicode"),
    pytest.param("anna@schule.de", f"anna@schule{chr(0x3002)}de", id="an ideographic full stop"),
    pytest.param("anna@xn--58dc.de", f"anna@{CHEROKEE_CAPITALS}.de", id="Cherokee stored in punycode"),
    pytest.param("anna@xn--x-7p6m.de", f"anna@{chr(0x16D43)}x.de", id="a Unicode 16 letter the URL parser refuses"),
]


@pytest.mark.parametrize(("stored", "asked"), IDNA_SPELLINGS)
def test_each_stored_spelling_is_one_a_payload_stored(stored: str, asked: str):
    """The premise the database case below rests on: seeded any other way, it would compare a spelling no write produced."""

    assert TypeAdapter(CustomEmail).validate_python(stored) == stored


@pytest.mark.parametrize(("stored", "asked"), IDNA_SPELLINGS)
def test_the_asker_is_keyed_as_the_stored_address_folds(stored: str, asked: str):
    assert sign_in_identifier(asked) == sign_in_identifier(stored)


@pytest.mark.db
@pytest.mark.parametrize(("stored", "asked"), IDNA_SPELLINGS)
def test_a_seat_asked_for_in_another_spelling_of_its_domain_is_named_and_cleared(mongo_replica_set_url: str, stored: str, asked: str):
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SAISON_TEAMS].insert_one(a_row_naming(IDNA_ROW_OID, stored))
        ansicht = await call_ansicht(database, client, asked)
        await call_erasure(database, client, asked)

        return ansicht, (await stored_rows(database))[IDNA_ROW_OID]["kontakte"]["trainer"]

    ansicht, trainer = on_a_league(mongo_replica_set_url, body)

    assert [(sitz.nachname, sitz.saison_id) for sitz in ansicht.sitze] == [(UNREACHED_NACHNAME, LATER_SAISON)]
    assert trainer is None


@pytest.mark.db
def test_an_address_holding_a_nul_names_nobody_and_clears_nothing(mongo_replica_set_url: str):
    """The payload admits the character, and a NUL reaching the grant step's `$regex` raw is refused by the server as a 500.

    In the local part, the half the pattern carries.
    """

    asked = ERASED_EMAIL.replace("@", "\x00@")

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        return (
            await call_ansicht(database, client, asked),
            await call_erasure(database, client, asked),
            await stored_rows(database),
            await database[Collection.AKTIONEN].count_documents({"redacted_at": {"$ne": None}}),
        )

    ansicht, response, rows, stamped = on_a_league(mongo_replica_set_url, body)

    assert (ansicht.sitze, ansicht.bewerbungen) == ([], [])
    assert (response.kontakt_sitze, stamped) == (0, 0)
    assert all(rows[row_id]["kontakte"] == LIVE_BLOCKS[row_id] for row_id in (*SAISON_TEAM_OIDS, *BEWERBUNG_OIDS))


@pytest.mark.db
def test_a_label_decoding_to_a_lone_surrogate_names_nobody_and_clears_nothing(mongo_replica_set_url: str):
    """The payload admits it for holding an `@`, and its punycode decodes to a lone surrogate the driver cannot encode.

    A step on this path decoding the domain would answer 500 here.
    """

    asked = "a@xn--ib9b"

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        return (
            await call_ansicht(database, client, asked),
            await call_erasure(database, client, asked),
            await stored_rows(database),
            await database[Collection.AKTIONEN].count_documents({"redacted_at": {"$ne": None}}),
        )

    ansicht, response, rows, stamped = on_a_league(mongo_replica_set_url, body)

    assert (ansicht.sitze, ansicht.bewerbungen) == ([], [])
    assert (response.kontakt_sitze, stamped) == (0, 0)
    assert all(rows[row_id]["kontakte"] == LIVE_BLOCKS[row_id] for row_id in (*SAISON_TEAM_OIDS, *BEWERBUNG_OIDS))


@pytest.mark.db
def test_every_log_row_of_each_reached_document_is_stamped_and_no_other(mongo_replica_set_url: str):
    """Kills a redaction stopping at one document's rows, which the case reading the earliest season's row alone passes."""

    _, _, log = after_erasing(mongo_replica_set_url)
    stamped = [row for row in log if row["redacted_at"] is not None]

    assert len(stamped) == len(EXPECTED_SLOTS) * LOG_ROWS_PER_REACHED_ROW
    assert {row["document_id"] for row in stamped} == set(EXPECTED_SLOTS)


@pytest.mark.db
def test_a_pre_image_the_row_no_longer_names_is_redacted(mongo_replica_set_url: str):
    """The hole an audit demonstrated against a real mongod.

    A swap moves the address out of the row, so the live match names no document and the pre-image
    still holding her is reached by no id.
    """

    response, _, log = after_erasing_a_swapped_out_person(mongo_replica_set_url)
    orphaned = [row for row in log if row["document_id"] == SWAPPED_ROW_OID]

    assert len(orphaned) == 1, "the swap filed no pre-image for the erasure to miss"
    assert orphaned[0]["before"]["kontakte"]["trainer"] is None
    assert orphaned[0]["redacted_at"] == REDACTED_AT
    # No live seat, so the one row stamped was reached by what its image held.
    assert response.kontakt_sitze == 0
    assert [row["_id"] for row in log if row["redacted_at"] is not None] == [orphaned[0]["_id"]]


@pytest.mark.db
def test_no_value_of_a_swapped_out_person_survives_anywhere(mongo_replica_set_url: str):
    """The sweep over the audited case, with a bystander's own pre-image as its floor."""

    _, rows, log = after_erasing_a_swapped_out_person(mongo_replica_set_url)
    rendered = str(log) + str(sorted(rows.items(), key=lambda pair: str(pair[0])))

    theirs = (ERASED_EMAIL, ERASED_FORMER_TELEFON, ERASED_NACHNAME)

    assert [value for value in theirs if value in rendered] == []
    assert BYSTANDER_FORMER_TELEFON in rendered, "an unrelated row's pre-image was emptied as collateral"


# A day after `NOW`, so a stamp a second run wrote differs from the first run's.
A_DAY_LATER = datetime(2026, 4, 2, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))


@pytest.mark.db
def test_erasing_the_same_person_a_second_time_is_a_clean_no_op(mongo_replica_set_url: str):
    """The first run empties their seat inside each image, so the second finds nothing of theirs to stamp."""

    async def _run() -> Any:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME, constraints=True) as (client, database):
            await a_swap_moves_them_out(database)
            await call_erasure(database, client)
            first = await database[Collection.AKTIONEN].find().sort("_id", 1).to_list(length=None)
            again = await erased(database, client, ERASED_EMAIL, germany_now=A_DAY_LATER)

            return first, again, await database[Collection.AKTIONEN].find().sort("_id", 1).to_list(length=None)

    first, again, log = on_the_seed_loop(_run())

    assert [row["redacted_at"] for row in first if row["document_id"] == SWAPPED_ROW_OID] == [REDACTED_AT]
    assert again.kontakt_sitze == 0
    # The first run's work stands, and the second wrote nothing over it.
    assert log == first


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

    assert response.kontakt_sitze == sum(EXPECTED_SLOTS.values()) + 1, "the application this case adds was not reached at all"
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


def after_revealing_a_shared_inbox(url: str) -> FLErasureAnsichtResponse:
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

    ansicht = after_revealing_a_shared_inbox(mongo_replica_set_url)

    assert [(sitz.nachname, sitz.saison_id) for sitz in ansicht.sitze] == [
        (ERASED_NACHNAME, EARLIER_SAISON),
        (BYSTANDER_NACHNAME, LATER_SAISON),
    ]
    assert ansicht.bewerbungen == []


@pytest.mark.db
def test_the_reveal_lists_exactly_the_seats_the_erasure_then_clears(mongo_replica_set_url: str):
    """What one matcher buys: a confirmation naming a different set from the one the write reaches is worse than none."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        return await call_ansicht(database, client), await call_erasure(database, client)

    ansicht, response = on_a_league(mongo_replica_set_url, body)
    named = len(ansicht.sitze) + len(ansicht.bewerbungen)

    # Against the table above as well as the count: two figures agreeing on zero agree on nothing.
    assert named == sum(EXPECTED_SLOTS.values())
    assert named == response.kontakt_sitze


# The erasure clears every row naming the person in one transaction with no share, so this, a round trip
# each, bounds how many rows a person may hold inside the request's deadline.
COMMANDS_A_CLEARED_ROW = 3

# Two erasures apart by this many rows naming the person.
EXTRA_ROWS = 10


def an_extra_row(position: int) -> ObjectId:
    return ObjectId(f"6890a1b2c3d4e5f6079{position:05d}")


def a_fixture_of(team_id: ObjectId, *, saison_id: str = LATER_SAISON, spiel_nr: int = 1) -> dict[str, Any]:
    """A fixture of this team's, never stored: a confirmation row is composed from it as the mint composes one."""

    side = {"team_id": team_id, "name": "Adler", "shorthand": "AD", "tore": None}

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


def an_open_confirmation(team_id: ObjectId) -> dict[str, Any]:
    """The row's team asked about a fixture and not yet answered, each seat holding the link it was mailed."""

    return documents.spielbestaetigung_document(
        a_fixture_of(team_id),
        partei={"art": "team", "team_id": team_id},
        frist="2026-04-11",
        angefragt_am="2026-04-01",
        kontakte={seat: {"token_hashes": [hash_token(f"{team_id}-{seat}")], "zustellung": None} for seat in KONTAKT_ROLLEN},
    )


@pytest.mark.db
def test_each_row_the_erasure_clears_costs_the_commands_counted_for_it(mongo_replica_set_url: str):
    """A command added per row passes every other case, and shrinks the person whose erasure still finishes inside the deadline.

    Each row's team holds an open confirmation, so a void written per row is counted too.
    """

    def counted(rows: int) -> int:
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> int:
            await database[Collection.SAISON_TEAMS].insert_many(
                [a_row_naming(an_extra_row(position), ERASED_EMAIL) for position in range(rows)]
            )
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many(
                [an_open_confirmation(an_extra_row(position)) for position in range(rows)]
            )

            return await commands_sent(mongo_replica_set_url, DATABASE_NAME, call_erasure)

        return on_a_league(mongo_replica_set_url, body)

    few, more = counted(EXTRA_ROWS), counted(2 * EXTRA_ROWS)

    assert (more - few) / EXTRA_ROWS == COMMANDS_A_CLEARED_ROW


def a_reason_of_theirs(saison_id: str = LATER_SAISON) -> dict[str, Any]:
    """A row the erased person declined with a reason, closed since; no seat they hold now need be the one it was typed from."""

    return documents.spielbestaetigung_document(
        a_fixture_of(TEAM_A_OID, saison_id=saison_id),
        partei={"art": "team", "team_id": TEAM_A_OID},
        antwort=documents.kontakt_antwort_document("trainer", ERASED_EMAIL, begruendung="Wir sind auf Klassenfahrt"),
        geschlossen={"am": "2026-04-02", "grund": "ansetzung_geaendert"},
    )


def a_bystanders_row(saison_id: str) -> dict[str, Any]:
    return documents.spielbestaetigung_document(a_fixture_of(TEAM_B_OID, saison_id=saison_id), partei={"art": "team", "team_id": TEAM_B_OID})


# The rows and images of the person's reasons the driver answers in its first batch: a read past it costs a `getMore`.
IMAGES_A_FIRST_BATCH = 101


@pytest.mark.db
def test_the_images_of_their_reasons_cost_one_read_more_past_the_first_batch_and_no_write_more(mongo_replica_set_url: str):
    """Past the first batch, each of the three reads selecting their rows takes one `getMore`, and no write more.

    The rows and their images by holder, and the images again as a team's rows their seats leave.
    """

    def counted(images: int) -> int:
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> int:
            rows = [a_reason_of_theirs() for _ in range(images)]
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many(rows)
            # A write after each answer files the row's image, the reason and its holder in it.
            for row in rows:
                await patch_one_in_db(
                    collection=database[Collection.SPIELBESTAETIGUNGEN],
                    db_filter={"_id": row["_id"]},
                    update={"$set": {"erinnert_am": ["2026-04-03"]}},
                    return_document=ReturnDocument.BEFORE,
                )

            return await commands_sent(mongo_replica_set_url, DATABASE_NAME, call_erasure)

        return on_a_league(mongo_replica_set_url, body)

    assert counted(2 * IMAGES_A_FIRST_BATCH) - counted(IMAGES_A_FIRST_BATCH - 1) == 3


@pytest.mark.db
def test_each_distinct_place_of_theirs_in_an_undraws_image_costs_one_write(mongo_replica_set_url: str):
    """An undraw's removal holds its rows as an array, and an image edit's path names the element, so one write per distinct path set."""

    def counted(places: list[int]) -> int:
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            collection = database[Collection.SPIELBESTAETIGUNGEN]
            for undraw, place in enumerate(places):
                saison_id = f"27{undraw:02d}"
                # Inserted in order, so theirs is the removal's element at `place`.
                await collection.insert_many([*(a_bystanders_row(saison_id) for _ in range(place)), a_reason_of_theirs(saison_id)])
                async with client.start_session() as session:
                    await delete_many_from_db(collection=collection, db_filter={"saison_id": saison_id}, session=session)

            return await commands_sent(mongo_replica_set_url, DATABASE_NAME, call_erasure)

        return on_a_league(mongo_replica_set_url, body)

    assert counted([0, 1, 2]) - counted([0, 0, 0]) == 2


# Every non-empty set of the three seats, the widest spread one erasure's void can write.
SEAT_SETS = [tuple(seat for bit, seat in enumerate(KONTAKT_ROLLEN) if mask >> bit & 1) for mask in range(1, 2 ** len(KONTAKT_ROLLEN))]


def a_row_voiding(row_id: ObjectId, seats: tuple[str, ...]) -> dict[str, Any]:
    """The person on the first of `seats`, the rest of them empty and every other seat held: the erasure voids exactly `seats`."""

    others = iter([person(BYSTANDER_NACHNAME, BYSTANDER_TELEFON), person(UNREACHED_NACHNAME, UNREACHED_TELEFON)])
    block = {
        slot: ({**person(ERASED_NACHNAME, ERASED_TELEFON)} if slot == seats[0] else None) if slot in seats else next(others)
        for slot in KONTAKT_ROLLEN
    }

    return a_junction_row(row_id, LATER_SAISON, {**block, "trainer_ist_zugleich": None})


@pytest.mark.db
def test_each_further_seat_set_the_void_meets_costs_one_write_and_its_log_row(mongo_replica_set_url: str):
    """Seven rows voiding seven different seat sets against seven voiding one: the void writes once per set, and nothing reads first."""

    def counted(seat_sets: list[tuple[str, ...]]) -> int:
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> int:
            rows = [a_row_voiding(an_extra_row(position), seats) for position, seats in enumerate(seat_sets)]
            await database[Collection.SAISON_TEAMS].insert_many(rows)
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many([an_open_confirmation(row["team_id"]) for row in rows])

            return await commands_sent(mongo_replica_set_url, DATABASE_NAME, call_erasure)

        return on_a_league(mongo_replica_set_url, body)

    assert len(set(SEAT_SETS)) == 7
    assert counted(SEAT_SETS) - counted([KONTAKT_ROLLEN] * len(SEAT_SETS)) == 2 * (len(SEAT_SETS) - 1)


THEIR_HALTER = halter_of(ERASED_EMAIL, schluessel=build_test_config().sperrliste_schluessel)


@pytest.mark.db
def test_the_reason_steps_log_row_names_no_digest_of_theirs(mongo_replica_set_url: str):
    """The log keeps a fan-out's filter as text for twelve months, so the step's write names their rows by id alone."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SPIELBESTAETIGUNGEN].insert_many([a_reason_of_theirs(), a_reason_of_theirs()])
        await call_erasure(database, client)

        return (
            await database[Collection.SPIELBESTAETIGUNGEN].find({}, {"antwort": 1}).to_list(length=None),
            await database[Collection.AKTIONEN].find({}).to_list(length=None),
        )

    stored, log = on_a_league(mongo_replica_set_url, body)

    # The premise: the step wrote both rows, and logged doing so.
    assert [row["antwort"]["begruendung"] for row in stored] == [None, None]
    assert [row["modified_count"] for row in log if row["collection"] == Collection.SPIELBESTAETIGUNGEN] == [2]
    assert THEIR_HALTER not in str(log)


@pytest.mark.db
def test_the_reason_steps_read_walks_the_holder_index(mongo_replica_set_url: str):
    """The collection keeps every season's rows, and every contact erasure reads it inside its transaction."""

    async def body(database: AsyncDatabase, _client: AsyncMongoClient) -> Any:
        await database[Collection.SPIELBESTAETIGUNGEN].insert_many([a_reason_of_theirs(), a_bystanders_row(LATER_SAISON)])
        _, sent = await plans_of_sent_reads(
            mongo_replica_set_url,
            database,
            call_erasure,
            lambda collection, command: collection == Collection.SPIELBESTAETIGUNGEN and "antwort.von.halter" in str(command.get("pipeline")),
        )

        return sent

    [(_, plan)] = on_a_league(mongo_replica_set_url, body)

    assert plan == "IXSCAN { antwort.von.halter: 1 }"
