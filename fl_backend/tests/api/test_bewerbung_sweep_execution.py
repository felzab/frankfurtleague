import asyncio
from datetime import datetime
from typing import Any, Awaitable, Callable, Mapping
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from httpx import ASGITransport, AsyncClient
from pymongo import AsyncMongoClient, MongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.einwilligung_router import get_einwilligung_ansicht
from app.api.bewerbungen.schemas import FLBewerbungEinwilligungAnsichtPayload, FLBewerbungSweepLoeschenPayload
from app.api.bewerbungen.services import KONTAKT_SEATS, compose_bestaetigungen, hash_token
from app.api.bewerbungen.sweep_router import get_sweep_saisons, loeschen_bewerbungen, sweep_saison
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db
from app.core.dependencies import get_germany_now
from app.core.exceptions import DocumentNotFoundException
from app.core.recording import SYSTEM_ACTOR_EMAIL
from app.main import create_app
from tests.config import TEST_BASE_URL, build_test_config
from tests.database import a_clean_database, a_clean_database_sync, on_the_seed_loop
from tests.worker import worker_database

# Module level, as the other execution suites mark theirs: every test below reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_bewerbung_sweep_test")

SAISON_ID = "2026"
NEXT_SAISON_ID = "2027"
OTHER_SAISON_ID = "2025"
TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
MAILED_ON_THE_MARK = "2026-03-29"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
REDACTED_AT = "2026-04-01T10:30:00+00:00"

# Fixed rather than generated, so a failure names the same row every run.
REMIND_OID = ObjectId("6890a1b2c3d4e5f607960001")
DELETE_OID = ObjectId("6890a1b2c3d4e5f607960002")
DECLINED_OID = ObjectId("6890a1b2c3d4e5f607960003")
ACCEPTED_OID = ObjectId("6890a1b2c3d4e5f607960004")
OTHER_SEASON_OID = ObjectId("6890a1b2c3d4e5f607960005")
CLUB_OID = ObjectId("6890a1b2c3d4e5f607960011")
JUNCTION_OID = ObjectId("6890a1b2c3d4e5f607960021")

CLUB_NAME = "Adler"
SCHOOL_NAME = "Zorbanax"

ADDRESS: Mapping[str, Any] = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}


def first_hashes(prefix: str) -> dict[str, str]:
    return {seat: hash_token(f"{prefix}-{seat}") for seat in KONTAKT_SEATS}


def person(vorname: str, *, email: str | None = None) -> dict[str, Any]:
    return {
        "vorname": vorname,
        "nachname": f"{vorname}-Mustermann",
        "email": email or f"{vorname.lower()}@example.com",
        "telefon": "+49 170 1234567",
        "geburtsdatum": None,
        "einwilligung": {
            "umfang": "kontaktdaten",
            "erteilt_von": "administrativ",
            "text_version": "v3",
            "datum": "2026-03-20",
            "bestaetigt_am": None,
        },
    }


def kontakte() -> dict[str, Any]:
    """One person holding two seats, so the reminder's grouping has something to group."""

    return {
        "trainer": person("Wraxlington"),
        "ansprechperson": person("Wraxlington"),
        "stellvertretung": person("Bramblewick"),
        "trainer_ist_zugleich": "ansprechperson",
    }


def application(bewerbung_id: ObjectId, *, saison_id: str = SAISON_ID, **overrides: Any) -> dict[str, Any]:
    return {
        "_id": bewerbung_id,
        "saison_id": saison_id,
        "eingereicht_am": MAILED_ON_THE_MARK,
        "status": "eingereicht",
        "team_id": None,
        "schule": {
            "team_name": SCHOOL_NAME,
            "full_name": f"{SCHOOL_NAME}-Gesamtschule",
            "shorthand": "ZX",
            "schulform": "gesamtschule",
            "address": dict(ADDRESS),
            "website_url": None,
        },
        "kontakte": kontakte(),
        "trikot": {"vorhandener_satz": "keiner", "wunschfarbe": "rot"},
        "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
        "wunschgegner": None,
        "entscheidung": None,
        "bestaetigungsfrist": "2026-04-12",
        "bestaetigungen": compose_bestaetigungen(hashes=first_hashes(str(bewerbung_id)), today=MAILED_ON_THE_MARK),
        **overrides,
    }


def the_corpus() -> list[dict[str, Any]]:
    """One application per clock, plus one of another season that no call for `SAISON_ID` may touch."""

    return [
        application(REMIND_OID),
        application(DELETE_OID, bestaetigungsfrist=YESTERDAY),
        application(DECLINED_OID, status="abgelehnt", entscheidung={"getroffen_am": "2026-02-15", "von": "admin", "grund": "kein Platz"}),
        application(
            ACCEPTED_OID,
            status="angenommen",
            team_id=CLUB_OID,
            schule=None,
            entscheidung={"getroffen_am": "2026-03-01", "von": "admin", "grund": None},
        ),
        application(
            OTHER_SEASON_OID,
            saison_id=OTHER_SAISON_ID,
            status="abgelehnt",
            entscheidung={"getroffen_am": "2025-01-15", "von": "admin", "grund": "kein Platz"},
        ),
    ]


def season(saison_id: str, status: str) -> dict[str, Any]:
    return {"_id": saison_id, "start_date": f"{saison_id}-01-01", "end_date": f"{saison_id}-06-30", "status": status, "rules": RULES}


RULES: Mapping[str, Any] = {
    "win_points": 3,
    "draw_points": 1,
    "qualifiers_per_group": 2,
    "number_of_groups": 2,
    "teams_per_group": 2,
    "tiebreak_order": "tordifferenz",
    "max_kadergroesse": 18,
    "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
    "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
}


def junction_row() -> dict[str, Any]:
    return {
        "_id": JUNCTION_OID,
        "saison_id": SAISON_ID,
        "team_id": CLUB_OID,
        "gruppe": "A",
        "austritt": None,
        "trikot_farbe": "blau",
        "kontakte": kontakte(),
        "name": CLUB_NAME,
        "shorthand": "AD",
    }


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, next_status: str | None = "active") -> Any:
    """The SHIPPED validators, with a history on every row so the redaction has images to empty."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            seasons = [season(SAISON_ID, "active"), season(OTHER_SAISON_ID, "past")]
            if next_status is not None:
                seasons.append(season(NEXT_SAISON_ID, next_status))
            await database[Collection.SAISONS].insert_many(seasons)
            await database[Collection.TEAMS].insert_one(
                {
                    "_id": CLUB_OID,
                    "name": CLUB_NAME,
                    "shorthand": "AD",
                    "description": "",
                    "full_name": f"{CLUB_NAME}-Schule",
                    "website_url": None,
                    "schulform": "gymnasium_g9",
                    "address": dict(ADDRESS),
                    "inactive_since": None,
                }
            )
            await database[Collection.SAISON_TEAMS].insert_one(junction_row())
            await database[Collection.BEWERBUNGEN].insert_many(the_corpus())
            # One recorded write per row, so every one has a log image holding its people.
            for document in the_corpus():
                await patch_one_in_db(
                    collection=database[Collection.BEWERBUNGEN], db_filter={"_id": document["_id"]}, update={"$set": {"kader.gute_spieler": 4}}
                )
            await patch_one_in_db(
                collection=database[Collection.SAISON_TEAMS], db_filter={"_id": JUNCTION_OID}, update={"$set": {"gruppe": "B"}}
            )

            return await body(database, client)

    return on_the_seed_loop(_run())


async def sweep(database: AsyncDatabase, client: AsyncMongoClient, saison_id: str = SAISON_ID) -> Any:
    return await sweep_saison(
        saison_id=saison_id,
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


async def erase(database: AsyncDatabase, client: AsyncMongoClient, ids: list[ObjectId], saison_id: str = SAISON_ID) -> Any:
    return await loeschen_bewerbungen(
        saison_id=saison_id,
        loeschen_data=FLBewerbungSweepLoeschenPayload(bewerbung_ids=ids),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saisons_collection=database[Collection.SAISONS],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


async def ansicht(database: AsyncDatabase, token: str) -> Any:
    return await get_einwilligung_ansicht(
        ansicht_data=FLBewerbungEinwilligungAnsichtPayload(token=token),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        teams_collection=database[Collection.TEAMS],
        today=TODAY,
    )


async def stored(database: AsyncDatabase, bewerbung_id: ObjectId) -> Mapping[str, Any] | None:
    return await database[Collection.BEWERBUNGEN].find_one({"_id": bewerbung_id})


async def log_rows_naming(database: AsyncDatabase, collection: Collection, row_id: ObjectId) -> list[Mapping[str, Any]]:
    return await database[Collection.AKTIONEN].find({"collection": str(collection), "document_id": row_id}).to_list(length=None)


async def erasure_rows(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return await database[Collection.AKTIONEN].find({"operation": "erase_many"}).sort("_id", 1).to_list(length=None)


class TestTheReminderClock:
    def test_it_stamps_mints_and_answers_one_message_per_mailbox(self, mongo_replica_set_url: str):
        """Ruling 55 and S1-ah: one message for the double-seated person with two fresh links, the first hashes kept, the deadline untouched."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await stored(database, REMIND_OID)

        response, document = on_a_league(mongo_replica_set_url, body)

        assert document is not None
        reminders = [entry for entry in response.erinnerungen if entry.bewerbung_id == REMIND_OID]
        assert [(entry.email, [seat.rolle for seat in entry.seats]) for entry in reminders] == [
            ("wraxlington@example.com", ["trainer", "ansprechperson"]),
            ("bramblewick@example.com", ["stellvertretung"]),
        ]
        assert reminders[0].schule == SCHOOL_NAME and reminders[0].bestaetigungsfrist == "2026-04-12"
        assert reminders[0].seats[0].vorname == "Wraxlington"

        first = first_hashes(str(REMIND_OID))
        for entry in reminders:
            for seat in entry.seats:
                bookkeeping = document["bestaetigungen"][seat.rolle]
                assert bookkeeping["token_hash"] == hash_token(seat.token)
                assert bookkeeping["token_hash_zuvor"] == first[seat.rolle]
                assert (bookkeeping["erinnert_am"], bookkeeping["verschickt_am"]) == (TODAY, MAILED_ON_THE_MARK)
        assert document["bestaetigungsfrist"] == "2026-04-12"

    def test_both_links_open_the_seat_afterwards(self, mongo_replica_set_url: str):
        """The reader still looking at the first email is not punished by the chase."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)
            fresh = next(
                seat.token
                for entry in response.erinnerungen
                if entry.bewerbung_id == REMIND_OID
                for seat in entry.seats
                if seat.rolle == "trainer"
            )

            return await ansicht(database, f"{REMIND_OID}-trainer"), await ansicht(database, fresh)

        old_view, new_view = on_a_league(mongo_replica_set_url, body)

        assert (old_view.zustand, old_view.rolle) == ("gueltig", "trainer")
        assert (new_view.zustand, new_view.rolle) == ("gueltig", "trainer")

    def test_a_second_run_the_same_day_reminds_nobody(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            second = await sweep(database, client)

            return second.erinnerungen

        assert on_a_league(mongo_replica_set_url, body) == []

    def test_no_raw_token_reaches_the_log_and_the_row_names_the_system(self, mongo_replica_set_url: str):
        """The stamping patch files the prior document -- hashes, never the raw tokens that leave only in the response."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)
            rows = await log_rows_naming(database, Collection.BEWERBUNGEN, REMIND_OID)

            return [seat.token for entry in response.erinnerungen for seat in entry.seats], rows

        tokens, rows = on_a_league(mongo_replica_set_url, body)

        rendered = str(rows)
        assert tokens and not any(token in rendered for token in tokens)
        # The last row is the stamping patch; the seed's own patch sits before it.
        stamping = max(rows, key=lambda row: row["_id"])
        assert stamping["operation"] == "patch_one"
        assert stamping["before"]["bestaetigungen"]["trainer"]["erinnert_am"] is None
        assert stamping["actor"]["email"] == SYSTEM_ACTOR_EMAIL


class TestTheFourteenDayClock:
    def test_the_first_call_lists_the_candidate_with_what_the_notice_needs_and_no_hash(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await stored(database, DELETE_OID)

        response, document = on_a_league(mongo_replica_set_url, body)

        assert document is not None, "the first call erased what it may only list"
        assert [entry.bewerbung_id for entry in response.loeschungen] == [DELETE_OID]
        candidate = response.loeschungen[0]
        assert (candidate.schule, candidate.bestaetigungsfrist, candidate.ansprechperson_email) == (
            SCHOOL_NAME,
            YESTERDAY,
            "wraxlington@example.com",
        )
        assert [(seat.rolle, seat.vorname) for seat in candidate.ausstehend] == [
            ("trainer", "Wraxlington"),
            ("ansprechperson", "Wraxlington"),
            ("stellvertretung", "Bramblewick"),
        ]
        # The candidates alone: the reminders beside them carry their raw tokens by design.
        rendered = str([entry.model_dump(mode="json") for entry in response.loeschungen])
        assert "token" not in rendered and "Mustermann" not in rendered

    def test_the_second_call_erases_exactly_the_delivered_ids_and_redacts_their_rows(self, mongo_replica_set_url: str):
        """Mail first, erase second: an id that does not qualify -- still inside its deadline, or another season's -- is skipped."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await erase(database, client, [DELETE_OID, REMIND_OID, OTHER_SEASON_OID])

            return (
                response,
                await stored(database, DELETE_OID),
                await stored(database, REMIND_OID),
                await stored(database, OTHER_SEASON_OID),
                await log_rows_naming(database, Collection.BEWERBUNGEN, DELETE_OID),
                await erasure_rows(database),
            )

        response, deleted, kept, other, rows, erasures = on_a_league(mongo_replica_set_url, body)

        assert (response.geloescht, deleted) == (1, None)
        assert kept is not None and other is not None
        assert rows and all(row["before"] is None and row["redacted_at"] == REDACTED_AT for row in rows)
        assert response.redigierte_aktionen == len(rows)
        # The erasure's own row: no image, a filter naming the season and the ids and nothing else, the system as actor.
        assert len(erasures) == 1
        assert erasures[0]["before"] is None
        assert set(erasures[0]["db_filter"]) == {"saison_id", "_id"}
        assert erasures[0]["actor"]["kind"] == "system"

    def test_an_empty_list_erases_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await erase(database, client, [])

            return response.geloescht, await database[Collection.BEWERBUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == (0, 5)


class TestTheOneMonthClock:
    def test_a_declined_application_a_month_old_is_erased_and_its_rows_redacted_in_the_first_call(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await stored(database, DECLINED_OID), await log_rows_naming(database, Collection.BEWERBUNGEN, DECLINED_OID)

        response, document, rows = on_a_league(mongo_replica_set_url, body)

        assert (response.abgelehnte_geloescht, document) == (1, None)
        assert rows and all(row["before"] is None for row in rows)

    def test_another_seasons_application_is_not_reached(self, mongo_replica_set_url: str):
        """One season per call: the other season's declined application is a month old too and stays."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)

            return await stored(database, OTHER_SEASON_OID), await erasure_rows(database)

        other, erasures = on_a_league(mongo_replica_set_url, body)

        assert other is not None
        assert all(row["db_filter"]["saison_id"] == SAISON_ID for row in erasures)


class TestTheSeasonAndOneClock:
    def test_nothing_goes_while_the_next_season_runs(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await stored(database, ACCEPTED_OID), await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID})

        response, document, row = on_a_league(mongo_replica_set_url, body, next_status="active")

        assert (response.angenommene_geloescht, response.kontaktbloecke_geleert) == (0, 0)
        assert document is not None and row is not None and row["kontakte"] is not None

    def test_the_application_goes_and_the_contact_block_empties_once_the_next_season_is_past(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return (
                response,
                await stored(database, ACCEPTED_OID),
                await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID}),
                await log_rows_naming(database, Collection.SAISON_TEAMS, JUNCTION_OID),
            )

        response, document, row, junction_log = on_a_league(mongo_replica_set_url, body, next_status="past")

        assert (response.angenommene_geloescht, response.kontaktbloecke_geleert, document) == (1, 1, None)
        assert row is not None and row["kontakte"] is None
        # The block's own keys survive around the clearing: the row is still a junction row.
        assert (row["gruppe"], row["trikot_farbe"]) == ("B", "blau")
        assert junction_log and all(entry["before"] is None and entry["redacted_at"] == REDACTED_AT for entry in junction_log)

    def test_a_season_with_no_successor_yet_keeps_everything(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response.angenommene_geloescht, response.kontaktbloecke_geleert

        assert on_a_league(mongo_replica_set_url, body, next_status=None) == (0, 0)


class TestASeasonNobodyHas:
    def test_either_call_is_a_404_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await sweep(database, client, saison_id="1999")
            with pytest.raises(DocumentNotFoundException):
                await erase(database, client, [DELETE_OID], saison_id="1999")

            return await database[Collection.BEWERBUNGEN].count_documents({}), await erasure_rows(database)

        assert on_a_league(mongo_replica_set_url, body) == (5, [])


def through_the_app(url: str, path: str, body: Mapping[str, Any] | None, *, key: str) -> tuple[int, list[Mapping[str, Any]]]:
    """One call over the wire, so the guard, the system binder and the route template all run."""

    database_name = build_test_config().db_base_name

    client = MongoClient(url)
    try:
        database = a_clean_database_sync(client, url, database_name)
        database[Collection.SAISONS].insert_many([season(SAISON_ID, "active"), season(OTHER_SAISON_ID, "past")])
        database[Collection.BEWERBUNGEN].insert_one(application(DELETE_OID, bestaetigungsfrist=YESTERDAY))

        async def _called() -> int:
            app = create_app(build_test_config())
            app.state.db_client = AsyncMongoClient(host=url, serverSelectionTimeoutMS=30_000)
            app.dependency_overrides[get_germany_now] = lambda: NOW

            try:
                transport = ASGITransport(app=app, raise_app_exceptions=False)
                async with AsyncClient(transport=transport, base_url=TEST_BASE_URL) as http:
                    response = await http.post(f"/api/v{API_VERSION}{path}", json=body, headers={"Authorization": f"Bearer {key}"})
                    return response.status_code
            finally:
                await app.state.db_client.close()

        status = asyncio.run(_called())

        return status, list(database[Collection.AKTIONEN].find({"operation": "erase_many"}))
    finally:
        client.close()


class TestTheSystemTierOverTheWire:
    """On the replica set: the erasure runs in a transaction, which a standalone mongod refuses outright."""

    def test_the_erasure_records_the_system_actor_and_the_route_template(self, mongo_replica_set_url: str):
        """What `bind_system_actor` buys: the row names the machine and the endpoint, not an invented person or a raw path."""

        status, rows = through_the_app(
            mongo_replica_set_url, f"/bewerbungen/sweep/{SAISON_ID}/loeschen", {"bewerbung_ids": [str(DELETE_OID)]}, key="test-key-system"
        )

        assert status == 200
        assert len(rows) == 1
        assert rows[0]["actor"] == {"kind": "system", "email": SYSTEM_ACTOR_EMAIL}
        assert rows[0]["request"] == {"method": "POST", "path": f"/api/v{API_VERSION}/bewerbungen/sweep/{{saison_id}}/loeschen"}

    @pytest.mark.parametrize("key", ["test-key-base", "test-key-admin"])
    def test_neither_other_key_reaches_it(self, mongo_replica_set_url: str, key: str):
        """The other two keys are refused as the wrong credential before any body is read, so nothing is erased."""

        status, rows = through_the_app(
            mongo_replica_set_url, f"/bewerbungen/sweep/{SAISON_ID}/loeschen", {"bewerbung_ids": [str(DELETE_OID)]}, key=key
        )

        assert status == 401
        assert rows == []


class TestTheSeasonList:
    def test_every_season_is_listed_oldest_first_whatever_its_status(self, mongo_replica_set_url: str):
        """`docs/backend/spec.md :: I47` keeps a `future` season off the base tier, and that is the season the clocks run over."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            return await get_sweep_saisons(saisons_collection=database[Collection.SAISONS])

        response = on_a_league(mongo_replica_set_url, body, next_status="future")

        assert response.saison_ids == [OTHER_SAISON_ID, SAISON_ID, NEXT_SAISON_ID]
