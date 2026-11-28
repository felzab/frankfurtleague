"""
API · a person's erasure, held against the whole database rather than against the steps

The person `tests/erasure_corpus.py` seeds holds a record of every kind the erasure takes, beside bystanders and
another mailbox at their local part. Every case asks what is left, so a step the erasure stops calling fails here.
"""

import logging
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.identity.crud import erase_the_pupil_in_session
from app.api.identity.services import build_erasure_pupil_pipeline, build_erasure_registrierung_pipeline
from app.api.registrierungen.person_router import admit
from app.api.registrierungen.schemas import FLRegistrierungAdmitPayload
from app.core.codes import Code
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db
from app.core.logging import JSONFormatter
from app.core.security import PASSKEY_FACTOR
from app.core.transactions import transaction_session
from tests import documents
from tests.acts import journal_records
from tests.app_client import app_client, app_under_test
from tests.config import ADMIN_KEY, ADMINISTRATORS, grants_for_the_suite
from tests.database import DOCUMENT_VALIDATION_FAILED, a_clean_database
from tests.documents import (
    SPIELER_TEXT_VERSIONS,
    aufstellung_document,
    bewerbung_document,
    kontakte_document,
    kontaktperson_document,
    new_schule_document,
    saison_document,
    saison_team_document,
    spiel_document,
    team_document,
)
from tests.erasure import erasure_collections, what_the_erasure_took
from tests.erasure_corpus import (
    BEWERBUNG_OID,
    BIRTH_DATE,
    BLOCKLESS_BEWERBUNG_OID,
    DECLINED_OID,
    ELSEWHERE,
    ELSEWHERE_GRANT_OID,
    ELSEWHERE_REFEREE_OID,
    ELSEWHERE_REGISTRATION_OID,
    ELSEWHERE_SEAT_ROW_OID,
    FIRST_NAME,
    HOME_TEAM_OID,
    IDENTIFIER,
    LAST_NAME,
    MOVING_PUPIL_CHANGE_OID,
    NOW,
    OTHER_CONFIRMATION_OID,
    OTHER_REFEREE_CHANGE_OID,
    OTHER_REPORT_OID,
    PATH,
    PAYMENT,
    PENDING_OID,
    PHONE,
    PUPIL_MOVING_ELSEWHERE_CHANGE_OID,
    PUPIL_OID,
    REFEREE_MOVING_ELSEWHERE_CHANGE_OID,
    REFEREE_OID,
    SAISON_ID,
    SPIELTAG_OID,
    TEAM_CONFIRMATION_OID,
    THEIR_CONFIRMATION_OID,
    THEIR_GRANT_OID,
    THEIR_KADER_ROW_OID,
    THEIR_REMARKS,
    THEIR_REPORT_OID,
    THEIR_VALUES,
    TYPED,
    YESTERDAY,
    a_grant,
    a_mail,
    a_person_holding_everything,
    a_registration,
    action_log_row,
    as_person,
    erased_by_the_handler,
    everything_in,
    pending_changes,
    referee,
    their_seat,
)
from tests.isolation import InterleavedCollection, outcome_of
from tests.records import record_collections
from tests.session_headers import StampedHeaders, actor_headers
from tests.stored import the_row
from tests.whole_database import where_folded_to, where_held, where_referenced
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_roles_erasure_test")

# The people beside them, each asserted still present: a step taking anybody else's record with theirs fails.
BYSTANDER_VALUES = ("Quillhilde", "Bramblewick", "Wraxlington", "kraus.bernd@example.com")
# The two of them seated beside the person on both a season row and an application, so each is counted, not only found.
SEATED_BESIDE_THEM = ("Quillhilde", "Bramblewick")

# Seeded by the one case that books them on a match still to come.
TO_COME_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607b00064")
THEIR_CHANGE_OID = ObjectId("6890a1b2c3d4e5f607b000c5")
# Every record of their own the erasure removes, each id looked for in the whole database afterwards: a reference left
# naming one names nobody.
THEIR_RECORDS = (PUPIL_OID, THEIR_KADER_ROW_OID, REFEREE_OID, PENDING_OID, DECLINED_OID, THEIR_CONFIRMATION_OID)


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def what_elsewhere_holds(database: AsyncDatabase) -> dict[str, int]:
    """Each record counted where it still names `ELSEWHERE`, beside the notices about its grant: one taken as the person's queues one."""

    changes = database[Collection.ADDRESS_CHANGES]

    return {
        "registration": await database[Collection.REGISTRIERUNGEN].count_documents({"_id": ELSEWHERE_REGISTRATION_OID, "email": ELSEWHERE}),
        "referee": await database[Collection.SCHIEDSRICHTER].count_documents({"_id": ELSEWHERE_REFEREE_OID, "kontakt.email": ELSEWHERE}),
        "seat": await database[Collection.SAISON_TEAMS].count_documents(
            {
                "_id": ELSEWHERE_SEAT_ROW_OID,
                "kontakte.ansprechperson.email": ELSEWHERE,
                "kontakte.ansprechperson.einwilligung.confirmed_at": {"$ne": None},
            }
        ),
        "grant": await database[Collection.GRANTS].count_documents({"_id": ELSEWHERE_GRANT_OID, "address": ELSEWHERE}),
        "notices": await database[Collection.OUTBOX].count_documents({"key": {"$regex": f"^grant/{ELSEWHERE_GRANT_OID}/"}}),
        "referee_change": await changes.count_documents({"_id": REFEREE_MOVING_ELSEWHERE_CHANGE_OID, "email": ELSEWHERE}),
        "pupil_change": await changes.count_documents({"_id": PUPIL_MOVING_ELSEWHERE_CHANGE_OID, "email": ELSEWHERE}),
    }


ELSEWHERE_HOLDS = {
    "registration": 1,
    "referee": 1,
    "seat": 1,
    "grant": 1,
    "notices": 0,
    "referee_change": 1,
    "pupil_change": 1,
}


async def on_a_league(url: str, body: Body, *, mutates_schema: bool = False) -> Any:
    """The shipped indexes, and the person seeded with their whole history.

    `mutates_schema=True` where the body installs a validator (`tests/database.py :: a_clean_database`).
    """

    async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
        await a_person_holding_everything(database)

        return await body(database, client)


def by_passkey(email: str) -> dict[str, str]:
    """An administrator erasing their own address, touched by passkey a second before, as `/erasure`'s prompt leaves them."""

    return {**ADMIN_KEY, **actor_headers(email, signed_in_before_s=1, factor=PASSKEY_FACTOR)}


async def erased_over_http(url: str, *, email: str = TYPED, headers: Mapping[str, str] | None = None) -> Any:
    async with app_client(url, app=app_under_test(DATABASE_NAME), now=NOW) as http:
        return await http.post(PATH, headers=headers or as_person(email))


async def erased_on_request(url: str, *, by: str) -> Any:
    """The administrator's route, as `by` presses it on a mailed request."""

    async with app_client(url, app=app_under_test(DATABASE_NAME), now=NOW) as http:
        return await http.post(
            "/api/identity/erasure",
            json={"email": TYPED, "reason": "Mail vom 30.03.2126, Betreff: Bitte löscht alle meine Daten"},
            headers=StampedHeaders(by, ADMIN_KEY),
        )


async def erased_as_a_pupil(database: AsyncDatabase, client: AsyncMongoClient, *, identifier: str = IDENTIFIER) -> Any:
    """The season-after rule's erasure of what `identifier` holds as a pupil, past its judgement, read by the erasure's selections."""

    collections = erasure_collections(database)

    async def erase(session: Any) -> Any:
        def read(collection: Any, pipeline: Any) -> Any:
            return aggregate_many_from_db(collection=collection, pipeline=pipeline, session=session)

        pupils = await read(collections.spieler_collection, build_erasure_pupil_pipeline(identifier))
        registrierungen = await read(collections.registrierungen_collection, build_erasure_registrierung_pipeline(identifier))

        return await erase_the_pupil_in_session(
            identifier, pupil=next(iter(pupils), None), registrierungen=registrierungen, collections=collections, now=NOW, session=session
        )

    async with transaction_session(client) as session:
        return await session.with_transaction(erase)


class TestNothingOfTheirsIsLeftAnywhere:
    """The witness for reach: the whole database read for what they held, each collection named where something survives.

    Their values case-blind, their address on the fold, and their records by id.
    """

    @pytest.mark.parametrize("holding_a_grant", [False, True], ids=["holding no grant", "holding an administration grant"])
    async def test_no_value_of_theirs_survives_and_every_bystanders_does(self, mongo_replica_set_url: str, holding_a_grant: bool):
        """Catches a step the erasure stops calling, or a store none reaches.

        Each value and id is asserted present first, so a seed that stopped writing one fails; the grant, where held, adds its
        rows and notice.
        """

        records = (*THEIR_RECORDS, *([THEIR_GRANT_OID] if holding_a_grant else []))

        async def scanned(database: AsyncDatabase, *values: str) -> tuple[dict[str, list[str]], list[str], dict[Any, list[str]]]:
            return (
                await where_held(database, *values, folded=True, beside=(ELSEWHERE,)),
                await where_folded_to(database, IDENTIFIER),
                await where_referenced(database, *records),
            )

        async def copies(database: AsyncDatabase) -> dict[str, int]:
            """How often each seat holder beside them is written, so one copy of two gone shows."""

            rendered = str([await database[name].find().to_list(length=None) for name in sorted(await database.list_collection_names())])

            return {value: rendered.casefold().count(value.casefold()) for value in SEATED_BESIDE_THEM}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if holding_a_grant:
                await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            before = await scanned(database, *THEIR_VALUES)
            bystanders = await copies(database)
            # A person signs in by code alone; the address holding a grant is an administrator's, who touches their passkey.
            response = await erased_over_http(mongo_replica_set_url, headers=by_passkey(TYPED) if holding_a_grant else None)

            return before, bystanders, response.status_code, await scanned(database, *THEIR_VALUES, *BYSTANDER_VALUES), await copies(database)

        (before, folded_before, ids_before), bystanders_before, status, (after, folded_after, ids_after), bystanders_after = await on_a_league(
            mongo_replica_set_url, body
        )

        assert all(before[value] for value in THEIR_VALUES), before
        assert folded_before and all(ids_before.values()), (folded_before, ids_before)
        assert status == 204
        assert {value: after[value] for value in THEIR_VALUES} == dict.fromkeys(THEIR_VALUES, [])
        # On the fold too, which reads a spelling no case-blind match does, whatever the local part spells.
        assert folded_after == []
        assert ids_after == dict.fromkeys(records, [])
        assert [value for value in BYSTANDER_VALUES if not after[value]] == []
        assert bystanders_after == bystanders_before


class TestWhatStandsBesideThem:
    """What the erasure must NOT take: each a row or a value somebody else holds."""

    async def test_their_confirmations_go_and_another_referees_stands(self, mongo_replica_set_url: str):
        """Catches a member keyed on the party's kind alone, taking another referee's row and reason with theirs."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)

            return [row["_id"] for row in await database[Collection.SPIELBESTAETIGUNGEN].find().sort("_id", 1).to_list(length=None)]

        assert await on_a_league(mongo_replica_set_url, body) == [OTHER_CONFIRMATION_OID, TEAM_CONFIRMATION_OID]

    async def test_the_reports_on_their_fixtures_stand(self, mongo_replica_set_url: str):
        """The report is the league's record of the match: it stays, its remarks with it, and it names no referee to take off it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)

            return [
                (row["_id"], row["bericht"]["remarks"])
                for row in await database[Collection.SPIELBERICHTE].find().sort("_id").to_list(length=None)
            ]

        assert await on_a_league(mongo_replica_set_url, body) == [(THEIR_REPORT_OID, THEIR_REMARKS), (OTHER_REPORT_OID, THEIR_REMARKS)]

    async def test_a_mailbox_sharing_their_local_part_keeps_every_record(self, mongo_replica_set_url: str):
        """Read before as well, so a seed that stopped writing a record fails rather than agreeing with the erasure on a zero."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await what_elsewhere_holds(database)
            await erased_over_http(mongo_replica_set_url)

            return before, await what_elsewhere_holds(database)

        assert await on_a_league(mongo_replica_set_url, body) == (ELSEWHERE_HOLDS, ELSEWHERE_HOLDS)


class TestOneTransaction:
    """A failure at a late write takes every step back: an erasure half done reports one that did not happen."""

    async def test_a_refused_last_write_leaves_a_match_to_come_as_it_stood(self, mongo_replica_set_url: str):
        """A validator installed here refuses the deletion's own row, written after every removing step.

        A match still to come loses its booking and its entry by writes a played one never meets; each of those outside the
        transaction would land though the erasure rolled back.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELE].insert_one(
                spiel_document(
                    spiel_id=TO_COME_SPIEL_OID,
                    saison_id=SAISON_ID,
                    spiel_nr=3,
                    spieltag_id=SPIELTAG_OID,
                    date="2126-04-22",
                    time="14:00:00",
                    schiedsrichter={"schiedsrichter_id": REFEREE_OID, "payment": PAYMENT},
                )
            )
            await database[Collection.AUFSTELLUNGEN].insert_one(
                aufstellung_document({"_id": TO_COME_SPIEL_OID, "saison_id": SAISON_ID}, HOME_TEAM_OID, starters=[PUPIL_OID])
            )
            await database.command(
                "collMod",
                Collection.ACTION_LOG.value,
                validator={"$jsonSchema": {"bsonType": "object", "properties": {"action": {"not": {"enum": ["erasure.own"]}}}}},
                validationLevel="strict",
            )

            with pytest.raises(OperationFailure) as failure:
                await erased_by_the_handler(database, client)

            return (
                failure.value.code,
                (await the_row(database, Collection.SPIELE, {"_id": TO_COME_SPIEL_OID}))["schiedsrichter"],
                [
                    entry["spieler_id"]
                    for entry in (await the_row(database, Collection.AUFSTELLUNGEN, {"spiel_id": TO_COME_SPIEL_OID}))["spieler"]
                ],
            )

        code, booking, line_up = await on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        assert code == DOCUMENT_VALIDATION_FAILED
        assert booking == {"schiedsrichter_id": REFEREE_OID, "payment": PAYMENT}
        assert line_up == [PUPIL_OID]


class TestTheMail:
    async def test_a_deletion_notice_stands_where_every_other_mail_to_the_address_goes(self, mongo_replica_set_url: str):
        """Catches the notice erased with the rest: the person would never hear of a deletion the league owes them word of."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.OUTBOX].insert_one(a_mail("deletion_notice", to=IDENTIFIER))
            await erased_over_http(mongo_replica_set_url)

            return [row["kind"] async for row in database[Collection.OUTBOX].find({"to": IDENTIFIER})]

        assert await on_a_league(mongo_replica_set_url, body) == ["deletion_notice"]


class TestTheJournal:
    @pytest.mark.parametrize("route", ["the person's own", "an administrator's"])
    async def test_one_line_per_erasure_names_its_records_by_id_and_no_address(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, route: str
    ):
        """Catches the line built from the wrong rows, or holding what it outlives: it stays in the stream after the person has gone.

        The administrator's route is the one the runbook's „Löschungen“ replays, for a person who cannot sign in.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            junction_row = await the_row(database, Collection.SAISON_TEAMS, {"team_id": HOME_TEAM_OID})
            mail = await the_row(database, Collection.OUTBOX, {"kind": "spiel_request"})
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": BLOCKLESS_BEWERBUNG_OID}, {"$set": {"kontakte.ansprechperson.einwilligung.confirmed_at": None}}
            )
            if route == "an administrator's":
                # Only an owner erases a grant holder's address.
                await database[Collection.GRANTS].insert_one(grants_for_the_suite()[0])
                response = await erased_on_request(mongo_replica_set_url, by=ADMINISTRATORS[0])
            else:
                response = await erased_over_http(mongo_replica_set_url, headers=by_passkey(TYPED))

            return response.status_code, junction_row["_id"], mail["_id"]

        with caplog.at_level(logging.INFO):
            status, team_row_id, mail_id = await on_a_league(mongo_replica_set_url, body)

        [record] = journal_records(caplog)
        line = vars(record)
        records = {
            f"{Collection.SCHIEDSRICHTER}/{REFEREE_OID}",
            f"{Collection.SPIELER}/{PUPIL_OID}",
            f"{Collection.REGISTRIERUNGEN}/{PENDING_OID}",
            f"{Collection.REGISTRIERUNGEN}/{DECLINED_OID}",
            f"{Collection.GRANTS}/{THEIR_GRANT_OID}",
        }
        # Each seat apart: its row holds other people, and a replay reading any other seat erases one of them. A confirmed
        # one carries its day, or a snapshot seating somebody else in the seat reads as this person.
        seats = {
            f"{Collection.SAISON_TEAMS}/{team_row_id}/ansprechperson/2126-03-21",
            f"{Collection.BEWERBUNGEN}/{BEWERBUNG_OID}/trainer/2126-03-21",
            f"{Collection.BEWERBUNGEN}/{BLOCKLESS_BEWERBUNG_OID}/ansprechperson",
        }
        # Another address's change stands here, never in `records`: read there, its `address` is that other person's.
        rows = {
            f"{Collection.ADDRESS_CHANGES}/{OTHER_REFEREE_CHANGE_OID}/email",
            f"{Collection.ADDRESS_CHANGES}/{MOVING_PUPIL_CHANGE_OID}/email",
            f"{Collection.OUTBOX}/{mail_id}/to",
        }

        assert status == 204
        assert (line["act"], set(line["records"]), line["choices"]) == ("erasure", records, [])
        assert (set(line["seats"]), set(line["rows"])) == (seats, rows)
        assert len(line["records"]) == len(records)
        assert not [value for value in THEIR_VALUES if value.lower() in JSONFormatter().format(record).lower()]

    async def test_a_log_row_naming_two_people_says_on_each_line_which_of_them_it_means(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """Read alike, a replay of the first line takes the second person's address off the row, and they asked for nothing."""

        acting, grantee = "ehemals.verwaltung@example.org", "gestoppt.verwaltung@example.org"
        log_row = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.ACTION_LOG].insert_one(action_log_row(log_row, by=acting, label=grantee))

            return [(await erased_over_http(mongo_replica_set_url, email=address)).status_code for address in (acting, grantee)]

        with caplog.at_level(logging.INFO):
            statuses = await on_a_league(mongo_replica_set_url, body)

        journal = journal_records(caplog)

        assert statuses == [204, 204]
        assert [vars(record)["rows"] for record in journal] == [
            [f"{Collection.ACTION_LOG}/{log_row}/by"],
            [f"{Collection.ACTION_LOG}/{log_row}/label"],
        ]
        # Neither address holds a record or a seat of its own, so each line names only the row, and never the address.
        assert [(vars(record)["records"], vars(record)["seats"]) for record in journal] == [([], []), ([], [])]
        assert [
            address for address, record in zip((acting, grantee), journal, strict=True) if address in JSONFormatter().format(record).lower()
        ] == []


class TestTheOwner:
    """`owner_erasure`: nobody but the owner names an owner, so the owner leaves by a handover alone."""

    async def test_the_owner_is_refused_and_nothing_is_written(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "owner")
            before = await everything_in(database)
            outcome = await outcome_of(erased_by_the_handler(database, client))

            return outcome, before == await everything_in(database)

        with caplog.at_level(logging.INFO):
            outcome, untouched = await on_a_league(mongo_replica_set_url, body)

        assert (outcome, untouched) == (Code.OWNER_ERASURE, True)
        assert not journal_records(caplog)


class TestTheScope:
    """The season-after rule's deletion takes a pupil's data alone, every other kind at the address standing."""

    async def test_the_pupil_scope_takes_what_the_address_holds_as_a_pupil_and_nothing_else(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            await erased_as_a_pupil(database, client)

            return (
                await database[Collection.SPIELER].count_documents({"_id": PUPIL_OID}),
                await database[Collection.REGISTRIERUNGEN].count_documents({"_id": {"$in": [PENDING_OID, DECLINED_OID]}}),
                (await the_row(database, Collection.SAISON_TEAMS, {}))["kontakte"]["ansprechperson"]["email"],
                await database[Collection.SCHIEDSRICHTER].count_documents({"_id": REFEREE_OID}),
                (await the_row(database, Collection.ADDRESS_CHANGES, {"_id": OTHER_REFEREE_CHANGE_OID}))["ended"] is None,
                await database[Collection.GRANTS].count_documents({"address": IDENTIFIER}),
                (await the_row(database, Collection.ADDRESS_CHANGES, {"_id": MOVING_PUPIL_CHANGE_OID}))["ended"] is None,
            )

        assert await on_a_league(mongo_replica_set_url, body) == (0, 0, IDENTIFIER, 1, True, 1, True)


# A second referee record at their address, booked on a fixture of its own: the address may hold several.
SECOND_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607b00023")
SECOND_REFEREE_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607b00063")


class TestEveryRecordOfAnArm:
    """An address may hold several records of one kind, and the erasure takes each.

    `test_identity_erasure_on_request.py` holds the preview's counts against what the erasure takes.
    """

    async def test_a_person_holding_two_referee_records_loses_both_and_neither_names_them_on_a_fixture(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            await database[Collection.SCHIEDSRICHTER].insert_one(
                referee(SECOND_REFEREE_OID, email=IDENTIFIER, name="Zorbanax Quillfeather II", kontakt={"phone": PHONE, "email": IDENTIFIER})
            )
            await database[Collection.SPIELE].insert_one(
                spiel_document(
                    spiel_id=SECOND_REFEREE_SPIEL_OID,
                    saison_id=SAISON_ID,
                    spiel_nr=3,
                    spieltag_id=SPIELTAG_OID,
                    # Still to come at `NOW`, where the first record's fixture was played.
                    date="2126-04-22",
                    time="14:00:00",
                    schiedsrichter={"schiedsrichter_id": SECOND_REFEREE_OID, "payment": PAYMENT},
                )
            )
            before = await everything_in(database)
            response = await erased_over_http(mongo_replica_set_url, headers=by_passkey(TYPED))
            return response.status_code, what_the_erasure_took(before, await everything_in(database))

        status, taken = await on_a_league(mongo_replica_set_url, body)

        assert status == 204
        # Two referee records, each booked once: the fixture still to come loses its booking, the played one keeps it
        # naming nobody.
        assert taken == {
            "spieler": 1,
            "schiedsrichter": 2,
            "kontakt_seats": 1,
            "bewerbung_seats": 2,
            "registrierungen": 2,
            "spiele": 1,
            "address_change": 2,
            "grants": 1,
        }


class TestTheChangeOfAPupilsAddress:
    async def test_a_pupils_erasure_changes_nothing_but_the_pupil_and_the_change_of_the_address_it_empties(self, mongo_replica_set_url: str):
        """Gwendolyn holds a pupil row alone, so the season's erasure of it leaves her change nothing to move.

        Catches a write past those two, such as one to the address's grants or mails, which the season's erasure never takes.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await everything_in(database)
            await erased_as_a_pupil(database, client, identifier="gwendolyn@example.com")
            after = await everything_in(database)

            changed = {name for name in before.keys() | after.keys() if before.get(name) != after.get(name)}

            return changed, await the_row(database, Collection.ADDRESS_CHANGES, {"_id": MOVING_PUPIL_CHANGE_OID})

        changed, change = await on_a_league(mongo_replica_set_url, body)

        assert changed == {str(Collection.SPIELER), str(Collection.ADDRESS_CHANGES)}
        # Its address on file goes too: no erasure of the address follows a pupil's to take it.
        assert (change["ended"]["kind"], change["address"], change["email"]) == ("discarded", None, None)

    async def test_a_pupils_erasure_leaves_the_change_of_an_address_still_holding_records(self, mongo_replica_set_url: str):
        """The person is a referee and a seat holder beside the pupil, so their change still has those to move."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await pending_changes(
                database, (THEIR_CHANGE_OID, IDENTIFIER, "neu.adresse@anderswo.example.net", "their-own-change", "2126-03-30")
            )
            await erased_as_a_pupil(database, client)

            return await the_row(database, Collection.ADDRESS_CHANGES, {"_id": THEIR_CHANGE_OID})

        change = await on_a_league(mongo_replica_set_url, body)

        assert (change["ended"], change["address"]) == (None, IDENTIFIER)


SEAT_HOLDER = "anna@example.com"


async def an_admittable_registration(database: AsyncDatabase) -> None:
    """The person holds nothing but a registration their team's seat holder can admit: the admission is what makes them a pupil."""

    await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
    await database[Collection.TEAMS].insert_one(team_document(HOME_TEAM_OID, "Heim-Schule", "HSX"))
    await database[Collection.SAISON_TEAMS].insert_one(
        saison_team_document(
            SAISON_ID,
            HOME_TEAM_OID,
            "Heim-Schule",
            "HSX",
            kontakte=kontakte_document(ansprechperson=kontaktperson_document("Anna", confirmed_at="2126-03-21")),
        )
    )
    await database[Collection.REGISTRIERUNGEN].insert_one(
        a_registration(
            PENDING_OID,
            IDENTIFIER,
            confirmed={
                "birth_date": BIRTH_DATE,
                "scope": "internal",
                "media": False,
                "text_versions": SPIELER_TEXT_VERSIONS,
                "today": YESTERDAY,
                "at": "2126-03-31T08:00:00+00:00",
            },
        )
    )


class TestAnAdmissionInsideTheErasure:
    """The subject is read inside the transaction's callback, so the retry a conflict forces re-reads what the rival wrote."""

    async def test_the_person_the_admission_made_does_not_survive_the_retry(self, mongo_replica_set_url: str):
        """Resolved outside the callback, the retry would erase the gone registration and leave the admitted pupil."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await an_admittable_registration(database)

            async def admission() -> None:
                await admit(
                    registrierung_id=PENDING_OID,
                    admit_data=FLRegistrierungAdmitPayload(spieler_id=None),
                    identifier=SEAT_HOLDER,
                    registrierungen_collection=database[Collection.REGISTRIERUNGEN],
                    saison_spieler_collection=database[Collection.SAISON_SPIELER],
                    saison_teams_collection=database[Collection.SAISON_TEAMS],
                    saisons_collection=database[Collection.SAISONS],
                    spieler_collection=database[Collection.SPIELER],
                    records=record_collections(database),
                    db=client,
                )

            # `registrierungen` as the erasure reads it, the admission committing at its first read.
            registrations = InterleavedCollection(database[Collection.REGISTRIERUNGEN], admission, before="aggregate")
            await erased_by_the_handler(database, client, registrierungen_collection=registrations)

            return (
                registrations,
                await database[Collection.SPIELER].count_documents({"email": IDENTIFIER}),
                await database[Collection.SAISON_SPIELER].count_documents({}),
                await database[Collection.REGISTRIERUNGEN].count_documents({}),
            )

        registrations, pupils, kader_rows, left = await on_a_league_of_its_own(mongo_replica_set_url, body)

        assert (pupils, kader_rows, left) == (0, 0, 0)
        # The premise last, so a stale subject fails on the pupil it left rather than on the count of reads.
        registrations.assert_landed_inside(serially=1)


async def on_a_league_of_its_own(url: str, body: Body) -> Any:
    """An empty league, the body seeding what it needs."""

    async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
        return await body(database, client)


class TestAPersonHoldingNoRole:
    """A mailbox whose records grant no panel still signs in, and is erased like anyone else."""

    @pytest.mark.parametrize("only", ["an application seat", "a confirmed pending registration"])
    async def test_their_one_record_goes(self, mongo_replica_set_url: str, only: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if only == "an application seat":
                await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
                await database[Collection.BEWERBUNGEN].insert_one(
                    bewerbung_document(
                        BEWERBUNG_OID,
                        SAISON_ID,
                        "submitted",
                        kontakte=kontakte_document(trainer=their_seat(), ansprechperson=kontaktperson_document("Quillhilde")),
                        submitted_at="2126-03-10",
                        schule=new_schule_document("Neue"),
                    )
                )
            else:
                await an_admittable_registration(database)

            response = await erased_over_http(mongo_replica_set_url)

            return response.status_code, await where_held(database, FIRST_NAME)

        status, held = await on_a_league_of_its_own(mongo_replica_set_url, body)

        assert (status, held) == (204, {FIRST_NAME: []})


class TestThePreview:
    """What the page shows before the press: every record of the person's own the erasure takes, by name, and no address or birthdate."""

    @pytest.mark.parametrize("admin_tier", ["owner", None])
    async def test_it_answers_the_tier_of_the_person_s_own_grant_and_no_other_s(self, mongo_replica_set_url: str, admin_tier: str | None):
        """The page draws its grant line from this: read null, a holder erases their administration unwarned."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if admin_tier is not None:
                await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, admin_tier)
            async with app_client(mongo_replica_set_url, app=app_under_test(DATABASE_NAME), now=NOW) as http:
                return (await http.get(f"{PATH}/view", headers=as_person(TYPED))).json()["admin_tier"]

        assert await on_a_league(mongo_replica_set_url, body) == admin_tier

    async def test_it_names_the_address_s_pupil_record_and_null_where_it_holds_none(self, mongo_replica_set_url: str):
        """The page names the pupil the press deletes from this: read null, a pupil erases their squad places unwarned."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async with app_client(mongo_replica_set_url, app=app_under_test(DATABASE_NAME), now=NOW) as http:
                return [(await http.get(f"{PATH}/view", headers=as_person(email))).json()["spieler"] for email in (TYPED, ELSEWHERE)]

        # `ELSEWHERE` holds a referee row, a seat and a registration of its own, and no pupil row.
        assert await on_a_league(mongo_replica_set_url, body) == [{"first_name": FIRST_NAME, "last_name": LAST_NAME}, None]

    async def test_it_counts_no_change_whose_link_has_not_reached_this_mailbox(self, mongo_replica_set_url: str):
        """A change still awaiting its address on file has told the new mailbox nothing, and the preview says nothing of it.

        Counted, the preview would tell the erased person that somebody typed their address; the press ends it all the same.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            asked_first = documents.address_change_document(
                address="noch.gefragt@example.com", email=IDENTIFIER, token_hash=None, day="2126-03-30", way="account"
            )
            await database[Collection.ADDRESS_CHANGES].insert_one(asked_first)
            async with app_client(mongo_replica_set_url, app=app_under_test(DATABASE_NAME), now=NOW) as http:
                preview = (await http.get(f"{PATH}/view", headers=as_person(TYPED))).json()["address_change"]

            before = await everything_in(database)
            await erased_by_the_handler(database, client)
            ended = what_the_erasure_took(before, await everything_in(database))["address_change"]
            return preview, ended, (await the_row(database, Collection.ADDRESS_CHANGES, {"_id": asked_first["_id"]}))["ended"]["kind"]

        # The seed's two changes alone; the press still ends all three, nothing of the asked one being this address's.
        assert await on_a_league(mongo_replica_set_url, body) == (2, 3, "discarded")
