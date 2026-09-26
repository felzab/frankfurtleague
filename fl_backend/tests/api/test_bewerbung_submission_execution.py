import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from httpx2 import Response
from pymongo import MongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.bewerbungen import services
from app.api.bewerbungen.public_router import post_bewerbung
from app.api.bewerbungen.router import get_bewerbung_by_id
from app.api.bewerbungen.schemas import FLBewerbung, FLPostBewerbungPayload
from app.api.bewerbungen.services import (
    BEWERBUNG_FASSUNG_VERALTET,
    BEWERBUNG_FENSTER_GESCHLOSSEN,
    BEWERBUNG_LAUFENDE_FASSUNG,
    BEWERBUNG_PICKED_CLUB_ALREADY_ENTERED,
    BEWERBUNG_PICKED_CLUB_UNUSABLE,
    BEWERBUNG_SCHLUESSEL_ABWEICHEND,
    BEWERBUNG_SHORTHAND_TAKEN,
    BEWERBUNG_SUBMISSION_SUBJECT_UNRESOLVED,
    build_schluessel_filter,
    compose_decline_update,
    compose_kontakte,
    hash_token,
)
from app.api.kontakte.services import build_clearing_update
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.exception_handlers import PAYLOAD_REFUSED
from app.core.exceptions import DocumentNotFoundException, WriteRefusalException
from app.core.recording import PUBLIC_ACTOR_EMAIL
from app.core.security import ACTOR_HEADER
from app.shared.schemas.bounds import BEWERBUNG_BESTAETIGUNG_FRIST_TAGE
from tests.app_client import app_client
from tests.config import BASE_AUTH, build_test_config
from tests.database import DOCUMENT_VALIDATION_FAILED, a_clean_database, a_clean_database_sync, on_the_seed_loop
from tests.documents import ADDRESS, rules_document, saison_document, saison_team_document, team_document
from tests.holds import HoldsAfterItsLookup
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

EXISTING_NAME, EXISTING_SHORTHAND = "Adler", "AD"
RETIRED_NAME, RETIRED_SHORTHAND = "Bieber", "BI"
ENTERED_NAME, ENTERED_SHORTHAND = "Cassiopeia", "CA"

# Free, unlike `EXISTING_SHORTHAND`, which `uniq_shorthand` already holds.
NEW_SCHOOL_SHORTHAND = "ZX"

OPEN_WINDOW: Mapping[str, Any] = {"offen": True, "von": "2026-03-01", "bis": "2026-04-30"}


def person(vorname: str, *, telefon: str, email: str | None = None) -> dict[str, Any]:
    """One contact person as the PUBLIC form submits them: a consent of two fields, no stored scope or date, and no birthdate."""

    return {
        "vorname": vorname,
        "nachname": f"{vorname}-Mustermann",
        "email": email or f"{vorname.lower()}@example.com",
        "telefon": telefon,
        "einwilligung": {"text_version": BEWERBUNG_LAUFENDE_FASSUNG, "erteilt": True},
    }


# Distinct on every field a rule compares, so a case moving one of them is the only thing under test.
KONTAKTE: Mapping[str, Any] = {
    "trainer": person("Wraxlington", telefon="+49 170 1111111"),
    "ansprechperson": person("Quillhilde", telefon="+49 170 2222222"),
    "stellvertretung": person("Bramblewick", telefon="+49 170 3333333"),
    "trainer_ist_zugleich": None,
}


# A label the registry still resolves, as a page loaded under the build before the running one stamps it.
EARLIER_FASSUNG = "2026-09-bestaetigung-4"


def kontakte_labelled(text_version: str) -> dict[str, Any]:
    """`KONTAKTE` with every seat naming `text_version`."""

    return {
        seat: {**value, "einwilligung": {**value["einwilligung"], "text_version": text_version}} if isinstance(value, dict) else value
        for seat, value in KONTAKTE.items()
    }


def club_document(team_id: ObjectId, name: str, shorthand: str, *, inactive_since: str | None = None) -> dict[str, Any]:
    return team_document(team_id, name, shorthand, schulform="gymnasium_g9", inactive_since=inactive_since)


def schule_block(**overrides: Any) -> dict[str, Any]:
    return {
        "team_name": "Zorbanax",
        "full_name": "Zorbanax-Gesamtschule",
        "shorthand": NEW_SCHOOL_SHORTHAND,
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
        "trikot": {"vorhandener_satz": "16 rote Trikots, Größe M", "wunschfarbe": "rot"},
        "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
        "stufengroesse": 90,
        **overrides,
    }


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, bewerbung: Any = OPEN_WINDOW, saison_status: str = "future") -> Any:
    """The SHIPPED validators and indexes, so a document production would refuse fails here too."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            saison = saison_document(
                SAISON_ID,
                saison_status,
                rules=rules_document(number_of_groups=2, teams_per_group=2),
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


async def submit(database: AsyncDatabase, *, schluessel: UUID | None = None, bewerbungen: Any = None, **overrides: Any) -> Any:
    """A fresh key per call unless the case names one, so every other case here is a first press."""

    return await post_bewerbung(
        bewerbung_data=FLPostBewerbungPayload.model_validate(payload(**overrides)),
        idempotency_key=schluessel or uuid4(),
        bewerbungen_collection=bewerbungen if bewerbungen is not None else database[Collection.BEWERBUNGEN],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        db=database.client,
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

        assert stored["status"] == "eingereicht"
        assert stored["eingereicht_am"] == TODAY
        assert stored["team_id"] == EXISTING_OID
        assert stored["schule"] is None
        # Present and null, never absent: `required` in the validator means the KEY is there, so an
        # omitted null is a rejection rather than a stored null.
        assert "entscheidung" in stored and stored["entscheidung"] is None

    def test_a_new_school_is_stored_with_no_club_named(self, mongo_replica_set_url: str):
        """The other branch, which the validator types differently: `schule` is the object and `team_id` the null."""

        async def body(database: AsyncDatabase) -> Mapping[str, Any]:
            response = await submit(database, team_id=None, schule=schule_block())
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert stored is not None
            return stored

        stored = on_a_league(mongo_replica_set_url, body)

        assert "team_id" in stored and stored["team_id"] is None
        assert stored["schule"]["shorthand"] == NEW_SCHOOL_SHORTHAND

    def test_each_consent_is_the_one_the_server_composed(self, mongo_replica_set_url: str):
        """The applicant supplied a wording version and a tick; the scope, the source, the day and the empty stamp are the league's.

        `administrativ` on every seat, the shipped validator accepting it: nobody has confirmed yet.
        """

        async def body(database: AsyncDatabase) -> Mapping[str, Any]:
            response = await submit(database)
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert stored is not None
            return stored

        stored = on_a_league(mongo_replica_set_url, body)

        for seat in ("trainer", "ansprechperson", "stellvertretung"):
            assert stored["kontakte"][seat]["einwilligung"] == {
                "umfang": "kontaktdaten",
                "erfasst_von": "administrativ",
                "text_version": BEWERBUNG_LAUFENDE_FASSUNG,
                "datum": TODAY,
                "bestaetigt_am": None,
            }
            # The key is present and null, as `wunschgegner`'s is: the confirmation fills it.
            assert "geburtsdatum" in stored["kontakte"][seat] and stored["kontakte"][seat]["geburtsdatum"] is None

    def test_the_named_opponent_is_stored_as_the_school_wrote_it(self, mongo_replica_set_url: str):
        """A free string and never a reference: nothing resolves it against a club, at the write or afterwards."""

        async def body(database: AsyncDatabase) -> Mapping[str, Any]:
            response = await submit(database, wunschgegner="Zorbanax-Gesamtschule")
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert stored is not None
            return stored

        assert on_a_league(mongo_replica_set_url, body)["wunschgegner"] == "Zorbanax-Gesamtschule"

    def test_a_submission_naming_no_opponent_still_writes_the_key(self, mongo_replica_set_url: str):
        """The validator cannot require it, so only the write keeps every application this endpoint makes one shape."""

        async def body(database: AsyncDatabase) -> Mapping[str, Any]:
            response = await submit(database)
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert stored is not None
            return stored

        stored = on_a_league(mongo_replica_set_url, body)

        assert "wunschgegner" in stored and stored["wunschgegner"] is None

    def test_the_year_group_the_school_named_is_stored(self, mongo_replica_set_url: str):
        """The write is the only thing putting this key in the document, the validator not requiring it."""

        async def body(database: AsyncDatabase) -> Mapping[str, Any]:
            response = await submit(database, stufengroesse=118)
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert stored is not None
            return stored

        assert on_a_league(mongo_replica_set_url, body)["stufengroesse"] == 118

    def test_the_response_echoes_nothing_of_the_submission(self, mongo_replica_set_url: str):
        """The three people's details went one way; a body repeating them is a copy in every proxy between."""

        response = on_a_league(mongo_replica_set_url, lambda database: submit(database))

        assert set(response.model_dump()) == {
            "acknowledged",
            "created_id",
            "saison_id",
            "eingereicht_am",
            "bestaetigungen",
            "bestaetigungsfrist",
        }


class TestWhatTheCreateMints:
    """Three links, stored as hashes and answered raw: the response and the inboxes are the only two places a raw token exists."""

    def test_three_hashes_are_stored_and_three_raw_tokens_answered_that_are_not_the_hashes(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            response = await submit(database)
            document = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert document is not None
            return response, document

        response, document = on_a_league(mongo_replica_set_url, body)

        tokens = response.bestaetigungen.model_dump()
        assert len(set(tokens.values())) == 3
        for seat, raw in tokens.items():
            entry = document["bestaetigungen"][seat]
            assert raw != entry["token_hash"]
            assert hash_token(raw) == entry["token_hash"]
            assert (entry["verschickt_am"], entry["erinnert_am"], entry["abgelehnt_am"]) == (TODAY, None, None)

    def test_the_deadline_is_the_bound_counted_from_today_and_written_beside_the_block(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            response = await submit(database)
            document = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert document is not None
            return response.bestaetigungsfrist, document["bestaetigungsfrist"]

        answered, written = on_a_league(mongo_replica_set_url, body)

        assert answered == written == (date.fromisoformat(TODAY) + timedelta(days=BEWERBUNG_BESTAETIGUNG_FRIST_TAGE)).isoformat()

    def test_no_raw_token_reaches_the_log(self, mongo_replica_set_url: str):
        """The insert files no image, and the row is searched as text so a token carried in under any key would show."""

        async def body(database: AsyncDatabase) -> Any:
            response = await submit(database)
            rows = await database[Collection.AKTIONEN].find({"collection": str(Collection.BEWERBUNGEN)}).to_list(length=None)

            return list(response.bestaetigungen.model_dump().values()), str(rows)

        tokens, rendered = on_a_league(mongo_replica_set_url, body)

        assert not any(raw in rendered for raw in tokens)


class TestWhatTheLogRecords:
    """An insert carries no `before`, so the row says an application arrived and never what was in it."""

    def test_one_row_naming_the_application_and_holding_no_image(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Mapping[str, Any]:
            response = await submit(database)
            rows = await database[Collection.AKTIONEN].find({"collection": str(Collection.BEWERBUNGEN)}).to_list(length=None)

            assert len(rows) == 1
            assert rows[0]["document_id"] == response.created_id
            return rows[0]

        row = on_a_league(mongo_replica_set_url, body)

        assert row["operation"] == "insert"
        assert row["before"] is None

    def test_no_submitted_value_reaches_the_row(self, mongo_replica_set_url: str):
        """Searched as TEXT over the whole row: a field carried in under any key would show up here."""

        async def body(database: AsyncDatabase) -> str:
            await submit(database)
            rows = await database[Collection.AKTIONEN].find({"collection": str(Collection.BEWERBUNGEN)}).to_list(length=None)

            return str(rows)

        rendered = on_a_league(mongo_replica_set_url, body)

        for submitted in (KONTAKTE["trainer"]["vorname"], KONTAKTE["ansprechperson"]["email"], KONTAKTE["trainer"]["telefon"]):
            assert submitted not in rendered


# What each state writes over a fresh application: every one means a link may already be in an inbox.
LINK_MAY_BE_OUT = [
    pytest.param({"kontakte.trainer.einwilligung.bestaetigt_am": TODAY}, id="a seat confirmed"),
    pytest.param({"bestaetigungen.stellvertretung.abgelehnt_am": TODAY}, id="a seat declined"),
    pytest.param({"bestaetigungen.trainer.erinnert_am": TODAY}, id="a seat reminded"),
    pytest.param(
        {
            "bestaetigungen.ansprechperson.zustellung": {
                "nachricht_id": "msg-1",
                "stand": "angenommen",
                "grund": None,
                "am": f"{TODAY}T10:00:00.000Z",
            }
        },
        id="a message on record",
    ),
    pytest.param({"status": "abgelehnt"}, id="decided"),
    pytest.param({"bestaetigungsfrist": "2026-03-31"}, id="past its deadline"),
    # A message the provider refused reached nobody, while its seat's neighbours were mailed: one
    # reached seat is enough to hold every link back.
    pytest.param(
        {
            "bestaetigungen.trainer.zustellung": {
                "nachricht_id": "",
                "stand": "unzustellbar",
                "grund": "abgewiesen",
                "am": f"{TODAY}T10:00:00.000Z",
            },
            "bestaetigungen.ansprechperson.zustellung": {
                "nachricht_id": "msg-1",
                "stand": "zugestellt",
                "grund": None,
                "am": f"{TODAY}T10:00:00.000Z",
            },
        },
        id="one seat refused, another reached",
    ),
]


class TestTheSubmissionKey:
    """`docs/backend/spec.md :: I346` and `:: I347`, over the shipped unique index."""

    def test_a_second_press_stores_no_second_application_and_answers_as_the_first(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            first = await submit(database, schluessel=SCHLUESSEL)
            second = await submit(database, schluessel=SCHLUESSEL)

            return first, second, await database[Collection.BEWERBUNGEN].count_documents({})

        first, second, stored = on_a_league(mongo_replica_set_url, body)

        assert stored == 1
        assert (second.created_id, second.saison_id, second.eingereicht_am, second.bestaetigungsfrist) == (
            first.created_id,
            first.saison_id,
            first.eingereicht_am,
            first.bestaetigungsfrist,
        )

    def test_a_replay_with_nothing_on_record_hands_fresh_links_and_keeps_the_first_ones_live(self, mongo_replica_set_url: str):
        """The route died before its mail: the replay is the only way the three links ever go out."""

        async def body(database: AsyncDatabase) -> Any:
            first = await submit(database, schluessel=SCHLUESSEL)
            second = await submit(database, schluessel=SCHLUESSEL)

            return first, second, await database[Collection.BEWERBUNGEN].find_one({})

        first, second, stored = on_a_league(mongo_replica_set_url, body)

        assert second.bestaetigungen is not None
        for seat, raw in second.bestaetigungen.model_dump().items():
            before = getattr(first.bestaetigungen, seat)
            assert raw != before
            assert stored["bestaetigungen"][seat]["token_hash"] == hash_token(raw)
            assert stored["bestaetigungen"][seat]["token_hash_zuvor"] == hash_token(before)
            # Neither a reminder nor a re-send: the chase and the deadline stand where the create put them.
            assert (stored["bestaetigungen"][seat]["verschickt_am"], stored["bestaetigungen"][seat]["erinnert_am"]) == (TODAY, None)

    def test_a_replay_answers_after_the_window_has_closed(self, mongo_replica_set_url: str):
        """Looked up before every judgement: the first press arrived in time, and its answer does not expire with the window."""

        async def body(database: AsyncDatabase) -> Any:
            first = await submit(database, schluessel=SCHLUESSEL)
            await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"bewerbung.offen": False}})
            second = await submit(database, schluessel=SCHLUESSEL)

            return first.created_id, second.created_id

        first, second = on_a_league(mongo_replica_set_url, body)

        assert first == second

    def test_a_replay_is_answered_whatever_wording_its_first_press_named(self, mongo_replica_set_url: str, monkeypatch: pytest.MonkeyPatch):
        """Looked up before the wording is judged: a deploy between the presses moved the label, and the retry resends the first one's."""

        async def body(database: AsyncDatabase) -> Any:
            with monkeypatch.context() as earlier_build:
                earlier_build.setattr(services, "BEWERBUNG_LAUFENDE_FASSUNG", EARLIER_FASSUNG)
                first = await submit(database, schluessel=SCHLUESSEL, kontakte=kontakte_labelled(EARLIER_FASSUNG))
            second = await submit(database, schluessel=SCHLUESSEL, kontakte=kontakte_labelled(EARLIER_FASSUNG))

            return first.created_id, second.created_id, await database[Collection.BEWERBUNGEN].count_documents({})

        first, second, stored = on_a_league(mongo_replica_set_url, body)

        assert (second, stored) == (first, 1)

    def test_the_same_key_over_other_details_is_refused_and_stores_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            await submit(database, schluessel=SCHLUESSEL)
            with pytest.raises(WriteRefusalException) as refused:
                await submit(database, schluessel=SCHLUESSEL, stufengroesse=91)

            return refused.value.error_code, await database[Collection.BEWERBUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == (BEWERBUNG_SCHLUESSEL_ABWEICHEND, 1)

    @pytest.mark.parametrize("moved", LINK_MAY_BE_OUT)
    def test_a_replay_hands_no_link_once_one_may_be_out(self, mongo_replica_set_url: str, moved: Mapping[str, Any]):
        """No second mail over a link somebody may hold, and the stored row left exactly as it was."""

        async def body(database: AsyncDatabase) -> Any:
            await submit(database, schluessel=SCHLUESSEL)
            await database[Collection.BEWERBUNGEN].update_one({}, {"$set": dict(moved)})
            before = await database[Collection.BEWERBUNGEN].find_one({})
            second = await submit(database, schluessel=SCHLUESSEL)

            return second, before, await database[Collection.BEWERBUNGEN].find_one({})

        second, before, after = on_a_league(mongo_replica_set_url, body)

        assert second.bestaetigungen is None
        assert after == before

    @pytest.mark.parametrize(
        "zustellung",
        [
            pytest.param({"nachricht_id": "", "stand": "unzustellbar", "grund": "abgewiesen", "am": f"{TODAY}T10:00:00.000Z"}, id="refused"),
            pytest.param({"nachricht_id": "msg-1", "stand": "unterdrueckt", "grund": None, "am": f"{TODAY}T10:00:00.000Z"}, id="suppressed"),
        ],
    )
    def test_a_replay_after_mails_that_all_never_arrived_hands_fresh_links(self, mongo_replica_set_url: str, zustellung: Mapping[str, Any]):
        """Nobody holds a link, so none handed would leave an application nobody can confirm until the reminder."""

        async def body(database: AsyncDatabase) -> Any:
            await submit(database, schluessel=SCHLUESSEL)
            await database[Collection.BEWERBUNGEN].update_one(
                {},
                {"$set": {f"bestaetigungen.{seat}.zustellung": dict(zustellung) for seat in ("trainer", "ansprechperson", "stellvertretung")}},
            )

            return await submit(database, schluessel=SCHLUESSEL)

        assert on_a_league(mongo_replica_set_url, body).bestaetigungen is not None

    @pytest.mark.parametrize(
        "emptying",
        [
            pytest.param(compose_decline_update(seats=("stellvertretung",), today=TODAY), id="a Widerspruch"),
            pytest.param(build_clearing_update(("stellvertretung",), bestaetigungen=True), id="a contact erasure"),
        ],
    )
    def test_emptying_a_seat_takes_the_digest_with_it(self, mongo_replica_set_url: str, emptying: Mapping[str, Any]):
        """The digest was taken over that person's details too; a replay then meets the refusal of other details, which stays true."""

        async def body(database: AsyncDatabase) -> Any:
            await submit(database, schluessel=SCHLUESSEL)
            await database[Collection.BEWERBUNGEN].update_one({}, dict(emptying))
            stored = await database[Collection.BEWERBUNGEN].find_one({})
            with pytest.raises(WriteRefusalException) as refused:
                await submit(database, schluessel=SCHLUESSEL)

            return stored, refused.value.error_code

        stored, code = on_a_league(mongo_replica_set_url, body)

        assert "idempotenz_fingerabdruck" not in stored
        assert code == BEWERBUNG_SCHLUESSEL_ABWEICHEND

    def test_applications_stored_before_the_key_neither_collide_nor_move(self, mongo_replica_set_url: str):
        """The partial filter: two rows carrying no key would otherwise both index as null and collide."""

        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.BEWERBUNGEN].insert_many([_application_without_a_wish(), _application_without_a_wish()])
            before = await database[Collection.BEWERBUNGEN].find({}).sort("_id", 1).to_list(length=None)
            await submit(database, schluessel=SCHLUESSEL)
            after = (
                await database[Collection.BEWERBUNGEN].find({"idempotenz_schluessel": {"$exists": False}}).sort("_id", 1).to_list(length=None)
            )

            return before, after, await database[Collection.BEWERBUNGEN].count_documents({})

        before, after, stored = on_a_league(mongo_replica_set_url, body)

        assert (after, stored) == (before, 3)

    def test_a_press_whose_lookup_ran_before_the_first_commit_is_answered_by_the_retry(self, mongo_replica_set_url: str):
        """Why no duplicate-key arm exists: the lookup opens the snapshot, and a later commit meets the insert as a write conflict."""

        async def body(database: AsyncDatabase) -> Any:
            committed = asyncio.Event()
            held = HoldsAfterItsLookup(database[Collection.BEWERBUNGEN], committed)
            second = asyncio.create_task(submit(database, schluessel=SCHLUESSEL, bewerbungen=held))
            await held.until_held(second)

            try:
                first = await submit(database, schluessel=SCHLUESSEL)
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
        # 112 is `WriteConflict`, which `with_transaction` retries: the second run's lookup finds the row.
        assert (lookups, failures) == (2, ["OperationFailure:112"])

    def test_the_lookup_the_endpoint_sends_is_the_one_its_index_serves(self, mongo_replica_set_url: str):
        """A bare equality scans the collection (`fl_backend/tests/core/test_constraints_execution.py`)."""

        async def body(database: AsyncDatabase) -> Any:
            # Set before the press, so the wrapper records the lookup and holds nothing back.
            committed = asyncio.Event()
            committed.set()
            held = HoldsAfterItsLookup(database[Collection.BEWERBUNGEN], committed)
            await submit(database, schluessel=SCHLUESSEL, bewerbungen=held)

            return held.lookup_filters

        assert on_a_league(mongo_replica_set_url, body) == [build_schluessel_filter(schluessel=str(SCHLUESSEL))]

    def test_two_presses_at_once_store_one_application(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            answers = await asyncio.gather(submit(database, schluessel=SCHLUESSEL), submit(database, schluessel=SCHLUESSEL))

            return {answer.created_id for answer in answers}, await database[Collection.BEWERBUNGEN].count_documents({})

        ids, stored = on_a_league(mongo_replica_set_url, body)

        assert (len(ids), stored) == (1, 1)


def refused(url: str, *, bewerbung: Any = OPEN_WINDOW, saison_status: str = "future", **overrides: Any) -> WriteRefusalException:
    """One submission expected to be refused, with the exception it raised."""

    async def body(database: AsyncDatabase) -> WriteRefusalException:
        with pytest.raises(WriteRefusalException) as failure:
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
            pytest.param({**OPEN_WINDOW, "offen": False}, id="the flag turned off"),
            pytest.param({"offen": True, "von": "2026-05-01", "bis": "2026-05-31"}, id="a span this day is outside"),
        ],
    )
    def test_a_season_taking_no_applications_refuses(self, mongo_replica_set_url: str, bewerbung: Any):
        assert refused(mongo_replica_set_url, bewerbung=bewerbung).error_code == BEWERBUNG_FENSTER_GESCHLOSSEN

    def test_a_season_that_has_ended_refuses_while_its_window_still_runs(self, mongo_replica_set_url: str):
        """The payload names the season, so a `past` one whose stored window still runs is reachable by the form's own request."""

        assert refused(mongo_replica_set_url, saison_status="past").error_code == BEWERBUNG_FENSTER_GESCHLOSSEN

    def test_a_season_no_document_names_is_a_404(self, mongo_replica_set_url: str):
        """A 404 rather than `REQ-BEWERBUNG-004`: nothing was refused, the season the body names does not exist."""

        async def body(database: AsyncDatabase) -> None:
            with pytest.raises(DocumentNotFoundException):
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

        assert failure.error_code == BEWERBUNG_SUBMISSION_SUBJECT_UNRESOLVED

    @pytest.mark.parametrize(
        "team_id",
        [
            pytest.param(str(RETIRED_OID), id="a club that left the league"),
            pytest.param(str(UNKNOWN_OID), id="an id no club holds"),
        ],
    )
    def test_a_club_the_list_does_not_offer_refuses(self, mongo_replica_set_url: str, team_id: str):
        """The same code for both, so a client sending an id it was never given learns nothing about which."""

        assert refused(mongo_replica_set_url, team_id=team_id).error_code == BEWERBUNG_PICKED_CLUB_UNUSABLE

    def test_a_club_already_playing_the_season_refuses(self, mongo_replica_set_url: str):
        assert refused(mongo_replica_set_url, team_id=str(ENTERED_OID)).error_code == BEWERBUNG_PICKED_CLUB_ALREADY_ENTERED

    def test_a_first_press_naming_an_earlier_wording_refuses(self, mongo_replica_set_url: str):
        """The replay case's control: the same body under a key nothing stores is judged, and stores nothing."""

        assert refused(mongo_replica_set_url, kontakte=kontakte_labelled(EARLIER_FASSUNG)).error_code == BEWERBUNG_FASSUNG_VERALTET

    def test_a_new_school_proposing_a_taken_kuerzel_refuses(self, mongo_replica_set_url: str):
        """Asked of a NEW school alone; `uniq_shorthand` is what would otherwise fail at acceptance."""

        failure = refused(mongo_replica_set_url, team_id=None, schule=schule_block(shorthand=EXISTING_SHORTHAND))

        assert failure.error_code == BEWERBUNG_SHORTHAND_TAKEN

    def test_a_picked_club_is_not_refused_for_holding_its_own_kuerzel(self, mongo_replica_set_url: str):
        """The control for the case above: a shorthand check reaching both branches would make applying impossible."""

        response = on_a_league(mongo_replica_set_url, lambda database: submit(database))

        assert response.created_id is not None


class TestTwoSchoolsMayApplyForOneSeason:
    """Explicitly NOT refused: a season takes many applications, and nothing here is a queue of one."""

    def test_a_second_new_school_is_stored_beside_the_first(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> int:
            await submit(database, team_id=None, schule=schule_block())
            await submit(database, team_id=None, schule=schule_block(team_name="Yttrium", shorthand="YT"))

            return await database[Collection.BEWERBUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == 2


# The HTTP surface, on a SECOND database: `build_test_config`'s, the one an app under test resolves
# its collections from. Seeded with pymongo, as `tests/api/test_spiele_public_read.py` seeds its own.
@dataclass(frozen=True)
class Submitted:
    """Everything a case below reads, gathered before the client that read it is closed."""

    response: Response
    stored: int
    keyed: int
    log_rows: list[Mapping[str, Any]]


def through_the_app(url: str, body: Mapping[str, Any], *, headers: Mapping[str, str] | None = None, schluessel: str | None = None) -> Submitted:
    """One submission over the wire, so the guard, the actor binder and the response model all run."""

    database_name = build_test_config().db_base_name

    client = MongoClient(url)
    try:
        database = a_clean_database_sync(client, url, database_name)
        database[Collection.SAISONS].insert_one(
            saison_document(SAISON_ID, "future", rules=rules_document(number_of_groups=2, teams_per_group=2), bewerbung=dict(OPEN_WINDOW))
        )
        database[Collection.TEAMS].insert_one(club_document(EXISTING_OID, EXISTING_NAME, EXISTING_SHORTHAND))

        async def _submitted() -> Response:
            async with app_client(url, now=NOW) as http:
                sent = dict(BASE_AUTH if headers is None else headers)
                # A fresh key unless the case names one, an empty one standing for none sent.
                if schluessel != "":
                    sent["Idempotency-Key"] = schluessel or str(uuid4())
                return await http.post(f"/api/v{API_VERSION}/bewerbungen", json=dict(body), headers=sent)

        response = asyncio.run(_submitted())

        # Read HERE: the client below is closed on the way out, and a handle returned through it
        # would be dead by the time a case touched it.
        return Submitted(
            response=response,
            stored=database[Collection.BEWERBUNGEN].count_documents({}),
            keyed=database[Collection.BEWERBUNGEN].count_documents({"idempotenz_schluessel": {"$exists": True}}),
            log_rows=list(database[Collection.AKTIONEN].find({"collection": str(Collection.BEWERBUNGEN)})),
        )
    finally:
        client.close()


class TestASubmissionMadeOverTheWire:
    """What calling the endpoint function directly cannot prove: the guard, the binder and the log row a real request writes."""

    def test_the_base_key_reaches_the_write(self, mongo_replica_set_url: str):
        """Also the floor under the two refusals below: without it each would pass on a write nothing reaches."""

        submitted = through_the_app(mongo_replica_set_url, payload())

        assert submitted.response.status_code == 201
        assert submitted.response.json()["eingereicht_am"] == TODAY
        assert submitted.stored == 1

    def test_no_key_reaches_none_of_it(self, mongo_replica_set_url: str):
        """Public here means no SESSION, never no key: a bearer token is checked before the body is parsed."""

        submitted = through_the_app(mongo_replica_set_url, payload(), headers={})

        assert submitted.response.status_code == 401
        assert submitted.stored == 0

    def test_no_actor_header_is_demanded(self, mongo_replica_set_url: str):
        """The whole reason the router declares `bind_public_actor`: `bind_actor` would answer `REQ-AUTH-005` here."""

        assert through_the_app(mongo_replica_set_url, payload()).response.status_code != 401

    def test_the_row_is_attributed_to_the_public_rather_than_to_the_system(self, mongo_replica_set_url: str):
        """`system` means a write made outside a request; this one was made through one, by nobody."""

        rows = through_the_app(mongo_replica_set_url, payload()).log_rows

        assert len(rows) == 1
        assert rows[0]["actor"] == {"kind": "public", "email": PUBLIC_ACTOR_EMAIL}
        assert rows[0]["request"] == {"method": "POST", "path": f"/api/v{API_VERSION}/bewerbungen"}

    def test_a_forged_actor_header_does_not_reach_the_row(self, mongo_replica_set_url: str):
        """The header `bind_actor` reads is the one this route must ignore, and the row is where that shows.

        Over the wire rather than through the binder alone: what is asserted is the stored
        `aktionen.actor`, which is the record an erasure is audited against.
        """

        forged_actor = "attacker@example.com"
        forged = {**BASE_AUTH, ACTOR_HEADER: forged_actor}
        submitted = through_the_app(mongo_replica_set_url, payload(), headers=forged)

        assert submitted.response.status_code == 201
        assert len(submitted.log_rows) == 1
        assert submitted.log_rows[0]["actor"] == {"kind": "public", "email": PUBLIC_ACTOR_EMAIL}
        assert forged_actor not in str(submitted.log_rows[0])

    def test_a_body_breaking_a_shape_rule_is_refused_as_a_payload(self, mongo_replica_set_url: str):
        """The distinctness rule is about the BODY, not a judgement against the database, so it reaches no refusal code."""

        shared = dict(KONTAKTE["ansprechperson"], telefon=KONTAKTE["trainer"]["telefon"])
        submitted = through_the_app(mongo_replica_set_url, payload(kontakte={**KONTAKTE, "ansprechperson": shared}))

        assert (submitted.response.status_code, submitted.response.json()["error_code"]) == (422, PAYLOAD_REFUSED)
        assert submitted.stored == 0

    @pytest.mark.parametrize(
        "schluessel",
        [
            pytest.param("not-a-uuid", id="not a uuid"),
            # Version 1, which carries its host's clock: a guessable key lets a stranger store other details under it first.
            pytest.param("6fa459ea-ee8a-11ca-8d6b-0800200c9a66", id="a time-based uuid"),
            # The IETF draft's structured-field string: the bare token is this API's form (`docs/backend/spec.md :: I350`).
            pytest.param('"1b4e28ba-2fa1-4d2b-883f-0016d3cca427"', id="the draft's quoted form"),
        ],
    )
    def test_a_key_that_is_not_version_4_is_a_422_storing_nothing(self, mongo_replica_set_url: str, schluessel: str):
        submitted = through_the_app(mongo_replica_set_url, payload(), schluessel=schluessel)

        assert submitted.response.status_code == 422
        assert submitted.stored == 0

    def test_a_press_carrying_no_key_is_still_taken(self, mongo_replica_set_url: str):
        """A page loaded before the form sent one: stored, unprotected, and outside the unique index."""

        submitted = through_the_app(mongo_replica_set_url, payload(), schluessel="")

        assert submitted.response.status_code == 201
        assert submitted.stored == 1
        assert submitted.keyed == 0

    def test_a_refusal_is_a_409_carrying_its_code(self, mongo_replica_set_url: str):
        """The contract a client maps to German: the code reaches the body, not just the status."""

        submitted = through_the_app(mongo_replica_set_url, payload(team_id=str(UNKNOWN_OID)))

        assert submitted.response.status_code == 409
        assert submitted.response.json()["error_code"] == BEWERBUNG_PICKED_CLUB_UNUSABLE


# The validator refuses what the models refuse: `gute_spieler` is non-nullable on every side, not
# the payload alone, so the stored shape is `bsonType: "int"` and no null.


def _parsed_kontakte() -> dict[str, Any]:
    """The three people as the payload leaves them, so only the `kader` below is under test."""

    return FLPostBewerbungPayload.model_validate(payload()).kontakte.model_dump(mode="json")


def _application_without_a_wish() -> dict[str, Any]:
    """One application in the shape every one stored before `wunschgegner` existed carries: no such key."""

    return {
        "saison_id": SAISON_ID,
        "eingereicht_am": TODAY,
        "status": "eingereicht",
        "team_id": EXISTING_OID,
        "schule": None,
        "kontakte": compose_kontakte(kontakte=_parsed_kontakte(), today=TODAY),
        "trikot": {"vorhandener_satz": "16 rote Trikots", "wunschfarbe": "rot"},
        "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
        "entscheidung": None,
    }


def _stored_with(database: AsyncDatabase, kader: Mapping[str, Any]) -> Awaitable[str]:
    """One application inserted straight past the models, so only the `$jsonSchema` can be refusing it."""

    async def _insert() -> str:
        document = {
            "saison_id": SAISON_ID,
            "eingereicht_am": TODAY,
            "status": "eingereicht",
            "team_id": EXISTING_OID,
            "schule": None,
            "kontakte": compose_kontakte(kontakte=_parsed_kontakte(), today=TODAY),
            "trikot": {"vorhandener_satz": "16 rote Trikots", "wunschfarbe": "rot"},
            "kader": dict(kader),
            "entscheidung": None,
        }
        try:
            await database[Collection.BEWERBUNGEN].insert_one(document)
        except OperationFailure as failure:
            assert failure.code == DOCUMENT_VALIDATION_FAILED, f"expected a validation failure, got {failure.code}"
            return "rejected"
        return "accepted"

    return _insert()


class TestTheDatabaseRefusesACountItCannotHold:
    """The half no model can prove: `gute_spieler` is non-nullable in the `$jsonSchema` too.

    Without it the validator could drift back to `int|null` with every Python test still green.
    """

    def test_a_null_count_is_refused_by_the_validator(self, mongo_replica_set_url: str):
        null_count = {"voraussichtliche_groesse": 14, "gute_spieler": None}

        assert on_a_league(mongo_replica_set_url, lambda database: _stored_with(database, null_count)) == "rejected"

    def test_an_omitted_count_is_refused_too(self, mongo_replica_set_url: str):
        """`required` names the key, so an absent one is a rejection rather than a stored null."""

        assert on_a_league(mongo_replica_set_url, lambda database: _stored_with(database, {"voraussichtliche_groesse": 14})) == "rejected"

    def test_a_real_count_is_stored(self, mongo_replica_set_url: str):
        """The control: without it both cases above would pass on a validator that refuses every kader."""

        real_count = {"voraussichtliche_groesse": 14, "gute_spieler": 0}

        assert on_a_league(mongo_replica_set_url, lambda database: _stored_with(database, real_count)) == "accepted"


class TestTheDatabaseHoldsAClubWithNoWebsite:
    """The half no model can prove: `website_url` is nullable in BOTH `$jsonSchema`s too.

    A model relaxed while a validator stayed `bsonType: "string"` refuses the write at the driver,
    which is the direction that ships silently.
    """

    def test_an_application_naming_no_website_is_stored(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            response = await submit(database, team_id=None, schule=schule_block(website_url=None))
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert stored is not None
            # Parsed through the read model too: storing it and being unable to read it back would
            # 500 the triage list over the one row an administrator has to decide.
            return FLBewerbung(**stored).schule

        schule_read = on_a_league(mongo_replica_set_url, body)

        assert schule_read is not None
        assert schule_read.website_url is None

    def test_a_club_naming_no_website_is_stored(self, mongo_replica_set_url: str):
        """`teams` carries its own validator, and acceptance is what writes a club from an application."""

        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.TEAMS].insert_one(club_document(UNKNOWN_OID, "Ohnesite", "OS") | {"website_url": None})
            stored = await database[Collection.TEAMS].find_one({"_id": UNKNOWN_OID})

            assert stored is not None
            return stored["website_url"]

        assert on_a_league(mongo_replica_set_url, body) is None

    def test_the_key_is_still_required_even_when_null(self, mongo_replica_set_url: str):
        """Nullable, not optional: `required` names the key, so an omitted one is still a rejection."""

        async def body(database: AsyncDatabase) -> str:
            document = club_document(UNKNOWN_OID, "Ohneschluessel", "OK")
            del document["website_url"]
            try:
                await database[Collection.TEAMS].insert_one(document)
            except OperationFailure as failure:
                assert failure.code == DOCUMENT_VALIDATION_FAILED, f"expected a validation failure, got {failure.code}"
                return "rejected"
            return "accepted"

        assert on_a_league(mongo_replica_set_url, body) == "rejected"


class TestTheDatabaseStillHoldsAnApplicationWithNoColour:
    """`wunschfarbe` narrowed on the PAYLOAD alone, so the stored shape did not move.

    A validator or read model narrowed with it would refuse a row the triage has to show.
    """

    def test_a_stored_null_colour_is_accepted_and_reads_back_through_the_model(self, mongo_replica_set_url: str):
        """Read back through `FLBewerbung`, not with a raw `find_one`: parsing is where a narrowed model would fail."""

        async def body(database: AsyncDatabase) -> Any:
            document = {
                "saison_id": SAISON_ID,
                "eingereicht_am": TODAY,
                "status": "eingereicht",
                "team_id": EXISTING_OID,
                "schule": None,
                "kontakte": compose_kontakte(kontakte=_parsed_kontakte(), today=TODAY),
                # The colour an administrator has not assigned. The payload admits no null here, so
                # only a stored row reaches the read models carrying one.
                "trikot": {"vorhandener_satz": "16 rote Trikots", "wunschfarbe": None},
                "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
                "entscheidung": None,
            }
            created = await database[Collection.BEWERBUNGEN].insert_one(document)
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": created.inserted_id})

            assert stored is not None
            return FLBewerbung(**stored).trikot.wunschfarbe

        assert on_a_league(mongo_replica_set_url, body) is None

    def test_the_key_is_still_required_even_when_null(self, mongo_replica_set_url: str):
        """Nullable, not optional: `required` names the key on the stored shape."""

        async def body(database: AsyncDatabase) -> str:
            document = {
                "saison_id": SAISON_ID,
                "eingereicht_am": TODAY,
                "status": "eingereicht",
                "team_id": EXISTING_OID,
                "schule": None,
                "kontakte": compose_kontakte(kontakte=_parsed_kontakte(), today=TODAY),
                "trikot": {"vorhandener_satz": "16 rote Trikots"},
                "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
                "entscheidung": None,
            }
            try:
                await database[Collection.BEWERBUNGEN].insert_one(document)
            except OperationFailure as failure:
                assert failure.code == DOCUMENT_VALIDATION_FAILED, f"expected a validation failure, got {failure.code}"
                return "rejected"
            return "accepted"

        assert on_a_league(mongo_replica_set_url, body) == "rejected"


class TestTheDatabaseStillHoldsAnApplicationStoredBeforeTheOpponentField:
    """`wunschgegner` is outside the validator's `required`, which every application predating it depends on.

    The triage's `$set` re-runs the validator over the WHOLE document, so requiring the key would
    refuse every decision on one of those.
    """

    def test_a_document_carrying_no_key_at_all_is_accepted(self, mongo_replica_set_url: str):
        """The shipped `$jsonSchema`, so a document production would refuse fails here too."""

        async def body(database: AsyncDatabase) -> Any:
            created = await database[Collection.BEWERBUNGEN].insert_one(_application_without_a_wish())
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": created.inserted_id})

            assert stored is not None
            # Read back through `FLBewerbung`, not off the raw document: parsing is where a model
            # without the default would fail.
            return FLBewerbung(**stored).wunschgegner

        assert on_a_league(mongo_replica_set_url, body) is None

    def test_a_decision_on_one_is_still_accepted(self, mongo_replica_set_url: str):
        """The failure that would ship silently: nothing writes `wunschgegner`, and the whole document is re-validated."""

        async def body(database: AsyncDatabase) -> str:
            # Past the validator: the row this class is about predates the key, so a `required` gaining
            # it would fail the setup insert and report the case above's finding rather than this one's.
            created = await database[Collection.BEWERBUNGEN].insert_one(_application_without_a_wish(), bypass_document_validation=True)
            try:
                await database[Collection.BEWERBUNGEN].update_one(
                    {"_id": created.inserted_id},
                    {"$set": {"status": "abgelehnt", "entscheidung": {"getroffen_am": TODAY, "von": "admin", "grund": "kein Platz"}}},
                )
            except OperationFailure as failure:
                assert failure.code == DOCUMENT_VALIDATION_FAILED, f"expected a validation failure, got {failure.code}"
                return "rejected"
            return "accepted"

        assert on_a_league(mongo_replica_set_url, body) == "accepted"


def _application_before_the_year_group() -> dict[str, Any]:
    """One application carrying the opponent key and no `stufengroesse`, so only this field's carve-out is under test."""

    return _application_without_a_wish() | {"wunschgegner": None}


class TestTheDatabaseStillHoldsAnApplicationStoredBeforeTheYearGroup:
    """The `wunschgegner` carve-out again, re-proved: a required key here would refuse every decision on a stored application."""

    def test_a_document_carrying_no_key_at_all_is_accepted(self, mongo_replica_set_url: str):
        """The insert and the parse both: a validator requiring the key refuses one, and a model without a default refuses the other."""

        async def body(database: AsyncDatabase) -> Any:
            created = await database[Collection.BEWERBUNGEN].insert_one(_application_before_the_year_group())
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": created.inserted_id})

            assert stored is not None
            return FLBewerbung(**stored).stufengroesse

        assert on_a_league(mongo_replica_set_url, body) is None

    def test_a_decision_on_one_is_still_accepted(self, mongo_replica_set_url: str):
        """A decision touches `status` and `entscheidung` alone, and MongoDB re-validates the whole row it lands on."""

        async def body(database: AsyncDatabase) -> str:
            # Past the validator, for the reason at
            # `TestTheDatabaseStillHoldsAnApplicationStoredBeforeTheOpponentField :: test_a_decision_on_one_is_still_accepted`:
            # without it the setup insert fails before the update this case is named for is reached.
            created = await database[Collection.BEWERBUNGEN].insert_one(_application_before_the_year_group(), bypass_document_validation=True)
            try:
                await database[Collection.BEWERBUNGEN].update_one(
                    {"_id": created.inserted_id},
                    {"$set": {"status": "abgelehnt", "entscheidung": {"getroffen_am": TODAY, "von": "admin", "grund": "kein Platz"}}},
                )
            except OperationFailure as failure:
                assert failure.code == DOCUMENT_VALIDATION_FAILED, f"expected a validation failure, got {failure.code}"
                return "rejected"
            return "accepted"

        assert on_a_league(mongo_replica_set_url, body) == "accepted"


def _application_before_the_confirmation_fields() -> dict[str, Any]:
    """One application with no birthdate key and no stamp key on any seat.

    Wider than what the old form left, a date on every seat, so a read surviving this survives that.
    """

    document = _application_without_a_wish()

    for seat in ("trainer", "ansprechperson", "stellvertretung"):
        del document["kontakte"][seat]["geburtsdatum"]
        del document["kontakte"][seat]["einwilligung"]["bestaetigt_am"]

    return document


class TestTheDatabaseStillHoldsAnApplicationStoredBeforeTheConfirmationFields:
    """`geburtsdatum` and `bestaetigt_am` are outside the validator's `required`, and every stored application depends on it.

    The `wunschgegner` precedent, and the `.claude/rules/backend.md` trap in the other direction: a
    model widened where its hand-written copy was not.
    """

    def test_a_document_carrying_neither_key_is_accepted_and_the_admin_read_answers_it(self, mongo_replica_set_url: str):
        """Through the endpoint rather than the raw document: the read is where a required field would 500 the whole triage."""

        async def body(database: AsyncDatabase) -> Any:
            created = await database[Collection.BEWERBUNGEN].insert_one(_application_before_the_confirmation_fields())
            response = await get_bewerbung_by_id(bewerbung_id=created.inserted_id, bewerbungen_collection=database[Collection.BEWERBUNGEN])

            return response.bewerbung.kontakte.trainer

        trainer = on_a_league(mongo_replica_set_url, body)

        assert trainer is not None
        assert (trainer.geburtsdatum, trainer.einwilligung.bestaetigt_am) == (None, None)

    def test_a_decision_on_one_is_still_accepted(self, mongo_replica_set_url: str):
        """The failure that would ship silently: a decision re-validates the whole document, keys it never wrote included."""

        async def body(database: AsyncDatabase) -> str:
            # Past the validator, for the reason at
            # `TestTheDatabaseStillHoldsAnApplicationStoredBeforeTheOpponentField :: test_a_decision_on_one_is_still_accepted`:
            # without it the setup insert fails before the update this case is named for is reached.
            created = await database[Collection.BEWERBUNGEN].insert_one(
                _application_before_the_confirmation_fields(), bypass_document_validation=True
            )
            try:
                await database[Collection.BEWERBUNGEN].update_one(
                    {"_id": created.inserted_id},
                    {"$set": {"status": "abgelehnt", "entscheidung": {"getroffen_am": TODAY, "von": "admin", "grund": "kein Platz"}}},
                )
            except OperationFailure as failure:
                assert failure.code == DOCUMENT_VALIDATION_FAILED, f"expected a validation failure, got {failure.code}"
                return "rejected"
            return "accepted"

        assert on_a_league(mongo_replica_set_url, body) == "accepted"


class TestAKuerzelARetiredClubStillHolds:
    """The write path's lookup spans retired clubs, because `uniq_shorthand` does.

    Narrow it and a new school passes here, then fails at ACCEPTANCE on the duplicate key -- the
    dead end `REQ-BEWERBUNG-006`'s wording exists to close, reached through `schule`.
    """

    def test_a_new_school_proposing_a_retired_clubs_kuerzel_is_refused(self, mongo_replica_set_url: str):
        """Only a lookup spanning retired clubs can be refusing this.

        `RETIRED_SHORTHAND` is held by exactly one club, and that club has left the league.
        """

        failure = refused(mongo_replica_set_url, team_id=None, schule=schule_block(shorthand=RETIRED_SHORTHAND))

        assert failure.error_code == BEWERBUNG_SHORTHAND_TAKEN

    def test_a_kuerzel_no_club_holds_is_still_accepted(self, mongo_replica_set_url: str):
        """The control: a lookup matching everything would refuse this too, and applying would be impossible."""

        response = on_a_league(mongo_replica_set_url, lambda database: submit(database, team_id=None, schule=schule_block()))

        assert response.created_id is not None

    def test_the_availability_check_and_the_write_agree_about_a_retired_club(self, mongo_replica_set_url: str):
        """Two lookups, one rule. They drifted before: the read was pinned against narrowing and the write was not."""

        async def body(database: AsyncDatabase) -> int:
            return await database[Collection.TEAMS].count_documents({"shorthand": RETIRED_SHORTHAND})

        assert on_a_league(mongo_replica_set_url, body) == 1
