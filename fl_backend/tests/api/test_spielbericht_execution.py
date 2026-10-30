"""
API · a fixture's report written, read and judged against the shipped indexes

The report writes its own document alone: never the fixture, whose result the administrator saves.
"""

from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import Response
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spielberichte.admin_router import get_spielbericht_admin, get_spielberichte, patch_spielbericht
from app.api.spielberichte.crud import count_eingereichte_berichte
from app.api.spielberichte.person_router import get_spielbericht_bericht, get_spielberichte_person, put_spielbericht_bericht
from app.api.spielberichte.schemas import FLSpielberichtPayload
from app.api.spiele.admin_router import get_spiele_action_required, patch_spiel_data
from app.api.spiele.schemas import (
    FLPatchSpielDataPayload,
)
from app.core.codes import Code
from app.core.collections import Collection
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.isolation import COMMITTED, InterleavedCollection, outcome_of
from tests.payloads import spiel_patch_body
from tests.records import record_collections
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spielbericht_test")

SAISON_ID = "2027"
VORSAISON_ID = "2026"
DATUM = "2027-05-14"
NOW = datetime(2027, 5, 14, 21, tzinfo=ZoneInfo("Europe/Berlin"))
TODAY = "2027-05-14"

TEAM1 = ObjectId("6890a1b2c3d4e5f607e50001")
TEAM2 = ObjectId("6890a1b2c3d4e5f607e50002")
SPIEL = ObjectId("6890a1b2c3d4e5f607e50011")
VIERTELFINALE = ObjectId("6890a1b2c3d4e5f607e50012")
SPIELTAG = ObjectId("6890a1b2c3d4e5f607e50021")
SPIELORT = ObjectId("6890a1b2c3d4e5f607e50031")
SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f607e50041")
ANDERER = ObjectId("6890a1b2c3d4e5f607e50042")
LINA = ObjectId("6890a1b2c3d4e5f607e50051")
OLE = ObjectId("6890a1b2c3d4e5f607e50052")
MIA = ObjectId("6890a1b2c3d4e5f607e50053")

REFEREE_EMAIL = "otto.gruber@example.com"
OTHER_REFEREE_EMAIL = "ella.engel@example.com"
NOBODY = "niemand@example.com"

NAMES = {TEAM1: ("Adler", "ADX"), TEAM2: ("Biber", "BIX")}
PEOPLE = {TEAM1: ("Ida", "Albers"), TEAM2: ("Lea", "Dietz")}


def side(team_id: ObjectId) -> dict[str, Any]:
    name, shorthand = NAMES[team_id]
    return {"team_id": team_id, "name": name, "shorthand": shorthand, "tore": None}


def fixture(*, spiel_id: ObjectId = SPIEL, spiel_nr: int = 1, saison_id: str = SAISON_ID, **fields: Any) -> dict[str, Any]:
    """A round-of-16 tie played today whose winner the quarter-final draws from, booked to the referee."""

    return documents.spiel_document(
        spiel_id=spiel_id,
        saison_id=saison_id,
        spiel_nr=spiel_nr,
        spieltag_id=SPIELTAG,
        **{
            "saison_phase": "achtelfinale",
            "team1": side(TEAM1),
            "team2": side(TEAM2),
            "datum": DATUM,
            "uhrzeit": "18:00:00",
            "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER, "name": "Otto Gruber", "payment": 20},
            "ort": {"spielort_id": SPIELORT, "name": "Halle Ost", "maps_link": "Halle Ost, Frankfurt", "mietpreis": 40},
            **fields,
        },
    )


def referee(referee_id: ObjectId, name: str, email: str) -> dict[str, Any]:
    return documents.schiedsrichter_document(
        referee_id,
        email=email,
        name=name,
        default_payment=20,
        einwilligung=documents.eigene_einwilligung_document(text_version="2027-01-schiedsrichterseite-1", bestaetigt_am="2027-01-10"),
    )


async def seed(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
    for team_id, (name, shorthand) in NAMES.items():
        vorname, nachname = PEOPLE[team_id]
        await database[Collection.TEAMS].insert_one(documents.team_document(team_id, name, shorthand))
        await database[Collection.SAISON_TEAMS].insert_one(
            documents.saison_team_document(
                SAISON_ID,
                team_id,
                name,
                shorthand,
                kontakte=documents.kontakte_document(
                    trainer=documents.kontaktperson_document(vorname, nachname=nachname, email=f"{vorname.lower()}@example.com")
                ),
            )
        )
    await database[Collection.SPIELER].insert_many(
        [
            documents.spieler_document(LINA, "Lina", "Krause"),
            documents.spieler_document(OLE, "Ole", "Brettschneider"),
            documents.spieler_document(MIA, "Mia", "Westphal"),
        ]
    )
    await database[Collection.SAISON_SPIELER].insert_many(
        [
            documents.saison_spieler_document(LINA, SAISON_ID, TEAM1, nummer="7"),
            documents.saison_spieler_document(OLE, SAISON_ID, TEAM1, inactive_since="2027-05-01"),
            documents.saison_spieler_document(MIA, SAISON_ID, TEAM2, nummer="9"),
        ]
    )
    await database[Collection.SPIELORTE].insert_one(
        {
            "_id": SPIELORT,
            "name": "Halle Ost",
            "address": dict(documents.ADDRESS),
            "maps_link": "Halle Ost, Frankfurt",
            "default_mietpreis": 40,
            "inactive_since": None,
        }
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [referee(SCHIEDSRICHTER, "Otto Gruber", REFEREE_EMAIL), referee(ANDERER, "Ella Engel", OTHER_REFEREE_EMAIL)]
    )
    await database[Collection.SPIELE].insert_many(
        [
            fixture(),
            documents.spiel_document(
                spiel_id=VIERTELFINALE,
                saison_id=SAISON_ID,
                spiel_nr=2,
                spieltag_id=SPIELTAG,
                saison_phase="viertelfinale",
                team1_quelle={"type": "spiel", "spiel_nr": 1, "ausgang": "sieger"},
            ),
        ]
    )


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_the_league(url: str, body: Body) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME) as (client, database):
            await seed(database)
            return await body(database, client)

    return on_the_seed_loop(_run())


def tor(seite: str, spieler_id: ObjectId | None, minute: str = "23") -> dict[str, Any]:
    return {"seite": seite, "spieler_id": spieler_id, "minute": minute, "eigentor": False}


def bericht(
    team1: int = 1, team2: int = 0, torschuetzen: list[dict[str, Any]] | None = None, *, stand: int | None = None, **fields: Any
) -> dict[str, Any]:
    """A write composed on version `stand` of the report, none by default: the form opened on no report."""

    return {
        "bericht": {
            "ergebnis_vorschlag": {"team1_tore": team1, "team2_tore": team2, "elfmeterschiessen": None, "sonderereignis": None},
            "torschuetzen": [tor("team1", LINA)] if torschuetzen is None else torschuetzen,
            "karten": [{"seite": "team2", "spieler_id": MIA, "minute": "45+2", "farbe": "gelb", "grund": "foulspiel"}],
            "bemerkungen": None,
            **fields,
        },
        "bericht_stand": stand,
    }


def handles(database: AsyncDatabase, **replaced: Any) -> dict[str, Any]:
    return {
        "spiele_collection": database[Collection.SPIELE],
        "saisons_collection": database[Collection.SAISONS],
        "saison_spieler_collection": database[Collection.SAISON_SPIELER],
        "spieler_collection": database[Collection.SPIELER],
        "spielberichte_collection": database[Collection.SPIELBERICHTE],
        **replaced,
    }


async def put(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    body: dict[str, Any],
    *,
    email: str = REFEREE_EMAIL,
    response: Response | None = None,
    spiel_id: ObjectId = SPIEL,
    **replaced: Any,
) -> Any:
    return await put_spielbericht_bericht(
        spiel_id=spiel_id,
        bericht_data=FLSpielberichtPayload.model_validate(body),
        response=Response() if response is None else response,
        identifier=email,
        records=record_collections(database),
        db=client,
        today=TODAY,
        now=NOW,
        **handles(database, **replaced),
    )


async def patch(database: AsyncDatabase, client: AsyncMongoClient, body: dict[str, Any], **replaced: Any) -> Any:
    return await patch_spielbericht(
        spiel_id=SPIEL,
        bericht_data=FLSpielberichtPayload.model_validate(body),
        db=client,
        today=TODAY,
        now=NOW,
        **handles(database, **replaced),
    )


async def form_read(database: AsyncDatabase, client: AsyncMongoClient, *, email: str = REFEREE_EMAIL) -> Any:
    return await get_spielbericht_bericht(
        spiel_id=SPIEL, identifier=email, records=record_collections(database), db=client, today=TODAY, **handles(database)
    )


async def stored(database: AsyncDatabase) -> list[dict[str, Any]]:
    return await database[Collection.SPIELBERICHTE].find({}).to_list()


class TestTheReportNeverWritesTheFixture:
    def test_the_fixture_and_the_tie_it_feeds_stay_as_stored(self, mongo_replica_set_url: str):
        """A knockout feeder: a report written into the result would resolve the quarter-final's side and log the fixtures."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await database[Collection.SPIELE].find({}).sort("_id").to_list()
            await put(database, client, bericht(2, 1, [tor("team1", LINA), tor("team1", None), tor("team2", MIA)]))
            after = await database[Collection.SPIELE].find({}).sort("_id").to_list()
            logged = await database[Collection.AKTIONEN].distinct("collection")

            return before == after, logged

        unchanged, logged = on_the_league(mongo_replica_set_url, body)

        assert unchanged
        assert logged == ["spielberichte"]


class TestTheFirstWriteCreatesAndEveryWriteRaisesTheVersion:
    def test_a_correction_replaces_the_block_and_keeps_who_first_sent_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            created, corrected = Response(), Response()
            first = await put(database, client, bericht(), response=created)
            await put(
                database,
                client,
                bericht(1, 1, [tor("team1", LINA), tor("team2", MIA)], stand=1, bemerkungen="Starker Regen ab der Pause."),
                response=corrected,
            )
            await patch(database, client, bericht(2, 1, [tor("team1", LINA), tor("team1", LINA, "80"), tor("team2", MIA)], stand=2))

            return first, (created.status_code, corrected.status_code), await stored(database)

        first, statuses, documents_now = on_the_league(mongo_replica_set_url, body)

        # RFC 9110's PUT: the write creating the report answers 201, a later one 200.
        assert statuses == (201, 200)
        assert first.bericht.version == 1
        assert first.kader.team1[0].spieler_id == LINA and [spieler.spieler_id for spieler in first.kader.team1] == [LINA]
        [document] = documents_now
        block = document["bericht"]
        assert (block["version"], block["ergebnis_vorschlag"]["team1_tore"], block["bemerkungen"]) == (3, 2, None)
        # The referee sent it first: the administrator's correction takes nothing of that away.
        assert block["eingereicht_von"] == {"art": "schiedsrichter", "schiedsrichter_id": SCHIEDSRICHTER}
        assert block["uebernommene_version"] is None

    def test_a_report_an_administrator_writes_first_names_an_administrator(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answered = await patch(database, client, bericht())
            return answered, (await stored(database))[0]["bericht"]["eingereicht_von"]

        answered, von = on_the_league(mongo_replica_set_url, body)

        assert von == {"art": "admin"}
        # No result stands on the fixture, so the report proposes.
        assert answered.zustand == "vorgeschlagen"


class TestASaveChangingNothingWritesNothing:
    def test_the_version_and_the_log_stay_as_the_first_save_left_them(self, mongo_replica_set_url: str):
        """A second save of the same content: a raised version would return an adopted report to `abweichend`."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await put(database, client, bericht(bemerkungen="Starker Regen."))
            again = await outcome_of(put(database, client, bericht(stand=1, bemerkungen="Starker Regen.")))
            logged = await database[Collection.AKTIONEN].count_documents({"collection": str(Collection.SPIELBERICHTE)})

            return again, (await stored(database))[0]["bericht"], logged

        again, block, logged = on_the_league(mongo_replica_set_url, body)

        assert again == COMMITTED
        assert (block["version"], logged) == (1, 1)


class TestAFormOpenedBeforeAnotherWrite:
    """Each write replaces the whole block, so one composed on an older version would put back what a later write changed."""

    def test_the_referee_s_form_is_refused_after_the_administrator_corrected_the_report(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await put(database, client, bericht())
            await patch(database, client, bericht(2, 0, [tor("team1", LINA), tor("team1", None)], stand=1))
            stale = await outcome_of(put(database, client, bericht(stand=1, bemerkungen="Starker Regen.")))
            fresh = await outcome_of(
                put(database, client, bericht(2, 0, [tor("team1", LINA), tor("team1", None)], stand=2, bemerkungen="Regen."))
            )

            return stale, fresh, (await stored(database))[0]["bericht"]

        stale, fresh, block = on_the_league(mongo_replica_set_url, body)

        assert stale == Code.BERICHT_INZWISCHEN_GEAENDERT
        # A form reloaded on the correction writes as any other.
        assert fresh == COMMITTED
        assert (block["version"], block["ergebnis_vorschlag"]["team1_tore"], block["bemerkungen"]) == (3, 2, "Regen.")

    def test_the_administrator_s_page_is_refused_after_the_referee_corrected_the_report(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await patch(database, client, bericht())
            await put(database, client, bericht(1, 1, [tor("team1", LINA), tor("team2", MIA)], stand=1))
            stale = await outcome_of(patch(database, client, bericht(stand=1, bemerkungen="Starker Regen.")))

            return stale, (await stored(database))[0]["bericht"]

        stale, block = on_the_league(mongo_replica_set_url, body)

        assert stale == Code.BERICHT_INZWISCHEN_GEAENDERT
        assert (block["version"], block["ergebnis_vorschlag"]["team2_tore"], block["bemerkungen"]) == (2, 1, None)

    def test_a_first_write_crossing_another_is_refused_on_its_retry(self, mongo_replica_set_url: str):
        """The administrator's first write commits inside the referee's: the insert conflicts, and the retry meets version 1.

        MongoDB answers the insert a write conflict, never a duplicate key, so the refusal is the stale form's.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # Naming no pupil: the referee's write holds its own pupils' anchors, which the rival would wait on.
            berichte = BerichteRunningARivalBeforeTheirWrite(
                database[Collection.SPIELBERICHTE],
                lambda: patch(database, client, bericht(2, 0, [tor("team1", None), tor("team1", None)], karten=[])),
            )
            outcome = await outcome_of(put(database, client, bericht(), spielberichte_collection=berichte))

            return outcome, await stored(database), berichte.passes

        outcome, documents_now, passes = on_the_league(mongo_replica_set_url, body)

        assert outcome == Code.BERICHT_INZWISCHEN_GEAENDERT
        [document] = documents_now
        block = document["bericht"]
        # The administrator's 2:0 stands as it was written; the referee's 1:0 took nothing of it.
        assert (block["version"], block["eingereicht_von"], block["ergebnis_vorschlag"]["team1_tore"]) == (1, {"art": "admin"}, 2)
        # The insert was reached once: the retry was refused before reaching a write.
        assert passes == 1


async def call_off(database: AsyncDatabase) -> None:
    await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": "ausgefallen"}})


async def move_to_tomorrow(database: AsyncDatabase) -> None:
    await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"datum": "2027-05-15"}})


async def nothing(_: AsyncDatabase) -> None:
    return None


async def end_the_season(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"status": "past"}})


class TestEachRefusalWritesNothing:
    @pytest.mark.parametrize(
        ("email", "before", "body", "code"),
        [
            pytest.param(NOBODY, nothing, bericht(), Code.FUNKTION_NICHT_GEHALTEN, id="no referee record"),
            pytest.param(OTHER_REFEREE_EMAIL, nothing, bericht(), Code.BERICHT_NICHT_GELEITET, id="another referee"),
            pytest.param(REFEREE_EMAIL, move_to_tomorrow, bericht(), Code.BERICHT_NICHT_GESPIELT, id="a day still to come"),
            pytest.param(
                REFEREE_EMAIL, nothing, bericht(torschuetzen=[tor("team1", MIA)]), Code.BERICHT_NICHT_IM_KADER, id="the other side's pupil"
            ),
        ],
    )
    def test_the_referee_s_write_is_refused(
        self, mongo_replica_set_url: str, email: str, before: Callable[[AsyncDatabase], Awaitable[None]], body: dict[str, Any], code: str
    ):
        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await before(database)
            return await outcome_of(put(database, client, body, email=email)), await stored(database)

        outcome, documents_now = on_the_league(mongo_replica_set_url, run)

        assert outcome == code
        assert documents_now == []

    def test_an_ended_season_is_refused_before_a_stale_stand(self, mongo_replica_set_url: str):
        """Composed on no report where version 1 stands: only the season's check inside the transaction answers ahead of the stand's."""

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await put(database, client, bericht())
            await end_the_season(database)
            outcome = await outcome_of(put(database, client, bericht(torschuetzen=[tor("team1", LINA, "24")])))
            return outcome, [document["bericht"]["version"] for document in await stored(database)]

        assert on_the_league(mongo_replica_set_url, run) == (Code.SAISON_PAST, [1])

    def test_a_correction_after_the_season_s_strip_resends_its_cautions_without_their_reasons(self, mongo_replica_set_url: str):
        """The strip deleted the yellow's reason; the administrator corrects the scorer's minute, and adds no caution."""

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await put(database, client, bericht())
            await database[Collection.SPIELBERICHTE].update_one({"spiel_id": SPIEL}, {"$set": {"bericht.karten.$[].grund": None}})
            korrektur = bericht(torschuetzen=[tor("team1", LINA, "24")], stand=1)
            korrektur["bericht"]["karten"][0]["grund"] = None
            return await outcome_of(patch(database, client, korrektur))

        assert on_the_league(mongo_replica_set_url, run) == COMMITTED

    def test_a_correction_keeps_a_scorer_ausgetragen_since_the_match(self, mongo_replica_set_url: str):
        """Only a pupil the write newly names is judged against the live squad."""

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await put(database, client, bericht())
            await database[Collection.SAISON_SPIELER].update_one({"spieler_id": LINA}, {"$set": {"inactive_since": "2027-05-14"}})
            corrected = await outcome_of(put(database, client, bericht(torschuetzen=[tor("team1", LINA, "24")], stand=1)))
            read = await form_read(database, client)
            return corrected, read

        corrected, read = on_the_league(mongo_replica_set_url, run)

        assert corrected == COMMITTED
        # Off the live squad, and still named on the form.
        assert read.kader.team1 == []
        assert [(spieler.spieler_id, spieler.nachname) for spieler in read.genannt] == [(LINA, "Krause")]


class BerichteRunningARivalBeforeTheirWrite(InterleavedCollection):
    async def insert_one(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.insert_one(*args, **kwargs)


async def take_the_referee_off(database: AsyncDatabase) -> None:
    await database[Collection.SPIELE].update_one(
        {"_id": SPIEL}, {"$set": {"schiedsrichter": {"schiedsrichter_id": ANDERER, "name": "Ella Engel", "payment": 20}}}
    )


async def take_lina_out_of_the_squad(database: AsyncDatabase) -> None:
    await database[Collection.SAISON_SPIELER].update_one({"spieler_id": LINA}, {"$set": {"inactive_since": TODAY}})


async def retire_the_referee(database: AsyncDatabase) -> None:
    await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER}, {"$set": {"inactive_since": TODAY}})


class TestWhatTheReportIsJudgedOnMovingMidWriteIsJudgedAgain:
    """Each a write the report's transaction reads and never writes, so none conflicts: the re-judgement outside it is all that sees them."""

    @pytest.mark.parametrize(
        ("writer", "rival", "code"),
        [
            pytest.param("referee", retire_the_referee, Code.FUNKTION_NICHT_GEHALTEN, id="the-referee-s-record-retired"),
            pytest.param("referee", take_the_referee_off, Code.BERICHT_NICHT_GELEITET, id="the-referee-taken-off"),
            *(
                pytest.param(writer, rival, code, id=f"{writer}-{name}")
                for writer in ("referee", "admin")
                for rival, code, name in (
                    (call_off, Code.BERICHT_ABGESAGT, "the-fixture-called-off"),
                    (take_lina_out_of_the_squad, Code.BERICHT_NICHT_IM_KADER, "the-scorer-ausgetragen"),
                )
            ),
        ],
    )
    def test_the_write_is_refused_on_what_moved_and_writes_nothing(
        self, mongo_replica_set_url: str, writer: str, rival: Callable[[AsyncDatabase], Awaitable[None]], code: str
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            berichte = BerichteRunningARivalBeforeTheirWrite(database[Collection.SPIELBERICHTE], lambda: rival(database))
            write = put if writer == "referee" else patch
            outcome = await outcome_of(write(database, client, bericht(), spielberichte_collection=berichte))
            berichte.assert_landed_inside(serially=0)

            return outcome, await stored(database), berichte.passes

        outcome, documents_now, passes = on_the_league(mongo_replica_set_url, body)

        assert (outcome, documents_now) == (code, [])
        # Once: none of these conflicts, so a retry would mean the rival was caught some other way.
        assert passes == 1

    def test_a_correction_is_refused_on_the_season_ending_under_it(self, mongo_replica_set_url: str):
        """A correction, since a first write anchors the season and so conflicts with its end."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await put(database, client, bericht())
            berichte = BerichteRunningARivalBeforeTheirCorrection(database[Collection.SPIELBERICHTE], lambda: end_the_season(database))
            korrektur = bericht(torschuetzen=[tor("team1", LINA, "24")], stand=1)
            outcome = await outcome_of(put(database, client, korrektur, spielberichte_collection=berichte))
            berichte.assert_landed_inside(serially=0)

            return outcome, [document["bericht"]["version"] for document in await stored(database)], berichte.passes

        outcome, versions, passes = on_the_league(mongo_replica_set_url, body)

        assert (outcome, versions) == (Code.SAISON_PAST, [1])
        assert passes == 1

    def test_a_first_write_conflicts_with_the_season_ending_under_it(self, mongo_replica_set_url: str):
        """The season's anchor conflicts with the end, so a retry refuses the write in its transaction.

        Unanchored, the write meets the end only in its judgement outside the transaction, as a correction does above.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            berichte = BerichteRunningARivalBeforeTheirWrite(database[Collection.SPIELBERICHTE], lambda: end_the_season(database))
            saisons = SaisonsCountingTheAttempts(database[Collection.SAISONS])
            outcome = await outcome_of(put(database, client, bericht(), spielberichte_collection=berichte, saisons_collection=saisons))
            berichte.assert_landed_inside(serially=0)

            return outcome, await stored(database), saisons.attempts

        outcome, documents_now, attempts = on_the_league(mongo_replica_set_url, body)

        assert (outcome, documents_now) == (Code.SAISON_PAST, [])
        assert attempts == 2, "the season's end conflicted with nothing the write wrote"


class SaisonsCountingTheAttempts:
    """Every attempt of the write's transaction reads the fixture's season once inside it, so those reads count the attempts."""

    def __init__(self, collection: Any) -> None:
        self._collection = collection
        self.attempts = 0

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        if kwargs.get("session") is not None:
            self.attempts += 1
        return await self._collection.find_one(*args, **kwargs)


class BerichteRunningARivalBeforeTheirCorrection(InterleavedCollection):
    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.find_one_and_update(*args, **kwargs)


class PupilsRunningARivalBeforeTheAnchor(InterleavedCollection):
    async def update_many(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.update_many(*args, **kwargs)


class TestAPupilErasedMidWriteConflictsWithTheAnchor:
    def test_the_write_retries_and_is_refused_on_the_squad_the_erasure_left(self, mongo_replica_set_url: str):
        """The erasure removes the squad row and the person after this write judged them: the anchor on the person conflicts."""

        async def erase_lina(database: AsyncDatabase) -> None:
            await database[Collection.SAISON_SPIELER].delete_one({"spieler_id": LINA})
            await database[Collection.SPIELER].delete_one({"_id": LINA})

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler = PupilsRunningARivalBeforeTheAnchor(database[Collection.SPIELER], lambda: erase_lina(database))
            berichte = BerichteRunningARivalBeforeTheirWrite(database[Collection.SPIELBERICHTE], lambda: nothing(database))
            outcome = await outcome_of(put(database, client, bericht(), spieler_collection=spieler, spielberichte_collection=berichte))
            spieler.assert_landed_inside(serially=0)

            return outcome, await stored(database), berichte.passes

        outcome, documents_now, writes = on_the_league(mongo_replica_set_url, body)

        assert (outcome, documents_now) == (Code.BERICHT_NICHT_IM_KADER, [])
        # Never written: the anchor's conflict retried the transaction, whose judgement met the squad without her. An
        # anchor the erasure missed lets the write through, to be refused by the re-judgement outside the transaction.
        assert writes == 0


class TestThePanelsReadServesTheSquadsOnlyWhereAsked:
    def test_the_squads_come_with_kader_and_the_named_pupils_by_name_either_way(self, mongo_replica_set_url: str):
        """The editor's panel reads every render and picks no pupil; the correction's form asks for the squads it picks from."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            ohne_bericht = await get_spielbericht_admin(spiel_id=SPIEL, db=client, **handles(database))
            await put(database, client, bericht())
            panel = await get_spielbericht_admin(spiel_id=SPIEL, db=client, **handles(database))
            korrektur = await get_spielbericht_admin(spiel_id=SPIEL, db=client, kader=True, **handles(database))
            return ohne_bericht, panel, korrektur

        ohne_bericht, panel, korrektur = on_the_league(mongo_replica_set_url, body)

        for read in (ohne_bericht, panel):
            assert (read.kader.team1, read.kader.team2) == ([], [])
        assert ohne_bericht.genannt == []
        assert sorted((spieler.spieler_id, spieler.nachname) for spieler in panel.genannt) == [(LINA, "Krause"), (MIA, "Westphal")]
        assert ([spieler.spieler_id for spieler in korrektur.kader.team1], [spieler.spieler_id for spieler in korrektur.kader.team2]) == (
            [LINA],
            [MIA],
        )
        # Named off the squads served, so the form's pickers hold them once.
        assert korrektur.genannt == []


class TestTheReads:
    def test_the_booked_referee_alone_reads_the_form(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            def read(email: str) -> Any:
                return form_read(database, client, email=email)

            return await read(REFEREE_EMAIL), await outcome_of(read(OTHER_REFEREE_EMAIL))

        form, other = on_the_league(mongo_replica_set_url, body)

        assert other == Code.BERICHT_NICHT_GELEITET
        assert (form.bericht, form.spiel.team1.name, form.spiel.saison_phase) == (None, "Adler", "achtelfinale")
        # Live squads alone, each pupil with the number a picker shows.
        assert [(spieler.spieler_id, spieler.nummer) for spieler in form.kader.team1] == [(LINA, "7")]
        assert [spieler.spieler_id for spieler in form.kader.team2] == [MIA]

    def test_a_fixture_taking_no_report_serves_no_squad(self, mongo_replica_set_url: str):
        """Only the pupils the stored report names, by name: the squads are served for picking, and nothing is picked here.

        One fixture taking none, the read's wiring; which fixtures take one is `nimmt_einen_bericht`'s, held in the shapes.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await put(database, client, bericht())
            await move_to_tomorrow(database)
            return await form_read(database, client)

        form = on_the_league(mongo_replica_set_url, body)

        assert (form.kader.team1, form.kader.team2) == ([], [])
        assert form.bericht is not None
        assert sorted((spieler.spieler_id, spieler.nachname) for spieler in form.genannt) == [(LINA, "Krause"), (MIA, "Westphal")]

    @pytest.mark.parametrize(
        "lesen",
        [
            pytest.param(lambda database, client: get_spielbericht_admin(spiel_id=SPIEL, db=client, **handles(database)), id="the-panel"),
            pytest.param(form_read, id="the-referee-s-form"),
        ],
    )
    def test_a_pupil_off_both_squads_is_named_off_their_record_and_an_erased_one_by_nobody(
        self, mongo_replica_set_url: str, lesen: Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]
    ):
        """The two arms past the squad rows on both reads a page renders: no bare id shown, an erased pupil's entry still holding it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await put(database, client, bericht())
            await database[Collection.SAISON_SPIELER].update_one({"spieler_id": LINA}, {"$set": {"team_id": ObjectId()}})
            await database[Collection.SAISON_SPIELER].delete_one({"spieler_id": MIA})
            await database[Collection.SPIELER].delete_one({"_id": MIA})
            return await lesen(database, client)

        answer = on_the_league(mongo_replica_set_url, body)

        assert sorted((spieler.spieler_id, spieler.nachname) for spieler in answer.genannt) == [(LINA, "Krause"), (MIA, None)]

    def test_after_the_season_the_referee_reads_the_report_alone(self, mongo_replica_set_url: str):
        """Played and standing, so only the season's end decides: the persons the report names, no squad to pick from."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await put(database, client, bericht())
            before = await form_read(database, client)
            await end_the_season(database)
            return before, await form_read(database, client)

        before, after = on_the_league(mongo_replica_set_url, body)

        assert (before.abgeschlossen, after.abgeschlossen) == (False, True)
        assert (after.kader.team1, after.kader.team2) == ([], [])
        assert after.bericht == before.bericht
        assert sorted((spieler.spieler_id, spieler.nachname) for spieler in after.genannt) == [(LINA, "Krause"), (MIA, "Westphal")]

    def test_the_referee_s_list_holds_their_played_fixtures_and_whether_a_report_stands(self, mongo_replica_set_url: str):
        """Each clause of the filter has a fixture failing it alone, and no running season lists none.

        The earlier played fixture holds the order.
        """

        frueher, anderer, morgen, abgesagt, vorjahr = (ObjectId() for _ in range(5))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELE].insert_many(
                [
                    fixture(spiel_id=frueher, spiel_nr=11, datum="2027-05-07"),
                    fixture(spiel_id=anderer, spiel_nr=12, schiedsrichter={"schiedsrichter_id": ANDERER, "name": "Ella Engel", "payment": 20}),
                    fixture(spiel_id=morgen, spiel_nr=13, datum="2027-05-15"),
                    fixture(spiel_id=abgesagt, spiel_nr=14, sonderereignis="ausgefallen"),
                    fixture(spiel_id=vorjahr, spiel_nr=15, saison_id=VORSAISON_ID, datum="2026-05-07"),
                ]
            )

            def listed() -> Any:
                return get_spielberichte_person(
                    identifier=REFEREE_EMAIL,
                    spiele_collection=database[Collection.SPIELE],
                    saisons_collection=database[Collection.SAISONS],
                    spielberichte_collection=database[Collection.SPIELBERICHTE],
                    records=record_collections(database),
                    db=client,
                    today=TODAY,
                )

            before = await listed()
            await put(database, client, bericht())
            after = await listed()
            # Past, the last season running: `spiele` is of the running season, never the newest one.
            await end_the_season(database)
            return before, after, await listed()

        before, after, ohne_saison = on_the_league(mongo_replica_set_url, body)

        assert [(spiel.spiel_id, spiel.eingereicht_am) for spiel in before.spiele] == [(SPIEL, None), (frueher, None)]
        assert after.spiele[0].eingereicht_am is not None
        assert ohne_saison.spiele == []

    def test_the_referee_s_list_holds_the_reports_of_ended_seasons_apart(self, mongo_replica_set_url: str):
        """Of an ended season, only a fixture booked to them now holding a report its page shows read-only, an undated one last.

        The season before's unreported fixture, the other referee's and the running season's stay out.
        """

        unberichtet, anderer, undatiert = ObjectId(), ObjectId(), ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_the_season_before(database)
            ohne_datum = fixture(spiel_id=undatiert, spiel_nr=23, saison_id=VORSAISON_ID, datum=None, uhrzeit=None)
            await database[Collection.SPIELE].insert_many(
                [
                    fixture(spiel_id=unberichtet, spiel_nr=21, saison_id=VORSAISON_ID, datum="2026-05-07"),
                    fixture(
                        spiel_id=anderer,
                        spiel_nr=22,
                        saison_id=VORSAISON_ID,
                        schiedsrichter={"schiedsrichter_id": ANDERER, "name": "Ella Engel", "payment": 20},
                    ),
                    ohne_datum,
                ]
            )
            await database[Collection.SPIELBERICHTE].insert_many(
                [
                    documents.spielbericht_document(fixture(spiel_id=anderer, saison_id=VORSAISON_ID)),
                    documents.spielbericht_document(ohne_datum),
                ]
            )
            await put(database, client, bericht())

            return await get_spielberichte_person(
                identifier=REFEREE_EMAIL,
                spiele_collection=database[Collection.SPIELE],
                saisons_collection=database[Collection.SAISONS],
                spielberichte_collection=database[Collection.SPIELBERICHTE],
                records=record_collections(database),
                db=client,
                today=TODAY,
            )

        listed = on_the_league(mongo_replica_set_url, body)

        assert [spiel.spiel_id for spiel in listed.spiele] == [SPIEL]
        assert [(spiel.spiel_id, spiel.datum, spiel.eingereicht_am is not None) for spiel in listed.fruehere] == [
            (VORJAHRESSPIEL, "2026-05-14", True),
            (undatiert, None, True),
        ]


async def save_the_result(database: AsyncDatabase, team1: int, team2: int) -> None:
    await database[Collection.SPIELE].update_one(
        {"_id": SPIEL}, {"$set": {"team1.tore": team1, "team2.tore": team2, "ergebnis": f"{team1}:{team2}"}}
    )


class TestTheAdministratorReadsTheStateAReportIsIn:
    def test_the_season_read_and_the_panel_derive_one_state(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            def states() -> Any:
                return get_spielberichte(
                    spielberichte_collection=database[Collection.SPIELBERICHTE],
                    saisons_collection=database[Collection.SAISONS],
                    saison_id=SAISON_ID,
                )

            empty = await get_spielbericht_admin(spiel_id=SPIEL, db=client, **handles(database))
            await put(database, client, bericht())
            proposed = await states()
            await save_the_result(database, 0, 1)
            admin = await get_spielbericht_admin(spiel_id=SPIEL, db=client, **handles(database))

            return empty, proposed, await states(), admin

        empty, proposed, differing, admin = on_the_league(mongo_replica_set_url, body)

        assert (empty.bericht, empty.zustand) == (None, None)
        assert [(eintrag.spiel_id, eintrag.zustand) for eintrag in proposed.spielberichte] == [(SPIEL, "vorgeschlagen")]
        # The sides swapped: 1:0 proposed, 0:1 saved.
        assert [(eintrag.spiel_id, eintrag.zustand) for eintrag in differing.spielberichte] == [(SPIEL, "abweichend")]
        assert admin.zustand == "abweichend"
        assert admin.bericht is not None and admin.bericht.karten[0].grund == "foulspiel"


VORJAHRESSPIEL = ObjectId("6890a1b2c3d4e5f607e50013")


async def seed_the_season_before(database: AsyncDatabase) -> None:
    """Adler's season row of the year before, its trainer Gerda Vogt, and a reported fixture of that season booked to the referee."""

    await database[Collection.SAISONS].insert_one(documents.saison_document(VORSAISON_ID, "past"))
    await database[Collection.SAISON_TEAMS].insert_one(
        documents.saison_team_document(
            VORSAISON_ID,
            TEAM1,
            *NAMES[TEAM1],
            kontakte=documents.kontakte_document(trainer=documents.kontaktperson_document("Gerda", nachname="Vogt", email="gerda@example.com")),
        )
    )
    vorjahr = fixture(spiel_id=VORJAHRESSPIEL, saison_id=VORSAISON_ID, datum="2026-05-14")
    await database[Collection.SPIELE].insert_one(vorjahr)
    await database[Collection.SPIELBERICHTE].insert_one(documents.spielbericht_document(vorjahr))


class TestEachReportReadKeepsToTheFixturesSeason:
    def test_another_season_s_report_and_seat_holders_reach_none_of_this_season_s_reads(self, mongo_replica_set_url: str):
        """The season's report states, its count of submitted reports, and the names the remarks are judged against."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_the_season_before(database)
            # Last season's trainer of Adler, nobody this fixture's people hold.
            geschrieben = await outcome_of(put(database, client, bericht(bemerkungen="Frau Vogt sah von der Tribüne zu.")))
            states = await get_spielberichte(
                spielberichte_collection=database[Collection.SPIELBERICHTE],
                saisons_collection=database[Collection.SAISONS],
                saison_id=SAISON_ID,
            )
            counted = await count_eingereichte_berichte(
                spielberichte_collection=database[Collection.SPIELBERICHTE], saison_id=SAISON_ID, session=None
            )

            return geschrieben, [eintrag.spiel_id for eintrag in states.spielberichte], counted

        geschrieben, listed, counted = on_the_league(mongo_replica_set_url, body)

        assert geschrieben == COMMITTED, "a name of another season's seat holder was refused in the remarks"
        assert (listed, counted) == ([SPIEL], 1), "the season before's report was read as this season's"


class TestTheTriageFindsEveryReportAwaitingTheAdministrator:
    def test_a_report_on_a_fixture_played_today_or_holding_another_result_is_unioned_in(self, mongo_replica_set_url: str):
        """Neither fixture is on the list by its own fields: dated, timed, booked, played today, then holding a result."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def triage() -> tuple[set[ObjectId], list[tuple[ObjectId, str]]]:
                listed = await get_spiele_action_required(
                    spiele_collection=database[Collection.SPIELE],
                    teams_collection=database[Collection.TEAMS],
                    saisons_collection=database[Collection.SAISONS],
                    spielorte_collection=database[Collection.SPIELORTE],
                    schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                    spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                    spielberichte_collection=database[Collection.SPIELBERICHTE],
                    saison_id=SAISON_ID,
                    today=TODAY,
                )
                return {spiel.id for spiel in listed.spiele}, [(eintrag.spiel_id, eintrag.zustand) for eintrag in listed.spielberichte]

            unreported = await triage()
            await put(database, client, bericht())
            proposed = await triage()
            await save_the_result(database, 0, 1)
            differing = await triage()
            await save_the_result(database, 1, 0)
            # Typed by the administrator, never adopted: still awaiting them.
            typed = await triage()
            await database[Collection.SPIELBERICHTE].update_one({"spiel_id": SPIEL}, {"$set": {"bericht.uebernommene_version": 1}})
            adopted = await triage()

            return unreported, proposed, differing, typed, adopted

        unreported, proposed, differing, typed, adopted = on_the_league(mongo_replica_set_url, body)

        assert SPIEL not in unreported[0]
        assert SPIEL in proposed[0]
        assert SPIEL in differing[0]
        assert SPIEL in typed[0]
        # Adopted as it stands: awaiting nothing.
        assert SPIEL not in adopted[0]
        # Each state served beside the list it was judged on, so the page reads no second snapshot.
        assert [unreported[1], proposed[1], adopted[1]] == [[], [(SPIEL, "vorgeschlagen")], [(SPIEL, "uebernommen")]]


def save_handles(database: AsyncDatabase, client: AsyncMongoClient) -> dict[str, Any]:
    """What a fixture save takes besides its body."""

    return {
        "db": client,
        "spiele_collection": database[Collection.SPIELE],
        "teams_collection": database[Collection.TEAMS],
        "saisons_collection": database[Collection.SAISONS],
        "saison_teams_collection": database[Collection.SAISON_TEAMS],
        "spieltage_collection": database[Collection.SPIELTAGE],
        "spielorte_collection": database[Collection.SPIELORTE],
        "schiedsrichter_collection": database[Collection.SCHIEDSRICHTER],
        "spielberichte_collection": database[Collection.SPIELBERICHTE],
    }


async def correct_the_feeder(database: AsyncDatabase, client: AsyncMongoClient, team1: int, team2: int) -> None:
    """The administrator's save of the round-of-16 result, whose winner the bracket resolves into the quarter-final's team 1."""

    stored_spiel = await database[Collection.SPIELE].find_one({"_id": SPIEL})
    assert stored_spiel is not None, "the seed holds no fixture"
    spiel_data = spiel_patch_body(stored_spiel, team1={**side(TEAM1), "tore": team1}, team2={**side(TEAM2), "tore": team2})
    await patch_spiel_data(
        spiel_id=SPIEL,
        spiel_data=FLPatchSpielDataPayload.model_validate(spiel_data),
        uebernimmt_bericht=None,
        now=NOW,
        **save_handles(database, client),
    )


async def a_reported_quarter_final(database: AsyncDatabase, client: AsyncMongoClient, scorer: ObjectId | None) -> None:
    """Adler won the round of 16 and the referee reported the quarter-final 1:0 for Adler; then the round of 16 went to Biber."""

    # A matchday of its own, dated today and booked to the referee: what a played tie holds.
    await database[Collection.SPIELE].update_one(
        {"_id": VIERTELFINALE},
        {
            "$set": {
                "spieltag_id": ObjectId(),
                "datum": DATUM,
                "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER, "name": "Otto Gruber", "payment": 20},
            }
        },
    )
    await correct_the_feeder(database, client, 1, 0)
    await put(database, client, bericht(torschuetzen=[tor("team1", scorer)], karten=[]), spiel_id=VIERTELFINALE)
    await correct_the_feeder(database, client, 0, 1)


async def quarter_final_block(database: AsyncDatabase) -> dict[str, Any]:
    document = await database[Collection.SPIELBERICHTE].find_one({"spiel_id": VIERTELFINALE})
    assert document is not None, "the referee's report on the quarter-final was never written"

    return document["bericht"]


class TestAReportOutlivingItsFixturesClub:
    """A correction upstream fields Biber where the report credits Adler's goal: adopted, the 1:0 would be Biber's."""

    def test_it_reads_teams_geaendert_until_the_referee_sends_it_again(self, mongo_replica_set_url: str):
        """Sent again unchanged, the write re-stamps the clubs: a save the clubs moved under is not one that writes nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def zustaende() -> Any:
                admin = await get_spielbericht_admin(spiel_id=VIERTELFINALE, db=client, **handles(database))
                season = await get_spielberichte(
                    spielberichte_collection=database[Collection.SPIELBERICHTE],
                    saisons_collection=database[Collection.SAISONS],
                    saison_id=SAISON_ID,
                )
                return admin.zustand, [eintrag.zustand for eintrag in season.spielberichte if eintrag.spiel_id == VIERTELFINALE]

            await a_reported_quarter_final(database, client, None)
            moved = await zustaende()
            await put(database, client, bericht(torschuetzen=[tor("team1", None)], karten=[], stand=1), spiel_id=VIERTELFINALE)

            return moved, await zustaende(), await quarter_final_block(database)

        moved, sent_again, block = on_the_league(mongo_replica_set_url, body)

        assert moved == ("teams_geaendert", ["teams_geaendert"]), "a report about the club that left read as one about Biber"
        assert (block["version"], block["seiten"]) == (2, {"team1": TEAM2, "team2": None})
        # The correction voided the quarter-final's result, so the report proposes again.
        assert sent_again == ("vorgeschlagen", ["vorgeschlagen"])

    def test_a_scorer_of_the_club_that_left_is_judged_against_the_squad_playing_now(self, mongo_replica_set_url: str):
        """Lina scored for Adler: sent again unchanged, she would stand on the report as Biber's scorer."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_reported_quarter_final(database, client, LINA)
            again = await outcome_of(
                put(database, client, bericht(torschuetzen=[tor("team1", LINA)], karten=[], stand=1), spiel_id=VIERTELFINALE)
            )

            return again, (await quarter_final_block(database))["version"]

        assert on_the_league(mongo_replica_set_url, body) == (Code.BERICHT_NICHT_IM_KADER, 1)
