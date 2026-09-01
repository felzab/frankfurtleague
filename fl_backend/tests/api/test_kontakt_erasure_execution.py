from datetime import datetime
from typing import Any, Awaitable, Callable, Mapping
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure

from app.api.kontakte.admin_router import erase_kontaktperson
from app.api.kontakte.schemas import FLKontaktErasurePayload, FLKontaktErasureResponse
from app.api.kontakte.services import KONTAKT_SLOTS
from app.api.teams.schemas import FLSaisonTeamKontakte
from app.core.collections import Collection
from app.core.crud import patch_one_in_db
from tests.database import a_clean_database, on_the_seed_loop

DATABASE_NAME = "fl_kontakt_erasure_test"

# Asserted on rather than caught broadly, so an unrelated failure cannot pass as a rejection.
DOCUMENT_VALIDATION_FAILED = 121

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
# no seeded row holds. `EmailStr` lowercases the domain and hands the local part on as typed.
VARIANT_REQUEST_EMAIL = "Wiltrudis.Quastenflosser@EXAMPLE.COM"

# Every stored spelling of that one mailbox: the domain differing, the local part differing, and both.
CASE_VARIANTS: tuple[str, ...] = (
    ERASED_EMAIL,
    ERASED_EMAIL.replace("example.com", "EXAMPLE.COM"),
    "Wiltrudis.Quastenflosser@example.com",
    ERASED_EMAIL.upper(),
)

# Addresses the same request must leave standing. The last three are the floor under the `$regex`:
# unanchored, or with the `.` unescaped, the pattern takes all of them.
NEAR_MISSES: tuple[str, ...] = (
    "wiltrudis.quastenflosser@example.org",
    "nichtwiltrudis.quastenflosser@example.com",
    "wiltrudis.quastenflosser@example.community",
    "wiltrudisXquastenflosser@example.com",
)

# One row per spelling, ids fixed so a failure names the spelling rather than a list position.
CASE_ROW_OIDS = {email: ObjectId(f"6890a1b2c3d4e5f60781{3000 + index:04d}") for index, email in enumerate(CASE_VARIANTS)}
NEAR_ROW_OIDS = {email: ObjectId(f"6890a1b2c3d4e5f60781{4000 + index:04d}") for index, email in enumerate(NEAR_MISSES)}

# The row an ordinary contact edit moves the erased person OUT of, and one it never stood in. Both
# hold their FORMER number, which the edit then replaces, so that number lives in the log alone.
SWAPPED_ROW_OID = ObjectId("6890a1b2c3d4e5f607815001")
UNTOUCHED_ROW_OID = ObjectId("6890a1b2c3d4e5f607815002")
SWAP_SAISON = "2627"

# Stored in another case, so reaching that image needs both halves of the fix at once.
SWAPPED_STORED_EMAIL = ERASED_EMAIL.upper()

# Injected through `get_germany_now`, so the stamp under test is not the wall clock. Summer time,
# which is what puts an offset on the conversion below.
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# The instant above as a log row spells it: 12:30 in Frankfurt is 10:30 in the log. Written out
# rather than computed from `log_stamp`, a stored stamp compared against the function that produced
# it agreeing with any conversion of it, including none.
REDACTED_AT = "2026-04-01T10:30:00+00:00"


# Every seeded person, by surname: the address that identifies them, the number they hold now, and
# the number an earlier write replaced. The replaced one lives in the LOG alone, which is the copy an
# erasure stopping at the collections leaves standing.
PEOPLE: dict[str, tuple[str, str, str]] = {
    ERASED_NACHNAME: (ERASED_EMAIL, ERASED_TELEFON, ERASED_FORMER_TELEFON),
    BYSTANDER_NACHNAME: (BYSTANDER_EMAIL, BYSTANDER_TELEFON, BYSTANDER_FORMER_TELEFON),
    UNREACHED_NACHNAME: (UNREACHED_EMAIL, UNREACHED_TELEFON, UNREACHED_FORMER_TELEFON),
}

# Who stands in each slot of each seeded row, in `KONTAKT_SLOTS` order, plus which seat the form said
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
        "einwilligung": {"umfang": "kontaktdaten", "erteilt_von": "person", "text_version": "v1", "datum": "2026-01-05"},
    }


def blocks(*, live: bool) -> dict[ObjectId, dict[str, Any]]:
    """The five seeded blocks in one of their two states, keyed by the row that holds them.

    The two states differ in every telephone number and in nothing else, so a value found in the log
    can be attributed to the state it came from.
    """

    telefone = {nachname: (held if live else replaced) for nachname, (_, held, replaced) in PEOPLE.items()}

    return {
        row_id: {
            **{slot: person(nachname, telefone[nachname]) for slot, nachname in zip(KONTAKT_SLOTS, roles, strict=True)},
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
    """Every field `app/core/constraints.py :: Collection.SAISON_TEAMS` requires, seeded in the FORMER state."""

    return {
        "_id": row_id,
        "saison_id": saison_id,
        "team_id": team_id,
        "gruppe": "A",
        "austritt": None,
        "trikot_farbe": "blau",
        "kontakte": FORMER_BLOCKS[row_id],
        "name": "Testschule",
        "shorthand": "TS",
    }


def bewerbung_document(row_id: ObjectId, team_id: ObjectId) -> dict[str, Any]:
    """The same, for `Collection.BEWERBUNGEN`, whose `kontakte` is a REQUIRED, non-nullable block."""

    return {
        "_id": row_id,
        "saison_id": LATER_SAISON,
        "eingereicht_am": "2026-01-05",
        "status": "eingereicht",
        "team_id": team_id,
        "schule": None,
        "kontakte": FORMER_BLOCKS[row_id],
        "trikot": {"vorhandener_satz": "keiner", "wunschfarbe": "rot"},
        "kader": {"voraussichtliche_groesse": 12, "gute_spieler": 3},
        "entscheidung": None,
    }


Body = Callable[[AsyncIOMotorDatabase, AsyncIOMotorClient], Awaitable[Any]]

# The echo, both collections keyed by `_id`, and the whole log -- what most cases below read.
Snapshot = tuple[FLKontaktErasureResponse, dict[Any, Mapping[str, Any]], list[Mapping[str, Any]]]


async def a_row_with_a_history(database: AsyncIOMotorDatabase, collection: str, row_id: ObjectId) -> None:
    """Two recorded writes over a seeded row, which is what leaves the log holding these people.

    The first replaces the FORMER block, so the numbers it held live in the log alone; the second
    touches another field, whose image is the block as it stands.
    """

    await patch_one_in_db(collection=database[collection], db_filter={"_id": row_id}, update={"$set": {"kontakte": LIVE_BLOCKS[row_id]}})
    await patch_one_in_db(collection=database[collection], db_filter={"_id": row_id}, update={"$set": {"gruppe": "B"}})


async def a_bewerbung_with_a_history(database: AsyncIOMotorDatabase, row_id: ObjectId) -> None:
    """The junction's shape, with the second write over a field an application actually carries."""

    collection = database[Collection.BEWERBUNGEN]

    await patch_one_in_db(collection=collection, db_filter={"_id": row_id}, update={"$set": {"kontakte": LIVE_BLOCKS[row_id]}})
    await patch_one_in_db(collection=collection, db_filter={"_id": row_id}, update={"$set": {"kader.gute_spieler": 4}})


def on_a_league(url: str, body: Body, *, mutates_schema: bool = False) -> Any:
    """The REAL validators and support indexes, so a namespace a transaction cannot create is there.

    `mutates_schema=True` where the body narrows one of those validators: `tests/database.py` then
    keeps the change off every later test.
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


async def call_erasure(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient, email: str = ERASED_EMAIL) -> FLKontaktErasureResponse:
    return await erase_kontaktperson(
        erasure_data=FLKontaktErasurePayload(email=email),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        germany_now=NOW,
    )


async def stored_rows(database: AsyncIOMotorDatabase) -> dict[Any, Mapping[str, Any]]:
    """Both collections keyed by `_id`, so a failing assertion names the row rather than a list position."""

    found: dict[Any, Mapping[str, Any]] = {}
    for collection in (Collection.SAISON_TEAMS, Collection.BEWERBUNGEN):
        for row in await database[collection].find().to_list(length=None):
            found[row["_id"]] = row

    return found


async def log_rows_naming(database: AsyncIOMotorDatabase, collection: Collection, row_id: ObjectId) -> list[Mapping[str, Any]]:
    """Every log row about this document, spelled out here rather than taken from the endpoint's own filter.

    A wrong filter in the endpoint cannot then make these assertions agree with it.
    """

    rows = database[Collection.AKTIONEN].find({"collection": str(collection), "document_id": row_id})

    return await rows.to_list(length=None)


def a_block_holding(trainer: Mapping[str, Any]) -> dict[str, Any]:
    """One person in the Trainer slot, the other two empty, all four keys present."""

    return {**{slot: None for slot in KONTAKT_SLOTS}, "trainer": dict(trainer), "trainer_ist_zugleich": None}


def a_junction_row(row_id: ObjectId, saison_id: str, block: Mapping[str, Any]) -> dict[str, Any]:
    """A valid `saison_teams` row carrying exactly this block, its own id standing in as `team_id`.

    Which is what lets a case seed as many rows as it likes under `uniq_saison_id_team_id`.
    """

    return {
        "_id": row_id,
        "saison_id": saison_id,
        "team_id": row_id,
        "gruppe": "A",
        "austritt": None,
        "trikot_farbe": "blau",
        "kontakte": dict(block),
        "name": "Testschule",
        "shorthand": "TS",
    }


def a_row_naming(row_id: ObjectId, email: str) -> dict[str, Any]:
    """A junction row whose Trainer holds exactly this address, inserted straight past pydantic.

    Which is how an application reaches it in any case: `bewerbungen` has no create endpoint, so
    `bsonType: "string"` is all a stored address is held to.
    """

    return a_junction_row(row_id, LATER_SAISON, a_block_holding({**person(UNREACHED_NACHNAME, UNREACHED_TELEFON), "email": email}))


async def a_swap_moves_them_out(database: AsyncIOMotorDatabase) -> None:
    """The auditor's sequence: seed the person into a row, then edit her out of it through a real write.

    `patch_one_in_db` is what an administrator's contact edit runs through, so the pre-image it files
    here is the one a swap files in production.
    """

    await database[Collection.SAISON_TEAMS].insert_many(
        [
            a_junction_row(
                SWAPPED_ROW_OID,
                SWAP_SAISON,
                a_block_holding({**person(ERASED_NACHNAME, ERASED_FORMER_TELEFON), "email": SWAPPED_STORED_EMAIL}),
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
    )
    await patch_one_in_db(
        collection=collection, db_filter={"_id": UNTOUCHED_ROW_OID}, update={"$set": {"kontakte.trainer.telefon": BYSTANDER_TELEFON}}
    )


def after_erasing_a_swapped_out_person(url: str, runs: int = 1) -> Snapshot:
    """A league where the erasure runs against rows that no longer name the person it is given."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await a_swap_moves_them_out(database)

            for _ in range(runs):
                response = await call_erasure(database, client)

            log = await database[Collection.AKTIONEN].find().sort("_id", 1).to_list(length=None)

            return response, await stored_rows(database), log

    return on_the_seed_loop(_run())


def after_erasing_the_case_table(url: str) -> tuple[FLKontaktErasureResponse, dict[Any, Mapping[str, Any]]]:
    """The seeded league plus one row per spelling in both tables, erased with a third spelling again."""

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
        await database[Collection.SAISON_TEAMS].insert_many(
            [a_row_naming(row_id, email) for email, row_id in (*CASE_ROW_OIDS.items(), *NEAR_ROW_OIDS.items())]
        )
        response = await call_erasure(database, client, VARIANT_REQUEST_EMAIL)

        return response, await stored_rows(database)

    return on_a_league(url, body)


def after_erasing(url: str, email: str = ERASED_EMAIL) -> Snapshot:
    """The echo, both collections and the whole log together: one seeded database serves all three."""

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
        response = await call_erasure(database, client, email)
        log = await database[Collection.AKTIONEN].find().sort("_id", 1).to_list(length=None)

        return response, await stored_rows(database), log

    return on_a_league(url, body)


class TestTheSlotsAreReadOffTheModel:
    """The spelling the write turns on, apart from a database."""

    def test_the_person_valued_slots_are_the_three_roles(self):
        assert KONTAKT_SLOTS == ("trainer", "ansprechperson", "stellvertretung")

    def test_the_assertion_field_is_not_among_them(self):
        """`trainer_ist_zugleich` records what somebody ASSERTED about two slots, which stays true once one is empty."""

        assert "trainer_ist_zugleich" not in KONTAKT_SLOTS

    def test_every_slot_the_model_declares_is_covered(self):
        """Kills a hand-typed tuple: a fourth role added to the block would be cleared by nothing."""

        declared = {name for name, field in FLSaisonTeamKontakte.model_fields.items() if name != "trainer_ist_zugleich"}

        assert set(KONTAKT_SLOTS) == declared

    def test_a_block_with_every_slot_empty_still_validates(self):
        """The read model is what a junction row is served through, so a slot that stopped being nullable is a 500."""

        cleared = FLSaisonTeamKontakte.model_validate({**{slot: None for slot in KONTAKT_SLOTS}, "trainer_ist_zugleich": "ansprechperson"})

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
        assert set(rows[row_id]["kontakte"]) == {*KONTAKT_SLOTS, "trainer_ist_zugleich"}, f"{row_id} lost a key"


@pytest.mark.db
def test_nulling_an_applications_whole_block_is_what_the_validator_refuses(mongo_replica_set_url: str):
    """Without this the dotted keys read as style. `bewerbungen.kontakte` is required and non-nullable as a BLOCK."""

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> str:
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

    assert (response.cleared_saison_teams, response.cleared_bewerbungen) == (2, 1)
    assert response.cleared_kontakt_slots == sum(EXPECTED_SLOTS.values())
    assert ERASED_EMAIL not in rendered and ERASED_NACHNAME not in rendered


@pytest.mark.db
def test_every_log_row_naming_a_reached_document_is_emptied_and_stamped(mongo_replica_set_url: str):
    """Kills dropping the redaction, one that stamps without clearing, and one that clears without stamping.

    The pre-state is asserted too, without which a filter matching nothing would pass.
    """

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
        seeded = await log_rows_naming(database, Collection.SAISON_TEAMS, ROW_A_EARLIER_OID)
        await call_erasure(database, client)

        return seeded, await log_rows_naming(database, Collection.SAISON_TEAMS, ROW_A_EARLIER_OID)

    seeded, rows = on_a_league(mongo_replica_set_url, body)

    assert [row for row in seeded if row["before"] is not None], "the seeded log held no image to redact"
    assert len(rows) > len(seeded), "the erasure's own patch recorded no row"
    assert all(row["before"] is None for row in rows)
    assert {row["redacted_at"] for row in rows} == {REDACTED_AT}


@pytest.mark.db
def test_the_row_the_erasures_own_patch_wrote_is_redacted_too(mongo_replica_set_url: str):
    """Kills redacting BEFORE the clearing: each clearing patch files a pre-image of the block still holding this person.

    Kills `patch_many_in_db` for the clearing too: that helper records no `document_id`, so its row
    would not be found here.
    """

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
        seeded = {row["_id"] for row in await log_rows_naming(database, Collection.SAISON_TEAMS, ROW_A_LATER_OID)}
        await call_erasure(database, client)
        rows = await log_rows_naming(database, Collection.SAISON_TEAMS, ROW_A_LATER_OID)

        return seeded, [row for row in rows if row["_id"] not in seeded]

    seeded, added = on_a_league(mongo_replica_set_url, body)

    assert seeded, "the seeded history left no row to tell the new one from"
    assert len(added) == 1, "the clearing wrote no addressable log row of its own"
    assert added[0]["before"] is None
    assert added[0]["redacted_at"] == REDACTED_AT


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

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
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

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
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
    """Kills an `$in` of no ids reading as "every row": `build_redaction_filter` matches nothing, never everything."""

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
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

    assert (response.cleared_saison_teams, response.cleared_bewerbungen) == (0, 0)
    assert (response.cleared_kontakt_slots, response.redacted_aktionen) == (0, 0)
    assert all(rows[row_id]["kontakte"] == LIVE_BLOCKS[row_id] for row_id in (*SAISON_TEAM_OIDS, *BEWERBUNG_OIDS))
    # No clearing patch ran, and the redaction records nothing about itself, so the log is untouched.
    assert (after_count, stamped) == (before_count, 0)


@pytest.mark.db
def test_a_refused_redaction_takes_every_clearing_back(mongo_replica_set_url: str):
    """Kills running the writes outside one transaction, and dropping the session from any of them.

    A `$jsonSchema` refusing a stamped row fails the LAST write, once both collections are cleared.
    """

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
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
def test_every_case_variant_of_a_stored_address_is_cleared(mongo_replica_set_url: str):
    """Kills the equality match, which clears one spelling of four and calls it done.

    `EmailStr` lowercases the domain and hands the local part on exactly as typed.
    """

    _, rows = after_erasing_the_case_table(mongo_replica_set_url)
    survived = [email for email, row_id in CASE_ROW_OIDS.items() if rows[row_id]["kontakte"]["trainer"] is not None]

    assert survived == [], "an erasure that reported success left these spellings standing"


@pytest.mark.db
def test_an_address_that_is_only_similar_survives_the_same_request(mongo_replica_set_url: str):
    """The floor under ignoring case: the `^`/`$` anchors and the escaped `.` keep another mailbox out.

    The count is the sensitive half -- a row the pattern reaches loses its log images even where the
    re-check then clears no slot.
    """

    response, rows = after_erasing_the_case_table(mongo_replica_set_url)
    cleared = [email for email, row_id in NEAR_ROW_OIDS.items() if rows[row_id]["kontakte"]["trainer"] is None]

    assert cleared == [], "the match reached an address that is not this person"
    assert response.cleared_saison_teams == 2 + len(CASE_VARIANTS), "the pattern reached a row that is somebody else"


@pytest.mark.db
def test_the_echo_counts_the_log_rows_the_redaction_reached(mongo_replica_set_url: str):
    """Kills a hardcoded zero, which the no-op case above cannot: this is the number telling an administrator the log was reached."""

    response, _, log = after_erasing(mongo_replica_set_url)
    stamped = [row for row in log if row["redacted_at"] is not None]

    assert response.redacted_aktionen == len(EXPECTED_SLOTS) * LOG_ROWS_PER_REACHED_ROW
    assert response.redacted_aktionen == len(stamped), "the echo disagrees with the rows actually stamped"


@pytest.mark.db
def test_a_pre_image_the_row_no_longer_names_is_redacted(mongo_replica_set_url: str):
    """The hole an audit demonstrated against a real mongod.

    A swap moves the address out of the row, so the live match names no document and the pre-image
    still holding her is reached by no id.
    """

    response, _, log = after_erasing_a_swapped_out_person(mongo_replica_set_url)
    orphaned = [row for row in log if row["document_id"] == SWAPPED_ROW_OID]

    assert len(orphaned) == 1, "the swap filed no pre-image for the erasure to miss"
    assert orphaned[0]["before"] is None
    assert orphaned[0]["redacted_at"] == REDACTED_AT
    # No live row and one log row: the echo says the log was reached, never that there was nothing.
    assert (response.cleared_saison_teams, response.cleared_bewerbungen, response.cleared_kontakt_slots) == (0, 0, 0)
    assert response.redacted_aktionen == 1


@pytest.mark.db
def test_no_value_of_a_swapped_out_person_survives_anywhere(mongo_replica_set_url: str):
    """The sweep over the audited case, with a bystander's own pre-image as its floor."""

    _, rows, log = after_erasing_a_swapped_out_person(mongo_replica_set_url)
    rendered = str(log) + str(sorted(rows.items(), key=lambda pair: str(pair[0])))

    theirs = (ERASED_EMAIL, SWAPPED_STORED_EMAIL, ERASED_FORMER_TELEFON, ERASED_NACHNAME)

    assert [value for value in theirs if value in rendered] == []
    assert BYSTANDER_FORMER_TELEFON in rendered, "an unrelated row's pre-image was emptied as collateral"


@pytest.mark.db
def test_erasing_the_same_person_a_second_time_is_a_clean_no_op(mongo_replica_set_url: str):
    """`build_redaction_update` nulls `before`, so the second pass's own filter can no longer see the row it emptied."""

    response, _, log = after_erasing_a_swapped_out_person(mongo_replica_set_url, runs=2)

    assert response.redacted_aktionen == 0, "the second run counted a row the first had already emptied"
    assert (response.cleared_saison_teams, response.cleared_bewerbungen, response.cleared_kontakt_slots) == (0, 0, 0)
    # The first run's work stands, and the second stamped nothing over it.
    assert [row["redacted_at"] for row in log if row["document_id"] == SWAPPED_ROW_OID] == [REDACTED_AT]


# An application this person did NOT stand in until a later write put them there. Its own row, so
# the counts every case above asserts are untouched.
LATECOMER_BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607810023")


@pytest.mark.db
def test_a_log_row_of_an_application_holding_no_image_of_them_is_stamped_anyway(mongo_replica_set_url: str):
    """Drop the `bewerbungen` target from `build_redaction_filter` and this fails.

    The orphaned pass nets only images HOLDING this person, and the write that put them into an
    application filed one naming somebody else.
    """

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
        application = database[Collection.BEWERBUNGEN]
        # Seeded holding nobody the erasure may reach, then patched to a block that names them: the
        # image that write filed is the one carrying no address of theirs.
        await application.insert_one({**bewerbung_document(OTHER_BEWERBUNG_OID, TEAM_B_OID), "_id": LATECOMER_BEWERBUNG_OID})
        await patch_one_in_db(
            collection=application,
            db_filter={"_id": LATECOMER_BEWERBUNG_OID},
            update={"$set": {"kontakte": LIVE_BLOCKS[BEWERBUNG_OID]}},
        )

        introducing = await log_rows_naming(database, Collection.BEWERBUNGEN, LATECOMER_BEWERBUNG_OID)
        response = await call_erasure(database, client)

        return introducing, response, await log_rows_naming(database, Collection.BEWERBUNGEN, LATECOMER_BEWERBUNG_OID)

    introducing, response, rows = on_a_league(mongo_replica_set_url, body)

    # The floor: the pre-image this case rests on must name somebody else and not this person, or
    # the orphaned pass would reach the row and the target below would prove nothing.
    assert len(introducing) == 1
    assert ERASED_EMAIL not in str(introducing[0]["before"]), "the seeded image already names them, so no id is needed to reach it"

    assert response.cleared_bewerbungen == 2, "the application this case adds was not reached at all"
    # Both: the write that introduced them, and the clearing patch the erasure itself filed.
    assert len(rows) == 2
    assert [row["redacted_at"] for row in rows] == [REDACTED_AT, REDACTED_AT]
    assert [row["before"] for row in rows] == [None, None]
