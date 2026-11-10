import asyncio
import functools
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import Response
from pymongo import MongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.ban_list.services import compose_barred_until_saison_id
from app.api.bewerbungen.public_router import get_einwilligung_view, post_bewerbung
from app.api.bewerbungen.schemas import FLPostBewerbungPayload
from app.api.bewerbungen.services import OPEN_LINKS_PER_MAILBOX, build_key_filter, compose_kontakte
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.exceptions import APIError, DocumentNotFoundError
from app.main import create_app
from app.shared.schemas.bounds import BEWERBUNG_CONFIRMATION_DEADLINE_DAYS
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.schemas.literals import KONTAKT_ROLLEN
from app.shared.tokens import hash_token
from tests.app_client import app_client
from tests.config import BASE_AUTH, build_test_config
from tests.database import a_clean_database, a_clean_database_sync, on_the_seed_loop
from tests.documents import ADDRESS, ban_document, minted_confirmations, rules_document, saison_document, saison_team_document, team_document
from tests.holds import HoldsAfterItsLookup
from tests.outbox import MAIL_NOW, drained
from tests.worker import worker_database

# Module level, as `tests/api/test_bewerbung_triage_execution.py` marks its suite: every test below
# reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_bewerbung_submission_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
# Injected through `get_germany_now` for the cases driven over HTTP, so the day is not the wall clock.
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# Fixed rather than generated, so a failure names the same row every run.
EXISTING_OID = ObjectId("6890a1b2c3d4e5f607940001")
RETIRED_OID = ObjectId("6890a1b2c3d4e5f607940002")
ENTERED_OID = ObjectId("6890a1b2c3d4e5f607940003")
# A club no `teams` document holds, which is what a client sending an id it was never given looks like.
UNKNOWN_OID = ObjectId("6890a1b2c3d4e5f60794ffff")

EXISTING_NAME, EXISTING_SHORTHAND = "Adler", "ADX"
RETIRED_NAME, RETIRED_SHORTHAND = "Bieber", "BIX"
ENTERED_NAME, ENTERED_SHORTHAND = "Cassiopeia", "CAX"


OPEN_WINDOW: Mapping[str, Any] = {"open": True, "start": "2026-03-01", "end": "2026-04-30"}


def person(first_name: str, *, phone: str, email: str | None = None) -> dict[str, Any]:
    """One contact person as the PUBLIC form submits them: a consent of two fields, no stored scope or date, and no birthdate."""

    return {
        "first_name": first_name,
        "last_name": f"{first_name}-Mustermann",
        "email": email or f"{first_name.lower()}@example.com",
        "phone": phone,
    }


# Distinct on every field a rule compares, so a case moving one of them is the only thing under test.
KONTAKTE: Mapping[str, Any] = {
    "trainer": person("Wraxlington", phone="+49 170 1111111"),
    "ansprechperson": person("Quillhilde", phone="+49 170 2222222"),
    "stellvertretung": person("Bramblewick", phone="+49 170 3333333"),
    "trainer_is_also": None,
}


def club_document(team_id: ObjectId, name: str, shorthand: str, *, inactive_since: str | None = None) -> dict[str, Any]:
    return team_document(team_id, name, shorthand, schulform="gymnasium_g9", inactive_since=inactive_since)


def schule_block(**overrides: Any) -> dict[str, Any]:
    return {
        "team_name": "Zorbanax",
        "full_name": "Zorbanax-Gesamtschule",
        "schulform": "gesamtschule",
        "address": dict(ADDRESS),
        "website_url": "https://zorbanax.example.de",
        **overrides,
    }


def payload(**overrides: Any) -> dict[str, Any]:
    """A whole submission, valid, that each case moves one field of."""

    return {
        "saison_id": SAISON_ID,
        "team_id": str(EXISTING_OID),
        "schule": None,
        "kontakte": {seat: dict(value) if isinstance(value, dict) else value for seat, value in KONTAKTE.items()},
        "trikot": {"existing_set": "16 rote Trikots, Größe M", "wunschfarbe": "rot"},
        "kader": {"expected_size": 14, "good_spieler": 3},
        "stufengroesse": 90,
        **overrides,
    }


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, bewerbung: Any = OPEN_WINDOW, saison_status: str = "future") -> Any:
    """A clean database carrying the shipped indexes, so a duplicate production would refuse fails here too."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            saison = saison_document(
                SAISON_ID,
                saison_status,
                rules=rules_document(number_of_gruppen=2, teams_per_gruppe=2),
                bewerbung=None if bewerbung is None else dict(bewerbung),
            )
            await database[Collection.SAISONS].insert_one(saison)
            await database[Collection.TEAMS].insert_many(
                [
                    club_document(EXISTING_OID, EXISTING_NAME, EXISTING_SHORTHAND),
                    club_document(RETIRED_OID, RETIRED_NAME, RETIRED_SHORTHAND, inactive_since="2026-03-01"),
                    club_document(ENTERED_OID, ENTERED_NAME, ENTERED_SHORTHAND),
                ]
            )
            await database[Collection.SAISON_TEAMS].insert_one(saison_team_document(SAISON_ID, ENTERED_OID, ENTERED_NAME, ENTERED_SHORTHAND))

            return await body(database)

    return on_the_seed_loop(_run())


# A version-4 key, as `crypto.randomUUID()` mints one, fixed so a failure names the same press.
SCHLUESSEL = UUID("1b4e28ba-2fa1-4d2b-883f-0016d3cca427")


# Composed by the production helper rather than spelled, so a drifted bound cannot leave these cases passing over a lapsed row.
STANDING = compose_barred_until_saison_id(running_saison_id=SAISON_ID)


async def submit(database: AsyncDatabase, *, key: UUID | None = None, bewerbungen: Any = None, **overrides: Any) -> Any:
    """A fresh key per call unless the case names one, so every other case here is a first press."""

    return await post_bewerbung(
        bewerbung_data=FLPostBewerbungPayload.model_validate(payload(**overrides)),
        idempotency_key=key or uuid4(),
        bewerbungen_collection=bewerbungen if bewerbungen is not None else database[Collection.BEWERBUNGEN],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        outbox_collection=database[Collection.OUTBOX],
        mailbox_anchors_collection=database[Collection.MAILBOX_ANCHORS],
        db=database.client,
        today=TODAY,
        germany_now=MAIL_NOW,
    )


async def view(database: AsyncDatabase, token: str) -> Any:
    """What the confirmation page shows for this link."""

    return await get_einwilligung_view(
        view_data=FLTokenPayload(token=token),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        today=TODAY,
    )


class TestWhatASubmissionStores:
    """The document the shipped `$jsonSchema` accepts, which is the only shape the triage can then read."""

    def test_a_picked_club_is_stored_as_an_undecided_application(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Mapping[str, Any]:
            response = await submit(database)
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert stored is not None
            return stored

        stored = on_a_league(mongo_replica_set_url, body)

        assert stored["status"] == "submitted"
        assert stored["submitted_at"] == TODAY
        assert stored["team_id"] == EXISTING_OID
        assert stored["schule"] is None
        # Present and null, never absent: the record model requires the KEY, so an omitted one is a document the
        # read-back refuses.
        assert "decision" in stored and stored["decision"] is None

    def test_a_new_school_is_stored_with_no_club_named(self, mongo_replica_set_url: str):
        """The other branch: `schule` is the object and `team_id` the null."""

        async def body(database: AsyncDatabase) -> Mapping[str, Any]:
            response = await submit(database, team_id=None, schule=schule_block())
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert stored is not None
            return stored

        stored = on_a_league(mongo_replica_set_url, body)

        assert "team_id" in stored and stored["team_id"] is None
        assert "shorthand" not in stored["schule"]

    def test_each_consent_is_the_one_the_server_composed(self, mongo_replica_set_url: str):
        """The applicant supplied a wording version and a tick; the scope, the source, the day and the empty stamp are the league's.

        `administrativ` on every seat: nobody has confirmed yet.
        """

        async def body(database: AsyncDatabase) -> Mapping[str, Any]:
            response = await submit(database)
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert stored is not None
            return stored

        stored = on_a_league(mongo_replica_set_url, body)

        for seat in ("trainer", "ansprechperson", "stellvertretung"):
            # Born with the applicant's acknowledgement, naming the application as who seated the
            # person, and no evidence: no person has set a choice yet.
            assert stored["kontakte"][seat]["einwilligung"] == {
                "scope": "kontakt_data",
                "date": TODAY,
                "confirmed_at": None,
                "media": False,
                "entered_by": "bewerbung",
            }
            # The key is present and null, as `wunschgegner`'s is: the confirmation fills it.
            assert "birth_date" in stored["kontakte"][seat] and stored["kontakte"][seat]["birth_date"] is None

    def test_every_answer_is_stored_as_the_school_wrote_it(self, mongo_replica_set_url: str):
        """The document is spelled field by field, so an answer lost here is lost in silence."""

        answers = {
            "team_id": None,
            "schule": schule_block(),
            "trikot": {"existing_set": "12 blaue Trikots", "wunschfarbe": "blau"},
            "kader": {"expected_size": 17, "good_spieler": 5},
            "stufengroesse": 118,
            "wunschgegner": "Zorbanax-Gesamtschule",
        }

        async def body(database: AsyncDatabase) -> Mapping[str, Any]:
            response = await submit(database, **answers)
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert stored is not None
            return stored

        stored = on_a_league(mongo_replica_set_url, body)

        assert {field: stored[field] for field in answers} == answers


async def owed(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    """Every mail the Postausgang holds, by key, as owed: its recipient and its facts."""

    rows = await database[Collection.OUTBOX].find({}, {"_id": 0, "key": 1, "to": 1, "data": 1}).to_list(length=None)

    return sorted(rows, key=lambda row: str(row["key"]))


def deadline_from_today() -> str:
    return (date.fromisoformat(TODAY) + timedelta(days=BEWERBUNG_CONFIRMATION_DEADLINE_DAYS)).isoformat()


class TestWhatTheCreateOwes:
    """One mail a person in the create's own transaction, and no link before its hand-out: the inbox is the one place a raw token exists."""

    def test_each_person_is_owed_one_mail_and_no_seat_holds_a_link_yet(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            response = await submit(database)
            document = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert document is not None
            return response.created_id, document, await owed(database)

        created_id, document, mails = on_a_league(mongo_replica_set_url, body)

        deadline = deadline_from_today()
        stem = f"{Collection.BEWERBUNGEN}/{created_id}"
        assert mails == [
            {
                "key": f"{stem}/confirmation/stellvertretung",
                "to": KONTAKTE["stellvertretung"]["email"],
                "data": {
                    "kind": "bewerbung_confirmation",
                    "saison_id": SAISON_ID,
                    "schule": EXISTING_NAME,
                    "rollen": ["stellvertretung"],
                    "deadline": deadline,
                },
            },
            {
                "key": f"{stem}/confirmation/trainer",
                "to": KONTAKTE["trainer"]["email"],
                "data": {
                    "kind": "bewerbung_confirmation",
                    "saison_id": SAISON_ID,
                    "schule": EXISTING_NAME,
                    "rollen": ["trainer"],
                    "deadline": deadline,
                },
            },
            {
                "key": f"{stem}/received",
                "to": KONTAKTE["ansprechperson"]["email"],
                "data": {
                    "kind": "bewerbung_received",
                    "saison_id": SAISON_ID,
                    "rollen": ["ansprechperson"],
                    "pending": [
                        {"first_name": "Wraxlington", "rollen": ["trainer"]},
                        {"first_name": "Bramblewick", "rollen": ["stellvertretung"]},
                    ],
                    "deadline": deadline,
                },
            },
        ]
        for entry in document["confirmations"].values():
            assert (entry["token_hashes"], entry["sent_at"], entry["reminded_at"], entry["declined_at"]) == ([], TODAY, None, None)

    def test_each_handed_out_link_opens_its_seat_through_the_hashes_its_hand_out_minted(self, mongo_replica_set_url: str):
        """The link the drain sends is the one the confirmation page answers: the hand-out writes its hash where the lookup reads."""

        async def body(database: AsyncDatabase) -> Any:
            response = await submit(database)
            mails = await drained(database, database.client)
            views = {mail.to: await view(database, mail.token or "") for mail in mails}
            document = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert document is not None
            return mails, views, document

        mails, views, document = on_a_league(mongo_replica_set_url, body)

        assert len({mail.token for mail in mails}) == 3
        for seat in ("trainer", "ansprechperson", "stellvertretung"):
            [mail] = [mail for mail in mails if mail.to == KONTAKTE[seat]["email"]]
            assert mail.token is not None
            assert document["confirmations"][seat]["token_hashes"] == [hash_token(mail.token)]
            assert (views[mail.to].state, views[mail.to].rolle) == ("valid", seat)

    def test_each_seats_deadline_is_the_bound_counted_from_today(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            response = await submit(database)
            document = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert document is not None
            return {entry["deadline"] for entry in document["confirmations"].values()}, {
                mail["data"]["deadline"] for mail in await owed(database)
            }

        written, mailed = on_a_league(mongo_replica_set_url, body)

        assert written == mailed == {deadline_from_today()}


class TestTheSubmissionKey:
    """Over the shipped unique index."""

    def test_a_second_press_stores_no_second_application_and_answers_as_the_first(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            first = await submit(database, key=SCHLUESSEL)
            second = await submit(database, key=SCHLUESSEL)

            return first, second, await database[Collection.BEWERBUNGEN].count_documents({})

        first, second, stored = on_a_league(mongo_replica_set_url, body)

        assert (stored, second.created_id) == (1, first.created_id)

    def test_a_replay_owes_no_mail_the_first_press_owed(self, mongo_replica_set_url: str):
        """Each mail is keyed by the application and its person, so a press the route lost answers and owes nothing twice."""

        async def body(database: AsyncDatabase) -> Any:
            await submit(database, key=SCHLUESSEL)
            first = await owed(database)
            await submit(database, key=SCHLUESSEL)

            return first, await owed(database)

        first, after_the_replay = on_a_league(mongo_replica_set_url, body)

        assert len(first) == 3
        assert after_the_replay == first

    def test_a_replay_answers_after_the_window_has_closed(self, mongo_replica_set_url: str):
        """Looked up before every judgement: the first press arrived in time, and its answer does not expire with the window."""

        async def body(database: AsyncDatabase) -> Any:
            first = await submit(database, key=SCHLUESSEL)
            await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"bewerbung.open": False}})
            second = await submit(database, key=SCHLUESSEL)

            return first.created_id, second.created_id

        first, second = on_a_league(mongo_replica_set_url, body)

        assert first == second

    def test_applications_stored_without_a_key_neither_collide_nor_move(self, mongo_replica_set_url: str):
        """The partial filter: two keyless presses' rows would otherwise both index as null and collide."""

        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.BEWERBUNGEN].insert_many([_stored_application(), _stored_application()])
            before = await database[Collection.BEWERBUNGEN].find({}).sort("_id", 1).to_list(length=None)
            await submit(database, key=SCHLUESSEL)
            after = await database[Collection.BEWERBUNGEN].find({"idempotency_key": {"$exists": False}}).sort("_id", 1).to_list(length=None)

            return before, after, await database[Collection.BEWERBUNGEN].count_documents({})

        before, after, stored = on_a_league(mongo_replica_set_url, body)

        assert (after, stored) == (before, 3)

    def test_a_press_whose_lookup_ran_before_the_first_commit_is_answered_by_the_retry(self, mongo_replica_set_url: str):
        """Why no duplicate-key arm exists: the lookup opens the snapshot, and a later commit meets the anchors as a write conflict."""

        async def body(database: AsyncDatabase) -> Any:
            committed = asyncio.Event()
            held = HoldsAfterItsLookup(database[Collection.BEWERBUNGEN], committed)
            second = asyncio.create_task(submit(database, key=SCHLUESSEL, bewerbungen=held))
            await held.until_held(second)

            try:
                first = await submit(database, key=SCHLUESSEL)
            except BaseException:
                await held.abandon(second)
                raise
            committed.set()
            answered = await second

            return (
                first.created_id,
                answered.created_id,
                held.lookups,
                held.insert_failures,
                await database[Collection.BEWERBUNGEN].count_documents({}),
            )

        first, second, lookups, failures, stored = on_a_league(mongo_replica_set_url, body)

        assert (second, stored) == (first, 1)
        # `with_transaction` retries the anchors' `WriteConflict`, ahead of any insert: the second run's lookup finds the row.
        assert (lookups, failures) == (2, [])

    def test_the_lookup_the_endpoint_sends_is_the_one_its_index_serves(self, mongo_replica_set_url: str):
        """A bare equality scans the collection (`fl_backend/tests/core/test_constraints_execution.py`)."""

        async def body(database: AsyncDatabase) -> Any:
            # Set before the press, so the wrapper records the lookup and holds nothing back.
            committed = asyncio.Event()
            committed.set()
            held = HoldsAfterItsLookup(database[Collection.BEWERBUNGEN], committed)
            await submit(database, key=SCHLUESSEL, bewerbungen=held)

            return held.lookup_filters

        assert on_a_league(mongo_replica_set_url, body) == [build_key_filter(key=str(SCHLUESSEL))]


def refused(url: str, *, bewerbung: Any = OPEN_WINDOW, saison_status: str = "future", **overrides: Any) -> APIError:
    """One submission expected to be refused, with the exception it raised."""

    async def body(database: AsyncDatabase) -> APIError:
        with pytest.raises(APIError) as failure:
            await submit(database, **overrides)

        # Nothing was written: a refusal that stored the row anyway would be a 409 the applicant
        # could resend past, and a triage queue holding what the league said it would not take.
        assert await database[Collection.BEWERBUNGEN].count_documents({}) == 0

        return failure.value

    return on_a_league(url, body, bewerbung=bewerbung, saison_status=saison_status)


class TestTheRefusalsTheWritePathAnswers:
    """Each code, over a real database, so a refusal wired to no read is caught here rather than in production."""

    @pytest.mark.parametrize(
        "bewerbung",
        [
            pytest.param(None, id="no window recorded"),
            pytest.param({"open": True, "start": "2026-05-01", "end": "2026-05-31"}, id="a span this day is outside"),
        ],
    )
    def test_a_season_taking_no_applications_refuses(self, mongo_replica_set_url: str, bewerbung: Any):
        assert refused(mongo_replica_set_url, bewerbung=bewerbung).error_code == Code.BEWERBUNG_WINDOW_CLOSED

    def test_a_season_that_has_ended_refuses_while_its_window_still_runs(self, mongo_replica_set_url: str):
        """The payload names the season, so a `past` one whose stored window still runs is reachable by the form's own request."""

        assert refused(mongo_replica_set_url, saison_status="past").error_code == Code.BEWERBUNG_WINDOW_CLOSED

    def test_a_season_no_document_names_is_a_404(self, mongo_replica_set_url: str):
        """A 404 rather than `bewerbung_window_closed`: nothing was refused, the season the body names does not exist."""

        async def body(database: AsyncDatabase) -> None:
            with pytest.raises(DocumentNotFoundError):
                await submit(database, saison_id="1999")

        on_a_league(mongo_replica_set_url, body)

    @pytest.mark.parametrize(
        ("team_id", "schule"),
        [
            pytest.param(str(EXISTING_OID), schule_block(), id="both"),
            pytest.param(None, None, id="neither"),
        ],
    )
    def test_a_submission_naming_no_single_applicant_refuses(self, mongo_replica_set_url: str, team_id: Any, schule: Any):
        failure = refused(mongo_replica_set_url, team_id=team_id, schule=schule)

        assert failure.error_code == Code.BEWERBUNG_SUBMISSION_SUBJECT_UNRESOLVED

    @pytest.mark.parametrize(
        "team_id",
        [
            pytest.param(str(RETIRED_OID), id="a club that left the league"),
            pytest.param(str(UNKNOWN_OID), id="an id no club holds"),
        ],
    )
    def test_a_club_the_list_does_not_offer_refuses(self, mongo_replica_set_url: str, team_id: str):
        """The same code for both, so a client sending an id it was never given learns nothing about which."""

        assert refused(mongo_replica_set_url, team_id=team_id).error_code == Code.BEWERBUNG_PICKED_TEAM_UNUSABLE

    def test_a_club_already_playing_the_season_refuses(self, mongo_replica_set_url: str):
        assert refused(mongo_replica_set_url, team_id=str(ENTERED_OID)).error_code == Code.BEWERBUNG_PICKED_TEAM_ALREADY_ENTERED


# The HTTP surface, on a SECOND database: `build_test_config`'s, the one an app under test resolves
# its collections from. Seeded with pymongo, as `tests/api/test_spiele_public_read.py` seeds its own.
@dataclass(frozen=True)
class Submitted:
    """Everything a case below reads, gathered before the client that read it is closed."""

    response: Response
    stored: int


@functools.cache
def _served() -> FastAPI:
    """One app for every case serving through it: building one costs more than the request a case sends through it.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    return create_app(build_test_config())


def through_the_app(url: str, body: Mapping[str, Any], *, headers: Mapping[str, str] | None = None, key: str | None = None) -> Submitted:
    """One submission over the wire, so the guard, the actor binder and the response model all run."""

    database_name = build_test_config().db_base_name

    client = MongoClient(url)
    try:
        database = a_clean_database_sync(client, url, database_name)
        database[Collection.SAISONS].insert_one(
            saison_document(SAISON_ID, "future", rules=rules_document(number_of_gruppen=2, teams_per_gruppe=2), bewerbung=dict(OPEN_WINDOW))
        )
        database[Collection.TEAMS].insert_one(club_document(EXISTING_OID, EXISTING_NAME, EXISTING_SHORTHAND))

        async def _submitted() -> Response:
            async with app_client(url, app=_served(), now=NOW) as http:
                sent = dict(BASE_AUTH if headers is None else headers)
                sent["Idempotency-Key"] = key or str(uuid4())
                return await http.post(f"/api/v{API_VERSION}/bewerbungen", json=dict(body), headers=sent)

        response = asyncio.run(_submitted())

        # Read HERE: the client below is closed on the way out, and a handle returned through it
        # would be dead by the time a case touched it.
        return Submitted(
            response=response,
            stored=database[Collection.BEWERBUNGEN].count_documents({}),
        )
    finally:
        client.close()


class TestASubmissionMadeOverTheWire:
    """What calling the endpoint function directly cannot prove: the guard a real request meets."""

    def test_the_base_key_reaches_the_write(self, mongo_replica_set_url: str):
        """Also the floor under the two refusals below: without it each would pass on a write nothing reaches."""

        submitted = through_the_app(mongo_replica_set_url, payload())

        assert submitted.response.status_code == 201
        assert set(submitted.response.json()) == {"created_id"}
        assert submitted.stored == 1

    def test_no_key_reaches_none_of_it(self, mongo_replica_set_url: str):
        """Public here means no SESSION, never no key: a bearer token is checked before the body is parsed."""

        submitted = through_the_app(mongo_replica_set_url, payload(), headers={})

        assert submitted.response.status_code == 401
        assert submitted.stored == 0

    @pytest.mark.parametrize(
        "key",
        [
            pytest.param("not-a-uuid", id="not a uuid"),
            # Version 1, which carries its host's clock: a guessable key lets a stranger store other details under it first.
            pytest.param("6fa459ea-ee8a-11ca-8d6b-0800200c9a66", id="a time-based uuid"),
            # The IETF draft's structured-field string: the bare token is this API's form.
            pytest.param('"1b4e28ba-2fa1-4d2b-883f-0016d3cca427"', id="the draft's quoted form"),
        ],
    )
    def test_a_key_that_is_not_version_4_is_a_422_storing_nothing(self, mongo_replica_set_url: str, key: str):
        submitted = through_the_app(mongo_replica_set_url, payload(), key=key)

        assert submitted.response.status_code == 422
        assert submitted.stored == 0

    def test_a_repeated_contact_is_a_422_naming_its_box_and_storing_nothing(self, mongo_replica_set_url: str):
        """Named on the box the form marks, which the block's own validators cannot: the form holds no copy of the rule."""

        repeating = {**KONTAKTE, "stellvertretung": {**KONTAKTE["stellvertretung"], "email": KONTAKTE["trainer"]["email"].upper()}}

        submitted = through_the_app(mongo_replica_set_url, payload(kontakte=repeating))
        answer = submitted.response.json()

        assert (submitted.response.status_code, answer["error_code"]) == (422, Code.BEWERBUNG_KONTAKT_REPEATED)
        assert [field["path"] for field in answer["fields"]] == [["kontakte", "stellvertretung", "email"]]
        assert submitted.stored == 0


# `good_spieler` is non-nullable on every side, not the payload alone, so the stored shape is an int and no null.


def _parsed_kontakte() -> dict[str, Any]:
    """The three people as the payload leaves them, so only the `kader` below is under test."""

    return FLPostBewerbungPayload.model_validate(payload()).kontakte.model_dump(mode="json")


def _stored_application(**fields: Any) -> dict[str, Any]:
    """One application as a keyless submission stores it, `fields` laid over it."""

    return {
        "saison_id": SAISON_ID,
        "submitted_at": TODAY,
        "status": "submitted",
        "team_id": EXISTING_OID,
        "schule": None,
        "kontakte": compose_kontakte(kontakte=_parsed_kontakte(), today=TODAY),
        "trikot": {"existing_set": "16 rote Trikots", "wunschfarbe": "rot"},
        "kader": {"expected_size": 14, "good_spieler": 3},
        "stufengroesse": 96,
        "wunschgegner": None,
        "decision": None,
        "confirmations": minted_confirmations(
            hashes={seat: hash_token(seat) for seat in ("trainer", "ansprechperson", "stellvertretung")}, today=TODAY
        ),
        **fields,
    }


def naming(**addresses: str) -> dict[str, Any]:
    """`KONTAKTE` with these seats at these addresses."""

    return {**KONTAKTE, **{seat: {**KONTAKTE[seat], "email": address} for seat, address in addresses.items()}}


async def sent_days(database: AsyncDatabase, press: Any) -> dict[str, Any]:
    """Each seat's `sent_at` on the application this press stored."""

    stored = await database[Collection.BEWERBUNGEN].find_one({"_id": press.created_id})
    assert stored is not None

    return {seat: entry["sent_at"] for seat, entry in stored["confirmations"].items()}


class TestAMailboxPastTheBound:
    """One mailbox named on press after press: nothing refuses the press, and past the bound nothing more is owed that mailbox."""

    def test_the_press_past_the_bound_is_stored_and_owes_that_mailbox_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> tuple[int, int, dict[str, Any]]:
            for _ in range(OPEN_LINKS_PER_MAILBOX):
                await submit(database)
            mailed = len(await owed(database))
            press = await submit(database)

            return (
                await database[Collection.BEWERBUNGEN].count_documents({}),
                len(await owed(database)) - mailed,
                await sent_days(database, press),
            )

        stored, more, days = on_a_league(mongo_replica_set_url, body)

        assert (stored, more) == (OPEN_LINKS_PER_MAILBOX + 1, 0)
        assert days == dict.fromkeys(KONTAKT_ROLLEN)

    def test_a_seat_past_the_bound_leaves_the_applications_other_people_mailed(self, mongo_replica_set_url: str):
        """The school's other two are reached: only the crowded mailbox stands unmailed."""

        async def body(database: AsyncDatabase) -> tuple[list[str], dict[str, Any]]:
            for round_ in range(OPEN_LINKS_PER_MAILBOX):
                await submit(database, kontakte=naming(ansprechperson=f"a{round_}@example.com", stellvertretung=f"s{round_}@example.com"))
            mailed = {row["key"] for row in await owed(database)}
            press = await submit(database)

            return [row["to"] for row in await owed(database) if row["key"] not in mailed], await sent_days(database, press)

        addresses, days = on_a_league(mongo_replica_set_url, body)

        assert sorted(addresses) == [KONTAKTE["stellvertretung"]["email"], KONTAKTE["ansprechperson"]["email"]]
        assert days == {"trainer": None, "ansprechperson": TODAY, "stellvertretung": TODAY}

    def test_a_plus_tag_is_the_same_mailbox(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> dict[str, Any]:
            for tag in range(OPEN_LINKS_PER_MAILBOX):
                await submit(database, kontakte=naming(trainer=f"victim+{tag}@example.com"))

            return await sent_days(database, await submit(database, kontakte=naming(trainer="victim@example.com")))

        assert on_a_league(mongo_replica_set_url, body)["trainer"] is None

    def test_one_application_s_plus_tags_are_a_link_each(self, mongo_replica_set_url: str):
        """One press can owe one mailbox three mails, so a count of applications would let each press through on two or three."""

        async def body(database: AsyncDatabase) -> tuple[list[str], dict[str, Any]]:
            await submit(database, kontakte=naming(trainer="victim+1@example.com", ansprechperson="victim+2@example.com"))
            press = await submit(
                database,
                kontakte=naming(trainer="victim+3@example.com", ansprechperson="victim+4@example.com", stellvertretung="victim+5@example.com"),
            )

            return [row["to"] for row in await owed(database) if str(row["to"]).startswith("victim")], await sent_days(database, press)

        addresses, days = on_a_league(mongo_replica_set_url, body)

        assert len(addresses) == OPEN_LINKS_PER_MAILBOX
        assert days == {"trainer": TODAY, "ansprechperson": None, "stellvertretung": None}

    def test_a_pattern_s_character_in_an_address_is_that_character(self, mongo_replica_set_url: str):
        """An unescaped dot would fill the bounded read with its neighbours' rows, and `vic.tim@` would be mailed past its bound."""

        async def body(database: AsyncDatabase) -> dict[str, Any]:
            # Older and newer than the mailbox's own rows and sorting ahead of them, so the read meets one lot first in any order it takes.
            for address in ("vic-tim", "vic.tim", "vic_tim"):
                for _ in range(OPEN_LINKS_PER_MAILBOX):
                    await submit(database, kontakte=naming(trainer=f"{address}@example.com"))

            return await sent_days(database, await submit(database, kontakte=naming(trainer="vic.tim@example.com")))

        assert on_a_league(mongo_replica_set_url, body)["trainer"] is None

    def test_an_answered_link_frees_its_place(self, mongo_replica_set_url: str):
        """A mailbox that answers is nobody's target, however many schools it serves."""

        async def body(database: AsyncDatabase) -> dict[str, Any]:
            for _ in range(OPEN_LINKS_PER_MAILBOX):
                await submit(database)
            await database[Collection.BEWERBUNGEN].update_one({}, {"$set": {"kontakte.trainer.einwilligung.confirmed_at": TODAY}})

            return await sent_days(database, await submit(database))

        assert on_a_league(mongo_replica_set_url, body) == {"trainer": TODAY, "ansprechperson": None, "stellvertretung": None}

    def test_two_presses_at_once_stop_at_the_bound(self, mongo_replica_set_url: str):
        """The second read its count before the first committed, so only a conflict sends it back to the first's row.

        Tags of one mailbox, its documents gone as a mailbox's are after an hour, so the two meet on the insert and on one key.
        """

        def tagged(tag: Any) -> dict[str, Any]:
            # The other seats each its own, so the trainer's mailbox alone joins the two.
            return naming(trainer=f"victim+{tag}@example.com", ansprechperson=f"a{tag}@example.com", stellvertretung=f"s{tag}@example.com")

        async def body(database: AsyncDatabase) -> tuple[dict[str, Any], dict[str, Any]]:
            for tag in range(OPEN_LINKS_PER_MAILBOX - 1):
                await submit(database, kontakte=tagged(tag))
            await database[Collection.MAILBOX_ANCHORS].delete_many({})
            committed = asyncio.Event()
            held = HoldsAfterItsLookup(database[Collection.BEWERBUNGEN], committed)
            second = asyncio.create_task(submit(database, bewerbungen=held, kontakte=tagged("second")))
            await held.until_held(second)

            try:
                first = await submit(database, kontakte=tagged("first"))
            except BaseException:
                await held.abandon(second)
                raise
            committed.set()

            return await sent_days(database, first), await sent_days(database, await second)

        first, second = on_a_league(mongo_replica_set_url, body)

        assert first == dict.fromkeys(KONTAKT_ROLLEN, TODAY)
        assert second == {"trainer": None, "ansprechperson": TODAY, "stellvertretung": TODAY}

    def test_a_press_finding_the_mailbox_full_writes_no_document(self, mongo_replica_set_url: str):
        """A write would conflict with every rival, at one press a second a mailbox, and a flood's presses would fail a real school's."""

        async def body(database: AsyncDatabase) -> tuple[list[Mapping[str, Any]], list[Mapping[str, Any]]]:
            for _ in range(OPEN_LINKS_PER_MAILBOX):
                await submit(database)
            before = await database[Collection.MAILBOX_ANCHORS].find().sort("_id", 1).to_list(length=None)
            await submit(database)

            return before, await database[Collection.MAILBOX_ANCHORS].find().sort("_id", 1).to_list(length=None)

        before, after = on_a_league(mongo_replica_set_url, body)

        assert after == before
        assert before and not any("@" in row["_id"] for row in before)

    @pytest.mark.parametrize("answered_first", [True, False], ids=["the older rows answered", "the newer rows answered"])
    def test_answered_rows_hide_no_open_link(self, mongo_replica_set_url: str, answered_first: bool):
        """The read is bounded by what stands open, so answered rows cannot fill it and leave the press counting nothing."""

        async def body(database: AsyncDatabase) -> dict[str, Any]:
            for _ in range(2 * OPEN_LINKS_PER_MAILBOX):
                await submit(database)
            await database[Collection.BEWERBUNGEN].update_many({}, {"$set": {"confirmations.trainer.sent_at": TODAY}})
            ids = [row["_id"] async for row in database[Collection.BEWERBUNGEN].find({}, {"_id": 1}).sort("_id", 1)]
            answered = ids[:OPEN_LINKS_PER_MAILBOX] if answered_first else ids[OPEN_LINKS_PER_MAILBOX:]
            await database[Collection.BEWERBUNGEN].update_many(
                {"_id": {"$in": answered}}, {"$set": {"kontakte.trainer.einwilligung.confirmed_at": TODAY}}
            )

            return await sent_days(database, await submit(database))

        assert on_a_league(mongo_replica_set_url, body)["trainer"] is None

    @pytest.mark.parametrize("mailed_first", [True, False], ids=["the older rows mailed", "the newer rows mailed"])
    def test_rows_left_unmailed_hide_no_mailed_link(self, mongo_replica_set_url: str, mailed_first: bool):
        """The read is bounded by what was mailed, so a flood's stored rows cannot fill it ahead of the links that count."""

        async def body(database: AsyncDatabase) -> dict[str, Any]:
            for _ in range(2 * OPEN_LINKS_PER_MAILBOX):
                await submit(database)
            if not mailed_first:
                # As an administrator's sends leave them.
                ids = [row["_id"] async for row in database[Collection.BEWERBUNGEN].find({}, {"_id": 1}).sort("_id", 1)]
                await database[Collection.BEWERBUNGEN].update_many(
                    {"_id": {"$in": ids[:OPEN_LINKS_PER_MAILBOX]}}, {"$set": {"confirmations.trainer.sent_at": None}}
                )
                await database[Collection.BEWERBUNGEN].update_many(
                    {"_id": {"$in": ids[OPEN_LINKS_PER_MAILBOX:]}}, {"$set": {"confirmations.trainer.sent_at": TODAY}}
                )

            return await sent_days(database, await submit(database))

        assert on_a_league(mongo_replica_set_url, body)["trainer"] is None

    @pytest.mark.parametrize(
        "moved",
        [pytest.param({"status": "declined"}, id="an application decided"), pytest.param({"saison_id": "2025"}, id="another season's")],
    )
    def test_only_the_seasons_open_applications_count(self, mongo_replica_set_url: str, moved: dict[str, str]):
        """A school turned down applies again, and a person keeps their address from one season to the next."""

        async def body(database: AsyncDatabase) -> str:
            for _ in range(OPEN_LINKS_PER_MAILBOX):
                await submit(database)
            await database[Collection.BEWERBUNGEN].update_one({}, {"$set": moved})

            return (await sent_days(database, await submit(database)))["trainer"]

        assert on_a_league(mongo_replica_set_url, body) == TODAY


class TestABannedContactAddress:
    """A form takes a banned address and stores it; the mail does not leave."""

    def test_a_replay_after_an_address_was_banned_owes_nothing_and_the_banned_mail_is_held(self, mongo_replica_set_url: str):
        """The replay answers the stored application; the ban is the drain's to apply, to the mail the first press owed."""

        async def body(database: AsyncDatabase) -> Any:
            first = await submit(database, key=SCHLUESSEL)
            await database[Collection.BAN_LIST].insert_one(ban_document(KONTAKTE["stellvertretung"]["email"], until=STANDING))
            before = await database[Collection.BEWERBUNGEN].find_one({})
            second = await submit(database, key=SCHLUESSEL)
            after = await database[Collection.BEWERBUNGEN].find({}).to_list()
            sent = [mail.to for mail in await drained(database, database.client)]

            return first.created_id, second.created_id, before, after, sent

        first, second, before, after, sent = on_a_league(mongo_replica_set_url, body)

        assert (second, after) == (first, [before])
        assert sorted(sent) == sorted([KONTAKTE["trainer"]["email"], KONTAKTE["ansprechperson"]["email"]])
