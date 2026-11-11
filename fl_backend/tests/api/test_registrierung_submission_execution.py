import asyncio
import functools
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import Response
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import OPEN_LINKS_PER_MAILBOX, build_key_filter, days_after
from app.api.registrierungen.public_router import get_confirmation_view, post_invitation_view, post_registrierung
from app.api.registrierungen.schemas import FLPostRegistrierungPayload
from app.api.registrierungen.services import compose_confirmation_update
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.exceptions import APIError
from app.main import create_app
from app.shared.schemas.bounds import REGISTRIERUNG_CONFIRMATION_DEADLINE_DAYS
from app.shared.schemas.confirmation import FLTokenPayload
from tests import documents
from tests.app_client import app_client
from tests.config import BASE_AUTH, build_test_config
from tests.database import a_clean_database, on_the_seed_loop
from tests.holds import HoldsAfterItsLookup
from tests.outbox import MAIL_NOW, drained
from tests.worker import worker_database

# Module level: every case below reaches a real mongod, the write being one transaction.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_registrierung_submission_test")

CONFIG = build_test_config()
# The same settings against this suite's own database, for the cases a request reaches over the wire.
WIRE_CONFIG = CONFIG.model_copy(update={"db_base_name": DATABASE_NAME})

SAISON_ID = "2026"
# A century ahead of the real clock, every seeded day with it: the TTL monitor deletes a row whose delete date has passed,
# under a case reading it back.
TODAY = "2126-04-01"
# A pupil's answer to their link, as the confirmation writes it.
ANSWERED = compose_confirmation_update(
    **documents.registrierung_confirmed(
        birth_date="2009-05-04", today=TODAY, at=documents.confirmed_instant(TODAY), scope="kader_public", media=False
    )
)
# Every season's start unless a case says so: after `TODAY`, so an entry made today is an ordinary one.
AFTER_TODAY = "2126-04-20"
# `TODAY` as the wire's clock reads it, so a request over the wire is judged on the day a direct call is.
NOW = datetime(2126, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
# The deadline the submission stores, derived from the bound rather than spelled, so the case holds the
# submission to the bound whatever the bound reads.
DEADLINE = days_after(day=TODAY, days=REGISTRIERUNG_CONFIRMATION_DEADLINE_DAYS)

# Fixed rather than generated, so a failure names the same row every run.
TEAM_OID = ObjectId("6890a1b2c3d4e5f607960001")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607960002")
INVITATION_OID = ObjectId("6890a1b2c3d4e5f607960003")
OTHER_INVITATION_OID = ObjectId("6890a1b2c3d4e5f607960004")
REVOKED_INVITATION_OID = ObjectId("6890a1b2c3d4e5f607960005")

# The raw link values, which exist in the seed and in a recipient's inbox and nowhere else.
TOKEN = "hwGqQ4kP6yJr3VnZbT8sXeM2dLuF9aCwR1oY5iN7pKg"
OTHER_TOKEN = "3pLm9XqW2vTc7bYhK4sD8fRn6gJz1uE5aQoI0wN3yVt"
REVOKED_TOKEN = "Zt5rYb8nK2wQ7xM4jL9cV6sD1fH3gP0aU5eI7oT2mXk"

TEAM_NAME = "Zorbanax"
TEAM_FULL_NAME = "Zorbanax-Gesamtschule"
OTHER_TEAM_NAME = "Quillhilde"

PUPIL_EMAIL = "thessaly@beispielschule.de"
BANNED_EMAIL = "wraxlington@beispielschule.de"

OPEN_WINDOW: Mapping[str, Any] = {"open": True, "end": "2126-04-30"}
# Its `end` the day before `TODAY`, so an entry today is a nominee's.
PAST_WINDOW: Mapping[str, Any] = {"open": True, "end": "2126-03-31"}

RULES: Mapping[str, Any] = documents.rules_document(
    number_of_gruppen=2,
    teams_per_gruppe=2,
    max_kader_size=2,
    # Narrowed to two of the six, so a refusal is told from an accident.
    allowed_stufen=["Q1", "Q2"],
)


def club_document(team_id: ObjectId, name: str) -> dict[str, Any]:
    # `full_name` passed rather than defaulted: the invite's read answers it (`TEAM_FULL_NAME`).
    return documents.team_document(team_id, name, name[:3].upper(), full_name=f"{name}-Gesamtschule", schulform="gesamtschule")


def invitation_document(
    invitation_id: ObjectId, team_id: ObjectId, token: str, *, revoked_at: str | None = None, saison_id: str = SAISON_ID
) -> dict[str, Any]:
    return documents.invitation_document(invitation_id, saison_id=saison_id, team_id=team_id, token=token, revoked_at=revoked_at)


def payload(**overrides: Any) -> dict[str, Any]:
    """A whole registration, valid, that each case moves one field of."""

    return {
        "token": TOKEN,
        "first_name": "Thessaly",
        "last_name": "Okonkwo-Brandt",
        "email": PUPIL_EMAIL,
        "position": "Mittelfeld",
        "nummer": "17",
        "stufe": "Q1",
        **overrides,
    }


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def saison_document(saison_id: str, status: str, registrierung: Any) -> dict[str, Any]:
    return documents.saison_document(
        saison_id,
        status,
        start_date=AFTER_TODAY,
        rules=dict(RULES),
        bewerbung=None,
        registrierung=None if registrierung is None else dict(registrierung),
    )


def junction_document(saison_id: str, team_id: ObjectId, name: str) -> dict[str, Any]:
    return documents.saison_team_document(saison_id, team_id, name, name[:3].upper())


# Composed by the production helper rather than spelled: a hand-written bound that drifted from it
# would leave these cases passing over a lapsed row.


def on_a_league(
    url: str,
    body: Body,
    *,
    registrierung: Any = OPEN_WINDOW,
    squad: int = 0,
    saison_status: str = "active",
) -> Any:
    """A clean database carrying the shipped indexes, so a duplicate production would refuse fails here too.

    A junction row for the FIRST club alone, and a live invite for each: the second club's link is
    what makes the junction refusal reachable.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, saison_status, registrierung))
            await database[Collection.TEAMS].insert_many([club_document(TEAM_OID, TEAM_NAME), club_document(OTHER_TEAM_OID, OTHER_TEAM_NAME)])
            await database[Collection.SAISON_TEAMS].insert_one(junction_document(SAISON_ID, TEAM_OID, TEAM_NAME))
            await database[Collection.INVITATIONS].insert_many(
                [
                    invitation_document(INVITATION_OID, TEAM_OID, TOKEN),
                    invitation_document(OTHER_INVITATION_OID, OTHER_TEAM_OID, OTHER_TOKEN),
                    invitation_document(REVOKED_INVITATION_OID, TEAM_OID, REVOKED_TOKEN, revoked_at="2126-03-20"),
                ]
            )

            if squad:
                await database[Collection.SAISON_SPIELER].insert_many(
                    [
                        documents.saison_spieler_document(
                            ObjectId(), SAISON_ID, TEAM_OID, _id=ObjectId(), stufe="Q1", position="Abwehr", nummer=str(seat)
                        )
                        for seat in range(squad)
                    ]
                )

            return await body(database, client)

    return on_the_seed_loop(_run())


async def leave(database: AsyncDatabase) -> None:
    """The Austritt of the first club, whose link every case here presses."""

    await database[Collection.SAISON_TEAMS].update_one(
        {"saison_id": SAISON_ID, "team_id": TEAM_OID},
        {"$set": {"austritt": {"type": "rueckzug", "reason": "Mannschaft zurückgezogen", "date": TODAY}}},
    )


# A version-4 key, as `crypto.randomUUID()` mints one, fixed so a failure names the same press.
KEY = UUID("9c5b94b1-35ad-49bb-b118-8e8fc24abf80")


async def register(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    *,
    key: UUID | None = None,
    keyless: bool = False,
    registrierungen: Any = None,
    **overrides: Any,
) -> Any:
    """A fresh key per call unless the case names one or sends none, so every other case here is a first press."""

    return await post_registrierung(
        registrierung_data=FLPostRegistrierungPayload.model_validate(payload(**overrides)),
        idempotency_key=None if keyless else key or uuid4(),
        registrierungen_collection=registrierungen if registrierungen is not None else database[Collection.REGISTRIERUNGEN],
        invitations_collection=database[Collection.INVITATIONS],
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        outbox_collection=database[Collection.OUTBOX],
        mailbox_anchors_collection=database[Collection.MAILBOX_ANCHORS],
        db=client,
        today=TODAY,
        germany_now=MAIL_NOW,
    )


async def owed_of(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return [row async for row in database[Collection.OUTBOX].find().sort("_id", 1)]


async def view(database: AsyncDatabase, *, token: str = TOKEN) -> Any:
    return await post_invitation_view(
        view_data=FLTokenPayload(token=token),
        invitations_collection=database[Collection.INVITATIONS],
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        teams_collection=database[Collection.TEAMS],
        today=TODAY,
    )


async def rows_of(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return [row async for row in database[Collection.REGISTRIERUNGEN].find().sort("_id", 1)]


class TestWhatASubmissionStores:
    """The document the shipped `$jsonSchema` accepts, which is the only shape a later read can rely on."""

    def test_the_stored_key_set_is_exactly_the_declared_one(self, mongo_replica_set_url: str):
        """An EQUALITY, so a late-entry marker of either spelling fails here rather than riding along unnoticed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Mapping[str, Any]:
            await register(database, client)
            stored = await database[Collection.REGISTRIERUNGEN].find_one({})

            assert stored is not None
            return stored

        stored = on_a_league(mongo_replica_set_url, body)

        assert set(stored) == {
            "_id",
            "saison_id",
            "team_id",
            "invitation_id",
            "submitted_at",
            "status",
            "first_name",
            "last_name",
            "email",
            "position",
            "nummer",
            "stufe",
            "birth_date",
            "einwilligung",
            "confirmation",
            "decision",
            "idempotency_key",
        }

    def test_the_row_names_the_invite_the_team_and_the_season_it_was_opened_with(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Mapping[str, Any]:
            await register(database, client)
            stored = await database[Collection.REGISTRIERUNGEN].find_one({})

            assert stored is not None
            return stored

        stored = on_a_league(mongo_replica_set_url, body)

        assert stored["saison_id"] == SAISON_ID
        assert stored["team_id"] == TEAM_OID
        assert stored["invitation_id"] == INVITATION_OID
        assert stored["status"] == "submitted"
        assert stored["submitted_at"] == TODAY
        # Present and null, never absent: the confirmation fills the first two and a decline the third.
        assert stored["birth_date"] is None
        assert stored["einwilligung"] is None
        assert stored["decision"] is None

    def test_the_write_owes_one_confirmation_mail_whose_link_the_hand_out_mints(self, mongo_replica_set_url: str):
        """No token on the wire and no hash yet: the row's link lives where the owed mail names it, minted when it is sent."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await register(database, client)
            stored = await database[Collection.REGISTRIERUNGEN].find_one({})

            assert stored is not None
            return response, stored, await owed_of(database)

        response, stored, owed = on_a_league(mongo_replica_set_url, body)

        assert stored["confirmation"]["token_hashes"] == []
        assert stored["confirmation"]["sent_at"] == TODAY
        assert [(row["kind"], row["to"], row["reference"]["id"], row["link"]) for row in owed] == [
            (
                "registrierung_confirmation",
                PUPIL_EMAIL,
                response.registrierung_id,
                {"paths": ["confirmation.token_hashes"], "addresses": ["email"], "replaced": False},
            )
        ]
        # Off the invite, never off the body: the mail addresses the pupil by them.
        assert owed[0]["data"] == {"kind": "registrierung_confirmation", "team": TEAM_NAME, "saison_id": SAISON_ID}

    def test_the_link_the_hand_out_mints_opens_the_registration(self, mongo_replica_set_url: str):
        """The hash lands in the array the lookup reads, so the mailed link opens the row it was owed for."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await register(database, client)
            (mail,) = await drained(database, client)
            assert mail.token is not None

            return await get_confirmation_view(
                view_data=FLTokenPayload(token=mail.token),
                registrierungen_collection=database[Collection.REGISTRIERUNGEN],
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                teams_collection=database[Collection.TEAMS],
                today=TODAY,
            )

        assert on_a_league(mongo_replica_set_url, body).state == "valid"

    def test_the_deadline_is_the_bounds_own_days_after_the_mint(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await register(database, client)
            stored = await database[Collection.REGISTRIERUNGEN].find_one({})

            assert stored is not None
            return stored

        stored = on_a_league(mongo_replica_set_url, body)

        assert stored["confirmation"]["deadline"] == DEADLINE

    def test_neither_a_person_nor_a_squad_row_is_written(self, mongo_replica_set_url: str):
        """Nothing about a pending registration reaches the two collections an admission writes."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, int]:
            await register(database, client)

            return (
                await database[Collection.SPIELER].count_documents({}),
                await database[Collection.SAISON_SPIELER].count_documents({}),
            )

        assert on_a_league(mongo_replica_set_url, body) == (0, 0)


class TestTheSubmissionKey:
    """Over the shipped unique index and the submission's transaction."""

    def test_a_second_press_stores_no_second_row_owes_no_second_mail_and_answers_as_the_first(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await register(database, client, key=KEY)
            second = await register(database, client, key=KEY)

            return first, second, await rows_of(database), await owed_of(database)

        first, second, rows, owed = on_a_league(mongo_replica_set_url, body)

        assert len(rows) == 1
        assert second.registrierung_id == first.registrierung_id
        assert [row["kind"] for row in owed] == ["registrierung_confirmation"]

    def test_a_replay_answers_after_the_invite_was_revoked(self, mongo_replica_set_url: str):
        """Looked up before every judgement: the first press opened a live invite, and its answer outlives the revocation."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await register(database, client, key=KEY)
            await database[Collection.INVITATIONS].update_one({"_id": INVITATION_OID}, {"$set": {"revoked_at": TODAY}})
            second = await register(database, client, key=KEY)

            return first.registrierung_id, second.registrierung_id

        first, second = on_a_league(mongo_replica_set_url, body)

        assert first == second

    def test_registrations_stored_before_the_key_neither_collide_nor_move(self, mongo_replica_set_url: str):
        """The partial filter: two rows carrying no key would otherwise both index as null and collide."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await register(database, client)
            await register(database, client, email="zweite@beispielschule.de")
            await database[Collection.REGISTRIERUNGEN].update_many({}, {"$unset": {"idempotency_key": ""}})
            before = await rows_of(database)
            await register(database, client, key=KEY, email="dritte@beispielschule.de")
            after = [row for row in await rows_of(database) if "idempotency_key" not in row]

            return before, after

        before, after = on_a_league(mongo_replica_set_url, body)

        assert after == before and len(before) == 2

    def test_a_press_whose_lookup_ran_before_the_first_commit_is_answered_by_the_retry(self, mongo_replica_set_url: str):
        """Why no duplicate-key arm exists: the lookup opens the snapshot, and a later commit meets the mailbox's anchor as a write conflict."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            committed = asyncio.Event()
            held = HoldsAfterItsLookup(database[Collection.REGISTRIERUNGEN], committed)
            second = asyncio.create_task(register(database, client, key=KEY, registrierungen=held))
            await held.until_held(second)

            try:
                first = await register(database, client, key=KEY)
            except BaseException:
                await held.abandon(second)
                raise
            committed.set()

            return first.registrierung_id, (await second).registrierung_id, held.lookups, held.insert_failures, len(await rows_of(database))

        first, second, lookups, failures, stored = on_a_league(mongo_replica_set_url, body)

        assert (second, stored) == (first, 1)
        # `with_transaction` retries the anchor's `WriteConflict`, ahead of any insert: the second run's lookup finds the row.
        assert (lookups, failures) == (2, [])

    def test_the_lookup_the_endpoint_sends_is_the_one_its_index_serves(self, mongo_replica_set_url: str):
        """A bare equality scans the collection (`fl_backend/tests/core/test_constraints_execution.py`)."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # Set before the press, so the wrapper records the lookup and holds nothing back.
            committed = asyncio.Event()
            committed.set()
            held = HoldsAfterItsLookup(database[Collection.REGISTRIERUNGEN], committed)
            await register(database, client, key=KEY, registrierungen=held)

            return held.lookup_filters

        assert on_a_league(mongo_replica_set_url, body) == [build_key_filter(key=str(KEY))]

    def test_a_press_carrying_no_key_is_still_taken_and_stores_none(self, mongo_replica_set_url: str):
        """A page loaded before the form sent one: stored and mailed, unprotected, and outside the unique index."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answers = [await register(database, client, keyless=True), await register(database, client, keyless=True)]

            return answers, await rows_of(database), await owed_of(database)

        answers, rows, owed = on_a_league(mongo_replica_set_url, body)

        assert len({answer.registrierung_id for answer in answers}) == 2
        assert len(rows) == len(owed) == 2
        assert not any("idempotency_key" in row for row in rows)


@functools.cache
def _served() -> FastAPI:
    """One app for every case serving through it: building one costs more than the request a case sends through it.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    return create_app(WIRE_CONFIG)


async def over_the_wire(url: str, *, key: str | None) -> Response:
    """One registration as a request carries it, so the header is parsed as the route handler sends it; `None` sends none."""

    async with app_client(url, app=_served(), now=NOW) as http:
        sent = dict(BASE_AUTH) | ({} if key is None else {"Idempotency-Key": key})
        return await http.post(f"/api/v{API_VERSION}/registrierungen", json=payload(), headers=sent)


class TestTheKeyOverTheWire:
    """Judged where the header is parsed rather than handed in as a `UUID`."""

    def test_a_version_4_key_is_stored_as_sent(self, mongo_replica_set_url: str):
        """The floor under the refusals below: without it each would pass on a request nothing reaches."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await over_the_wire(mongo_replica_set_url, key=str(KEY))

            return response.status_code, [row.get("idempotency_key") for row in await rows_of(database)]

        assert on_a_league(mongo_replica_set_url, body) == (201, [str(KEY)])

    @pytest.mark.parametrize(
        "key",
        [
            pytest.param("not-a-uuid", id="not a uuid"),
            # Version 1, which carries its host's clock: a guessable key lets a stranger store other details under it first.
            pytest.param("6fa459ea-ee8a-11ca-8d6b-0800200c9a66", id="a time-based uuid"),
            # The IETF draft's structured-field string: the bare token is this API's form.
            pytest.param(f'"{KEY}"', id="the draft's quoted form"),
        ],
    )
    def test_a_key_that_is_not_version_4_is_a_422_storing_nothing(self, mongo_replica_set_url: str, key: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await over_the_wire(mongo_replica_set_url, key=key)

            return response.status_code, len(await rows_of(database))

        assert on_a_league(mongo_replica_set_url, body) == (422, 0)


class TestAMailboxPastTheBound:
    """One address typed through a link passed around: nothing refuses the press, and past the bound nothing more is owed that mailbox."""

    def test_the_press_past_the_bound_is_stored_and_owes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            for _ in range(OPEN_LINKS_PER_MAILBOX):
                await register(database, client)
            mailed = len(await owed_of(database))
            await register(database, client)
            rows = await rows_of(database)

            return len(rows), len(await owed_of(database)) - mailed, rows[-1]["confirmation"]

        stored, more, confirmation = on_a_league(mongo_replica_set_url, body)

        assert (stored, more) == (OPEN_LINKS_PER_MAILBOX + 1, 0)
        assert confirmation["sent_at"] is None

    def test_a_plus_tag_is_the_same_mailbox(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            for tag in range(OPEN_LINKS_PER_MAILBOX):
                await register(database, client, email=f"victim+{tag}@example.com")
            await register(database, client, email="victim@example.com")

            return (await rows_of(database))[-1]["confirmation"]["sent_at"]

        assert on_a_league(mongo_replica_set_url, body) is None

    def test_an_answered_link_frees_its_place(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            for _ in range(OPEN_LINKS_PER_MAILBOX):
                await register(database, client)
            await database[Collection.REGISTRIERUNGEN].update_one({}, ANSWERED)
            await register(database, client)

            return (await rows_of(database))[-1]["confirmation"]["sent_at"]

        assert on_a_league(mongo_replica_set_url, body) == TODAY

    def test_two_presses_at_once_stop_at_the_bound(self, mongo_replica_set_url: str):
        """The second read its count before the first committed, so only a conflict sends it back to the first's row.

        Tags of one mailbox, its document gone as a mailbox's is after an hour, so the two meet on the insert and on one key.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Any]:
            first, second_address = "victim+first@example.com", "victim+second@example.com"
            for tag in range(OPEN_LINKS_PER_MAILBOX - 1):
                await register(database, client, email=f"victim+{tag}@example.com")
            await database[Collection.MAILBOX_ANCHORS].delete_many({})
            committed = asyncio.Event()
            held = HoldsAfterItsLookup(database[Collection.REGISTRIERUNGEN], committed)
            second = asyncio.create_task(register(database, client, registrierungen=held, email=second_address))
            await held.until_held(second)

            try:
                await register(database, client, email=first)
            except BaseException:
                await held.abandon(second)
                raise
            committed.set()
            await second
            days = {row["email"]: row["confirmation"]["sent_at"] for row in await rows_of(database)}

            return [days[first], days[second_address]]

        assert on_a_league(mongo_replica_set_url, body) == [TODAY, None]

    def test_a_press_finding_the_mailbox_full_writes_no_document(self, mongo_replica_set_url: str):
        """A write would conflict with every rival, at one press a second a mailbox, and a flood's presses would fail a real pupil's."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[list[Mapping[str, Any]], list[Mapping[str, Any]]]:
            for _ in range(OPEN_LINKS_PER_MAILBOX):
                await register(database, client)
            before = await database[Collection.MAILBOX_ANCHORS].find().to_list(length=None)
            await register(database, client)

            return before, await database[Collection.MAILBOX_ANCHORS].find().to_list(length=None)

        before, after = on_a_league(mongo_replica_set_url, body)

        assert after == before
        assert before and not any("@" in row["_id"] for row in before)

    def test_rows_left_unmailed_hold_no_link(self, mongo_replica_set_url: str):
        """A flood's stored rows hold nothing of the mailbox once its mailed links are answered."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            for _ in range(2 * OPEN_LINKS_PER_MAILBOX):
                await register(database, client)
            await database[Collection.REGISTRIERUNGEN].update_many({"confirmation.sent_at": TODAY}, ANSWERED)
            await register(database, client)

            return (await rows_of(database))[-1]["confirmation"]["sent_at"]

        assert on_a_league(mongo_replica_set_url, body) == TODAY

    @pytest.mark.parametrize(
        "moved",
        [pytest.param({"status": "declined"}, id="a registration decided"), pytest.param({"saison_id": "2025"}, id="another season's")],
    )
    def test_only_the_seasons_open_registrations_count(self, mongo_replica_set_url: str, moved: dict[str, str]):
        """A team's decline leaves the pupil free to register again, and a person keeps their address from one season to the next."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            for _ in range(OPEN_LINKS_PER_MAILBOX):
                await register(database, client)
            await database[Collection.REGISTRIERUNGEN].update_one({}, {"$set": moved})
            await register(database, client)

            return (await rows_of(database))[-1]["confirmation"]["sent_at"]

        assert on_a_league(mongo_replica_set_url, body) == TODAY


class TestWhatASubmissionIsRefused:
    """Each refusal, storing nothing."""

    def test_a_revoked_link_is_refused_and_stores_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            with pytest.raises(APIError) as refused:
                await register(database, client, token=REVOKED_TOKEN)

            return refused.value.error_code, await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == (Code.DOCUMENT_NOT_FOUND, 0)

    def test_a_link_no_row_holds_is_refused_with_the_same_code(self, mongo_replica_set_url: str):
        """ONE answer for unknown and for revoked: nothing tells a stranger's guess from a replaced link."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(APIError) as refused:
                await register(database, client, token="notatokenanybodyeverminted1234567890abcdef")

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == Code.DOCUMENT_NOT_FOUND

    def test_a_shut_window_is_refused_and_stores_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            with pytest.raises(APIError) as refused:
                await register(database, client)

            return refused.value.error_code, await database[Collection.REGISTRIERUNGEN].count_documents({})

        outcome = on_a_league(mongo_replica_set_url, body, registrierung={**OPEN_WINDOW, "open": False})

        assert outcome == (Code.REGISTRIERUNG_CLOSED, 0)

    def test_a_season_that_has_ended_is_refused_while_its_dates_still_run(self, mongo_replica_set_url: str):
        """The window's end is still ahead and its link is not paused: only the season's status closes it, as minting the link already does."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            with pytest.raises(APIError) as refused:
                await register(database, client)

            return refused.value.error_code, await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body, saison_status="past") == (Code.REGISTRIERUNG_CLOSED, 0)

    def test_a_team_the_season_does_not_hold_is_refused(self, mongo_replica_set_url: str):
        """The second club's own live link, for a club with no junction row: the invite opens and the write refuses."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            with pytest.raises(APIError) as refused:
                await register(database, client, token=OTHER_TOKEN)

            return refused.value.error_code, await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == (Code.REGISTRIERUNG_CLOSED, 0)

    def test_a_stufe_the_season_does_not_offer_is_refused_and_stores_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            with pytest.raises(APIError) as refused:
                await register(database, client, stufe="E1")

            return refused.value.error_code, await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == (Code.REGISTRIERUNG_STUFE_NOT_ALLOWED, 0)

    def test_a_departed_team_s_link_stores_nothing(self, mongo_replica_set_url: str):
        """Refused as a dead link, ahead of the window: a squad grows no further once its club has left the season."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            await leave(database)
            with pytest.raises(APIError) as refused:
                await register(database, client)

            return refused.value.error_code, await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body, registrierung={**OPEN_WINDOW, "open": False}) == (Code.DOCUMENT_NOT_FOUND, 0)

    def test_a_nominee_is_taken_by_a_full_squad(self, mongo_replica_set_url: str):
        """Past the window's `end` the cap holds nobody, and the row counts neither way until a team admits it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await register(database, client)

            return await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body, registrierung=PAST_WINDOW, squad=RULES["max_kader_size"]) == 1

    def test_nominees_leave_the_cap_to_an_ordinary_entry(self, mongo_replica_set_url: str):
        """Counted, a late pupil would shut the link on a regular one, on the page and at the write alike."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[bool, int]:
            await database[Collection.SAISON_SPIELER].update_many({}, {"$set": {"is_nachnominiert": True}})
            answer = await view(database)
            await register(database, client)

            return answer.kader_free, await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body, squad=RULES["max_kader_size"]) == (True, 1)

    def test_a_full_squad_is_refused_and_stores_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            with pytest.raises(APIError) as refused:
                await register(database, client)

            return refused.value.error_code, await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body, squad=RULES["max_kader_size"]) == (Code.REGISTRIERUNG_KADER_FULL, 0)

    def test_a_retired_squad_row_gives_its_place_back(self, mongo_replica_set_url: str):
        """Counted as the squad editor counts: a player who left the squad is not holding a place."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await database[Collection.SAISON_SPIELER].update_one({}, {"$set": {"inactive_since": "2126-03-20"}})
            await register(database, client)

            return await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body, squad=RULES["max_kader_size"]) == 1

    def test_two_submissions_for_one_remaining_place_both_land(self, mongo_replica_set_url: str):
        """The declared race, pinned so a later reader does not read it as a defect.

        A registration writes into no collection the cap counts, so nothing anchors the count; the
        admission refuses the second.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await register(database, client)
            await register(database, client, email="quillhilde@beispielschule.de")

            return await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body, squad=RULES["max_kader_size"] - 1) == 2


class TestWhatTheInvitesOwnReadAnswers:
    """The read a link opens, which refuses only an invite that opens nothing."""

    def test_a_shut_window_is_a_state_rather_than_a_refusal(self, mongo_replica_set_url: str):
        """A link pasted after the deadline reads as closed rather than as invalid."""

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await view(database)

        answer = on_a_league(mongo_replica_set_url, run, registrierung={**OPEN_WINDOW, "open": False})

        assert answer.running is False

    def test_a_season_that_has_ended_reads_as_a_shut_window(self, mongo_replica_set_url: str):
        """The page renders `running` alone, so a `past` season answering true offers a form every submission of which is refused."""

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, bool]:
            answer = await view(database)

            return answer.saison_status, answer.running

        assert on_a_league(mongo_replica_set_url, run, saison_status="past") == ("past", False)

    def test_a_revoked_link_is_refused(self, mongo_replica_set_url: str):
        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(APIError) as refused:
                await view(database, token=REVOKED_TOKEN)

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, run) == Code.DOCUMENT_NOT_FOUND

    def test_the_nachnominierung_verdict_turns_on_the_windows_end(self, mongo_replica_set_url: str):
        """The page tells a pupil what an entry submitted today would store, off the season the read already holds."""

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> bool:
            return (await view(database)).nachnominierung

        assert on_a_league(mongo_replica_set_url, run, registrierung={**OPEN_WINDOW, "end": TODAY}) is False
        assert on_a_league(mongo_replica_set_url, run, registrierung=PAST_WINDOW) is True

    def test_a_link_past_the_windows_end_stays_open_to_a_full_squad(self, mongo_replica_set_url: str):
        """A nominee stands outside the cap, so a page reading the cap would shut the one way a late pupil has in."""

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[bool, bool]:
            answer = await view(database)

            return answer.running, answer.kader_free

        assert on_a_league(mongo_replica_set_url, run, registrierung=PAST_WINDOW, squad=RULES["max_kader_size"]) == (True, True)

    def test_a_departed_team_s_link_is_refused(self, mongo_replica_set_url: str):
        """A squad grows no further once its club has left, so the page opens as a dead link rather than as a form."""

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await leave(database)
            with pytest.raises(APIError) as refused:
                await view(database)

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, run) == Code.DOCUMENT_NOT_FOUND

    def test_a_team_the_season_does_not_hold_is_a_state_the_page_can_word(self, mongo_replica_set_url: str):
        """The second club's link opens: the read answers rather than refusing, and says the team is not entered.

        Without this the page renders a whole form whose every submission meets
        `registrierung_closed` after the pupil has typed their name and address.
        """

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[bool, bool]:
            entered = await view(database)
            not_entered = await view(database, token=OTHER_TOKEN)

            return entered.team_entered, not_entered.team_entered

        assert on_a_league(mongo_replica_set_url, run) == (True, False)

    def test_a_season_not_yet_activated_is_read_as_a_shut_window(self, mongo_replica_set_url: str):
        """The withheld-season guard is waived for the invite's read, and a link minted before the activation opens no form yet.

        Calling `resolve_public_saison` here would 404 the link; the invite is the authorisation instead.
        """

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, bool]:
            answer = await view(database)

            return answer.saison_status, answer.running

        assert on_a_league(mongo_replica_set_url, run, saison_status="future") == ("future", False)
