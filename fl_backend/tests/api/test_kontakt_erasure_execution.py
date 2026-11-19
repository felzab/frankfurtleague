from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identity.admin_router import get_erasure_view
from app.api.identity.schemas import FLErasureAddressPayload, FLErasureViewResponse
from app.api.identity.services import build_erasure_seat_pipeline
from app.api.kontakte.crud import erase_kontaktperson_in_session
from app.api.kontakte.services import build_clearing_update
from app.api.teams.schemas import FLSaisonTeamKontakte
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, patch_one_in_db
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier
from app.shared.schemas.literals import KONTAKT_SEATS
from app.shared.tokens import hash_token
from tests import documents
from tests.database import a_clean_database
from tests.documents import confirmed_kenntnisnahme, minted_confirmations
from tests.erasure import erased, seats_cleared
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_kontakt_erasure_test")

OPERATOR = "admin@frankfurtleague.de"


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
ERASED_PHONE = "+49 69 90009101"
ERASED_FORMER_PHONE = "+49 69 90009901"
ERASED_LAST_NAME = "Quastenflosser"

# The person beside them in the SAME block, whose record must survive untouched.
BYSTANDER_EMAIL = "ortwinia.pfeffernuss@example.com"
BYSTANDER_PHONE = "+49 69 90009202"
BYSTANDER_FORMER_PHONE = "+49 69 90009902"
BYSTANDER_LAST_NAME = "Pfeffernuss"

# The third slot, and the whole of the row that must not be reached at all.
UNREACHED_EMAIL = "baldur.krautzberger@example.com"
UNREACHED_PHONE = "+49 69 90009303"
UNREACHED_FORMER_PHONE = "+49 69 90009903"
UNREACHED_LAST_NAME = "Krautzberger"

# An address stored nowhere, for the no-op case.
UNKNOWN_EMAIL = "niemand.hierverzeichnet@example.com"

# The request the two tables below are erased with: the same mailbox as `ERASED_EMAIL`, in a spelling
# no seeded row holds. Nothing but the match's own keying (`app/shared/folding.py :: sign_in_identifier`)
# normalises it.
VARIANT_REQUEST_EMAIL = "Wiltrudis.Quastenflosser@EXAMPLE.COM"

# Addresses the same request must leave standing: another domain, and another local part.
OTHER_DOMAINS: tuple[str, ...] = ("wiltrudis.quastenflosser@example.org", "wiltrudis.quastenflosser@example.com.example")
OTHER_LOCAL_PARTS: tuple[str, ...] = ("nichtwiltrudis.quastenflosser@example.com", "wiltrudisXquastenflosser@example.com")
NEAR_MISSES: tuple[str, ...] = (*OTHER_DOMAINS, *OTHER_LOCAL_PARTS)

# One row holding the mailbox as a payload stores it, and one per near miss, ids fixed so a failure names the spelling.
MATCHED_ROW_OID = ObjectId("6890a1b2c3d4e5f607813000")
NEAR_ROW_OIDS = {email: ObjectId(f"6890a1b2c3d4e5f60781{4000 + index:04d}") for index, email in enumerate(NEAR_MISSES)}

NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))


# Every seeded person, by surname: the address that identifies them, the number they hold now, and
# the number an earlier write replaced. The replaced one lives in the LOG alone, which is the copy an
# erasure stopping at the collections leaves standing.
PEOPLE: dict[str, tuple[str, str, str]] = {
    ERASED_LAST_NAME: (ERASED_EMAIL, ERASED_PHONE, ERASED_FORMER_PHONE),
    BYSTANDER_LAST_NAME: (BYSTANDER_EMAIL, BYSTANDER_PHONE, BYSTANDER_FORMER_PHONE),
    UNREACHED_LAST_NAME: (UNREACHED_EMAIL, UNREACHED_PHONE, UNREACHED_FORMER_PHONE),
}

# Who stands in each slot of each seeded row, in `KONTAKT_SEATS` order, plus which seat the form said
# the Trainer also holds. Every case the erasure has to answer is one row here.
SEEDED_ROLES: dict[ObjectId, tuple[tuple[str, str, str], str | None]] = {
    # One slot naming the erased person, and two people beside them who asked for nothing.
    ROW_A_EARLIER_OID: ((ERASED_LAST_NAME, BYSTANDER_LAST_NAME, UNREACHED_LAST_NAME), None),
    # The same person a season later, and in TWO slots: `trainer_is_also` stores one
    # person twice, so clearing the first alone would leave this block naming them.
    ROW_A_LATER_OID: ((ERASED_LAST_NAME, ERASED_LAST_NAME, BYSTANDER_LAST_NAME), "ansprechperson"),
    # Nobody the erasure may reach.
    ROW_B_OID: ((UNREACHED_LAST_NAME, BYSTANDER_LAST_NAME, UNREACHED_LAST_NAME), None),
    # The second store this branch adds, with the person in a different slot than on the junction.
    BEWERBUNG_OID: ((BYSTANDER_LAST_NAME, ERASED_LAST_NAME, UNREACHED_LAST_NAME), None),
    OTHER_BEWERBUNG_OID: ((UNREACHED_LAST_NAME, BYSTANDER_LAST_NAME, UNREACHED_LAST_NAME), None),
}


def person(last_name: str, phone: str) -> dict[str, Any]:
    """Every field `app/api/teams/schemas.py :: FLKontaktperson` requires, all six of them present."""

    email, _, _ = PEOPLE[last_name]

    return {
        "first_name": "Vor" + last_name[:4],
        "last_name": last_name,
        "email": email,
        "phone": phone,
        "birth_date": "1979-03-14",
        "einwilligung": confirmed_kenntnisnahme(date="2026-01-05"),
    }


def blocks(*, live: bool) -> dict[ObjectId, dict[str, Any]]:
    """The five seeded blocks in one of their two states, keyed by the row that holds them.

    The two states differ in every telephone number and in nothing else.
    """

    phones = {last_name: (held if live else replaced) for last_name, (_, held, replaced) in PEOPLE.items()}

    return {
        row_id: {
            **{slot: person(last_name, phones[last_name]) for slot, last_name in zip(KONTAKT_SEATS, roles, strict=True)},
            "trainer_is_also": also,
        }
        for row_id, (roles, also) in SEEDED_ROLES.items()
    }


FORMER_BLOCKS = blocks(live=False)
LIVE_BLOCKS = blocks(live=True)

SAISON_TEAM_OIDS = (ROW_A_EARLIER_OID, ROW_A_LATER_OID, ROW_B_OID)
BEWERBUNG_OIDS = (BEWERBUNG_OID, OTHER_BEWERBUNG_OID)

# Which rows the erasure must reach, and which of their slots hold the person. Stated here so a failure
# names the expectation rather than a set computed beside the code under test.
ERASED_SEATS: dict[ObjectId, tuple[str, ...]] = {
    ROW_A_EARLIER_OID: ("trainer",),
    ROW_A_LATER_OID: ("trainer", "ansprechperson"),
    BEWERBUNG_OID: ("ansprechperson",),
}
ERASED_SEAT_COUNT = sum(len(seats) for seats in ERASED_SEATS.values())


def saison_team_document(row_id: ObjectId, saison_id: str, team_id: ObjectId) -> dict[str, Any]:
    return documents.saison_team_document(
        saison_id, team_id, "Testschule", "TSX", _id=row_id, trikot_farbe="blau", kontakte=FORMER_BLOCKS[row_id]
    )


# The three live links every seeded application carries, so an erasure has bookkeeping to reach.
# Minted as the shared application builder mints them, from this prefix on the submission's day.
LINK_PREFIX = "link"
CONFIRMATIONS = minted_confirmations(hashes={slot: hash_token(f"{LINK_PREFIX}-{slot}") for slot in KONTAKT_SEATS}, today="2026-01-05")


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


# Why a case stores seats the read-back refuses: a near miss the erasure must not reach is a spelling no fold holds.
UNFOLDED_ON_PURPOSE = "seats naming spellings no fold holds, which an erasure must miss"

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]

# Both collections keyed by `_id`, before the erasure and after: what most cases below read.
Snapshot = tuple[dict[Any, Mapping[str, Any]], dict[Any, Mapping[str, Any]]]


async def a_row_with_a_history(database: AsyncDatabase, collection: str, row_id: ObjectId) -> None:
    """Two writes over a seeded row: the first replaces the FORMER block, the second touches another field."""

    await patch_one_in_db(
        collection=database[collection],
        db_filter={"_id": row_id},
        update={"$set": {"kontakte": LIVE_BLOCKS[row_id]}},
        expected_version=None,
        session=None,
        return_document=ReturnDocument.BEFORE,
    )
    await patch_one_in_db(
        collection=database[collection],
        db_filter={"_id": row_id},
        update={"$set": {"gruppe": "B"}},
        expected_version=None,
        session=None,
        return_document=ReturnDocument.BEFORE,
    )


async def a_bewerbung_with_a_history(database: AsyncDatabase, row_id: ObjectId) -> None:
    """The junction's shape, with the second write over a field an application actually carries."""

    collection = database[Collection.BEWERBUNGEN]

    await patch_one_in_db(
        collection=collection,
        db_filter={"_id": row_id},
        update={"$set": {"kontakte": LIVE_BLOCKS[row_id]}},
        expected_version=None,
        session=None,
        return_document=ReturnDocument.BEFORE,
    )
    await patch_one_in_db(
        collection=collection,
        db_filter={"_id": row_id},
        update={"$set": {"kader.good_spieler": 4}},
        expected_version=None,
        session=None,
        return_document=ReturnDocument.BEFORE,
    )


async def on_a_league(url: str, body: Body, *, mutates_schema: bool = False, stores_a_refused_shape: str | None = None) -> Any:
    """The shipped support indexes, so a namespace a transaction cannot create is there.

    `mutates_schema=True` where the body plants a validator of its own to make one write fail, and `stores_a_refused_shape`
    where it stores an address no fold holds.
    """

    async with a_clean_database(
        url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema, stores_a_refused_shape=stores_a_refused_shape
    ) as (client, database):
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


async def call_erasure(database: AsyncDatabase, client: AsyncMongoClient, email: str = ERASED_EMAIL) -> None:
    await erased(database, client, email, germany_now=NOW)


async def call_view(database: AsyncDatabase, client: AsyncMongoClient, email: str = ERASED_EMAIL) -> FLErasureViewResponse:
    """The administrator's reveal of the address, whose seats are the erasure's own selection."""

    async with client.start_session(snapshot=True) as session:
        return await get_erasure_view(
            view_data=FLErasureAddressPayload(email=email),
            saison_teams_collection=database[Collection.SAISON_TEAMS],
            bewerbungen_collection=database[Collection.BEWERBUNGEN],
            schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
            spieler_collection=database[Collection.SPIELER],
            registrierungen_collection=database[Collection.REGISTRIERUNGEN],
            spiele_collection=database[Collection.SPIELE],
            grants_collection=database[Collection.GRANTS],
            address_changes_collection=database[Collection.ADDRESS_CHANGES],
            session=session,
            operator=OPERATOR,
            germany_now=NOW,
        )


async def stored_rows(database: AsyncDatabase) -> dict[Any, Mapping[str, Any]]:
    """Both collections keyed by `_id`, so a failing assertion names the row rather than a list position."""

    found: dict[Any, Mapping[str, Any]] = {}
    for collection in (Collection.SAISON_TEAMS, Collection.BEWERBUNGEN):
        for row in await database[collection].find().to_list(length=None):
            found[row["_id"]] = row

    return found


def a_block_holding(trainer: Mapping[str, Any]) -> dict[str, Any]:
    """One person in the Trainer slot, the other two empty, all four keys present."""

    return {**{slot: None for slot in KONTAKT_SEATS}, "trainer": dict(trainer), "trainer_is_also": None}


def a_junction_row(row_id: ObjectId, saison_id: str, block: Mapping[str, Any]) -> dict[str, Any]:
    """A valid `saison_teams` row carrying exactly this block, its own id standing in as `team_id`.

    Which is what lets a case seed as many rows as it likes under `uniq_saison_id_team_id`.
    """

    return documents.saison_team_document(saison_id, row_id, "Testschule", "TSX", _id=row_id, trikot_farbe="blau", kontakte=dict(block))


def a_row_naming(row_id: ObjectId, email: str) -> dict[str, Any]:
    """A junction row whose Trainer holds exactly this address, inserted straight past pydantic.

    Which is how an application reaches it in any case: `bewerbungen` has no create endpoint, so
    `bsonType: "string"` is all a stored address is held to. Laid over a row the builder answers, which refuses an
    address outside its fold, as the read-back does.
    """

    row = a_junction_row(row_id, LATER_SAISON, a_block_holding(person(UNREACHED_LAST_NAME, UNREACHED_PHONE)))

    return {**row, "kontakte": {**row["kontakte"], "trainer": {**row["kontakte"]["trainer"], "email": email}}}


async def after_erase_the_near_misses(url: str) -> Snapshot:
    """The seeded league plus the stored mailbox and its near misses, erased with an unfolded spelling of the mailbox."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SAISON_TEAMS].insert_many(
            [a_row_naming(row_id, email) for email, row_id in ((ERASED_EMAIL, MATCHED_ROW_OID), *NEAR_ROW_OIDS.items())]
        )
        before = await stored_rows(database)
        await call_erasure(database, client, VARIANT_REQUEST_EMAIL)

        return before, await stored_rows(database)

    return await on_a_league(url, body, stores_a_refused_shape=UNFOLDED_ON_PURPOSE)


async def after_erasure(url: str, email: str = ERASED_EMAIL) -> Snapshot:
    """Both collections before and after: one seeded database serves both."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        before = await stored_rows(database)
        await call_erasure(database, client, email)

        return before, await stored_rows(database)

    return await on_a_league(url, body)


class TestTheSlotsAreReadOffTheModel:
    """The spelling the write turns on, apart from a database."""

    def test_every_slot_the_model_declares_is_covered(self):
        """A role added to the block alone is cleared by nothing, and one added out of order is listed out of it."""

        declared = tuple(name for name in FLSaisonTeamKontakte.model_fields if name != "trainer_is_also")

        assert declared == KONTAKT_SEATS


# What a row holds where it carries no bookkeeping block, as a junction row does.
NO_BLOCK = "no bookkeeping block"


def emptied(block: Any, seats: tuple[str, ...]) -> Any:
    """A block with these seats emptied; one a row does not carry stays absent."""

    return block if block == NO_BLOCK else {**block, **{seat: None for seat in seats}}


@pytest.mark.db
async def test_the_erasure_empties_their_seats_and_links_and_nothing_else(mongo_replica_set_url: str):
    """Every seeded row after the erasure, against itself before with the person's own seats emptied."""

    before, after = await after_erasure(mongo_replica_set_url)

    assert before[BEWERBUNG_OID]["confirmations"] == CONFIRMATIONS, "the seed carries no links, so the links' assertion proves nothing"
    assert {row_id: row["kontakte"] for row_id, row in after.items()} == {
        row_id: emptied(row["kontakte"], ERASED_SEATS.get(row_id, ())) for row_id, row in before.items()
    }, (
        "the blocks: each seat the person held is emptied, and the people beside them, the rows that never named them "
        "and the form's own `trainer_is_also` stand"
    )
    assert {row_id: row.get("confirmations", NO_BLOCK) for row_id, row in after.items()} == {
        row_id: emptied(row.get("confirmations", NO_BLOCK), ERASED_SEATS.get(row_id, ())) for row_id, row in before.items()
    }, (
        "the links: each of the person's goes with them so it cannot confirm a seat naming nobody, every other seat's stands, "
        "and a junction row gains no bookkeeping block"
    )

    # As text, past the seats any filter names; a bystander's number is the floor under a database emptied wholesale.
    rendered = str(sorted(after.items(), key=lambda pair: str(pair[0])))
    assert [value for value in (ERASED_EMAIL, ERASED_PHONE, ERASED_LAST_NAME) if value in rendered] == [], "a value of theirs survives"
    assert BYSTANDER_PHONE in rendered, "the sweep would pass over a database emptied wholesale"


@pytest.mark.db
@pytest.mark.parametrize(
    ("their_day", "announced"),
    [pytest.param("2026-04-02", None, id="the earliest day goes with them"), pytest.param("2026-04-04", "2026-03-30", id="a later day")],
)
async def test_an_erasure_takes_the_notice_back_only_where_the_day_it_named_moves(
    mongo_replica_set_url: str, their_day: str, announced: str | None
):
    """A person told a day that has since moved is told again; a second notice for a day that stands announces one deletion twice."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.BEWERBUNGEN].update_one(
            {"_id": BEWERBUNG_OID},
            {
                "$set": {
                    "erasure_announced_at": "2026-03-30",
                    "kontakte.trainer.einwilligung.confirmed_at": None,
                    "kontakte.ansprechperson.einwilligung.confirmed_at": None,
                    "confirmations.trainer.deadline": "2026-04-03",
                    "confirmations.ansprechperson.deadline": their_day,
                }
            },
        )
        await call_erasure(database, client)

        return (await stored_rows(database))[BEWERBUNG_OID]

    assert (await on_a_league(mongo_replica_set_url, body))["erasure_announced_at"] == announced


def test_the_clearing_names_the_bookkeeping_only_where_told_to():
    """The pure half: a season row holding no block gets no key created."""

    assert build_clearing_update(("trainer",)) == {"$set": {"kontakte.trainer": None}}
    assert build_clearing_update(("trainer",), confirmations=True) == {"$set": {"kontakte.trainer": None, "confirmations.trainer": None}}


@pytest.mark.db
async def test_a_spelling_handed_in_unfolded_still_clears(mongo_replica_set_url: str):
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
            await erase_kontaktperson_in_session(
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                bewerbungen_collection=database[Collection.BEWERBUNGEN],
                spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                identifier=VARIANT_REQUEST_EMAIL,
                saison_team_rows=reached[Collection.SAISON_TEAMS],
                bewerbung_rows=reached[Collection.BEWERBUNGEN],
                session=session,
            )

        before = await stored_rows(database)
        async with transaction_session(client) as session:
            await session.with_transaction(in_session)

        return seats_cleared(before.values(), (await stored_rows(database)).values())

    assert await on_a_league(mongo_replica_set_url, body) == ERASED_SEAT_COUNT


@pytest.mark.db
async def test_an_address_naming_nobody_is_a_clean_no_op(mongo_replica_set_url: str):
    """Kills an erasure overwriting what the fold never judged."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await call_erasure(database, client, UNKNOWN_EMAIL)
        return await stored_rows(database)

    rows = await on_a_league(mongo_replica_set_url, body)

    assert all(rows[row_id]["kontakte"] == LIVE_BLOCKS[row_id] for row_id in (*SAISON_TEAM_OIDS, *BEWERBUNG_OIDS))


@pytest.mark.db
async def test_an_address_asked_unfolded_clears_its_stored_fold_and_no_near_miss(mongo_replica_set_url: str):
    """Another mailbox keeps its seat and adds nothing to the count; the asked spelling's fold is what meets the stored one."""

    before, rows = await after_erase_the_near_misses(mongo_replica_set_url)
    cleared = [email for email, row_id in NEAR_ROW_OIDS.items() if rows[row_id]["kontakte"]["trainer"] is None]

    assert cleared == [], "the match reached an address that is not this person"
    assert rows[MATCHED_ROW_OID]["kontakte"]["trainer"] is None, "the unfolded request missed the stored fold"
    assert seats_cleared(before.values(), rows.values()) == ERASED_SEAT_COUNT + 1, "a seat that is somebody else's was cleared"


# Two domains to the sign-in fold, so two people an application may seat side by side.
SHARP_S_EMAIL = "wiltrudis.quastenflosser@straße.example.org"
DOUBLE_S_EMAIL = "wiltrudis.quastenflosser@strasse.example.org"
SHARP_S_ROW_OID = ObjectId("6890a1b2c3d4e5f607816001")

HAND_EDITED_ROW_OID = ObjectId("6890a1b2c3d4e5f607816002")


@pytest.mark.db
async def test_erase_one_of_two_people_parted_by_sharp_s_leaves_the_other_seated(mongo_replica_set_url: str):
    """A fold wider than sign-in's clears the second person's seat on the first person's request."""

    block = {
        **a_block_holding({**person(UNREACHED_LAST_NAME, UNREACHED_PHONE), "email": SHARP_S_EMAIL}),
        "ansprechperson": {**person(BYSTANDER_LAST_NAME, BYSTANDER_PHONE), "email": DOUBLE_S_EMAIL},
    }

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SAISON_TEAMS].insert_one(a_junction_row(SHARP_S_ROW_OID, LATER_SAISON, block))
        await call_erasure(database, client, DOUBLE_S_EMAIL)

        return (await stored_rows(database))[SHARP_S_ROW_OID]["kontakte"]

    kontakte = await on_a_league(mongo_replica_set_url, body)

    assert (kontakte["trainer"] is not None, kontakte["ansprechperson"]) == (True, None)


@pytest.mark.db
@pytest.mark.parametrize(
    "stored",
    [
        pytest.param("jürgen@schule.example.org", id="an umlaut in the local part"),
        # Built from its code point: it renders like the ASCII stop.
        pytest.param(f"anna{chr(0xFF0E)}@schule.example.org", id="a full-width stop in the local part"),
        pytest.param("anna..mueller@schule.example.org", id="an address the installed EmailStr refuses"),
    ],
)
async def test_a_seat_stored_under_an_address_no_payload_takes_now_is_erased(mongo_replica_set_url: str, stored: str):
    """GDPR Art. 17: a row edited by hand past the address rule still names a person, so the lookup holds the request to no rule."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SAISON_TEAMS].insert_one(a_row_naming(HAND_EDITED_ROW_OID, stored))
        await call_erasure(database, client, stored)

        return (await stored_rows(database))[HAND_EDITED_ROW_OID]["kontakte"]["trainer"]

    assert await on_a_league(mongo_replica_set_url, body) is None


@pytest.mark.db
async def test_the_reveal_lists_exactly_the_seats_the_erasure_then_clears(mongo_replica_set_url: str):
    """What one matcher buys: a confirmation naming a different set from the one the write reaches is worse than none."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        view, before = await call_view(database, client), await stored_rows(database)
        await call_erasure(database, client)
        return view, seats_cleared(before.values(), (await stored_rows(database)).values())

    view, cleared = await on_a_league(mongo_replica_set_url, body)
    named = view.kontakt_seats + view.bewerbung_seats

    # Against the table above as well as the count: two figures agreeing on zero agree on nothing.
    assert named == ERASED_SEAT_COUNT
    assert named == cleared
