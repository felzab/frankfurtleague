"""
API · a fixture's report written, read and judged against the shipped validators and indexes

The report writes its own document alone: never the fixture, whose result the administrator saves.
"""

from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.konto.services import FUNKTION_NICHT_GEHALTEN
from app.api.spielberichte.admin_router import get_spielbericht_admin, get_spielberichte, patch_spielbericht
from app.api.spielberichte.person_router import get_spielbericht_bericht, get_spielberichte_person, put_spielbericht_bericht
from app.api.spielberichte.schemas import FLSpielberichtPayload
from app.api.spielberichte.services import (
    BERICHT_ABGESAGT,
    BERICHT_NAME_IN_BEMERKUNGEN,
    BERICHT_NICHT_GELEITET,
    BERICHT_NICHT_GESPIELT,
    BERICHT_NICHT_IM_KADER,
)
from app.api.spiele.admin_router import get_spiele_action_required
from app.core.collections import Collection
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.isolation import COMMITTED, InterleavedCollection, outcome_of
from tests.records import record_collections
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spielbericht_test")

SAISON_ID = "2027"
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

NAMES = {TEAM1: ("Adler", "AD"), TEAM2: ("Biber", "BI")}
PEOPLE = {TEAM1: ("Ida", "Albers"), TEAM2: ("Lea", "Dietz")}


def side(team_id: ObjectId) -> dict[str, Any]:
    name, shorthand = NAMES[team_id]
    return {"team_id": team_id, "name": name, "shorthand": shorthand, "tore": None}


def fixture(**fields: Any) -> dict[str, Any]:
    """A round-of-16 tie played today whose winner the quarter-final draws from, booked to the referee."""

    return documents.spiel_document(
        spiel_id=SPIEL,
        saison_id=SAISON_ID,
        spiel_nr=1,
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


def bericht(team1: int = 1, team2: int = 0, torschuetzen: list[dict[str, Any]] | None = None, **fields: Any) -> dict[str, Any]:
    return {
        "bericht": {
            "ergebnis_vorschlag": {"team1_tore": team1, "team2_tore": team2, "elfmeterschiessen": None, "sonderereignis": None},
            "torschuetzen": [tor("team1", LINA)] if torschuetzen is None else torschuetzen,
            "karten": [{"seite": "team2", "spieler_id": MIA, "minute": "45+2", "farbe": "gelb", "grund": "foulspiel"}],
            "bemerkungen": None,
            **fields,
        }
    }


def handles(database: AsyncDatabase, **replaced: Any) -> dict[str, Any]:
    return {
        "spiele_collection": database[Collection.SPIELE],
        "saison_spieler_collection": database[Collection.SAISON_SPIELER],
        "saison_teams_collection": database[Collection.SAISON_TEAMS],
        "spieler_collection": database[Collection.SPIELER],
        "spielberichte_collection": database[Collection.SPIELBERICHTE],
        **replaced,
    }


async def put(database: AsyncDatabase, client: AsyncMongoClient, body: dict[str, Any], *, email: str = REFEREE_EMAIL, **replaced: Any) -> Any:
    return await put_spielbericht_bericht(
        spiel_id=SPIEL,
        bericht_data=FLSpielberichtPayload.model_validate(body),
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
            first = await put(database, client, bericht())
            await put(database, client, bericht(1, 1, [tor("team1", LINA), tor("team2", MIA)], bemerkungen="Starker Regen ab der Pause."))
            await patch(database, client, bericht(2, 1, [tor("team1", LINA), tor("team1", LINA, "80"), tor("team2", MIA)]))

            return first, await stored(database)

        first, documents_now = on_the_league(mongo_replica_set_url, body)

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


async def call_off(database: AsyncDatabase) -> None:
    await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": "ausgefallen"}})


async def move_to_tomorrow(database: AsyncDatabase) -> None:
    await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"datum": "2027-05-15"}})


async def nothing(_: AsyncDatabase) -> None:
    return None


class TestEachRefusalWritesNothing:
    @pytest.mark.parametrize(
        ("email", "before", "body", "code"),
        [
            pytest.param(NOBODY, nothing, bericht(), FUNKTION_NICHT_GEHALTEN, id="no referee record"),
            pytest.param(OTHER_REFEREE_EMAIL, nothing, bericht(), BERICHT_NICHT_GELEITET, id="another referee"),
            pytest.param(REFEREE_EMAIL, move_to_tomorrow, bericht(), BERICHT_NICHT_GESPIELT, id="a day still to come"),
            pytest.param(REFEREE_EMAIL, call_off, bericht(), BERICHT_ABGESAGT, id="called off"),
            pytest.param(REFEREE_EMAIL, nothing, bericht(torschuetzen=[tor("team1", OLE)]), BERICHT_NICHT_IM_KADER, id="an ausgetragen pupil"),
            pytest.param(
                REFEREE_EMAIL, nothing, bericht(torschuetzen=[tor("team1", MIA)]), BERICHT_NICHT_IM_KADER, id="the other side's pupil"
            ),
            pytest.param(
                REFEREE_EMAIL,
                nothing,
                bericht(bemerkungen="Brettschneider stand am Rand."),
                BERICHT_NAME_IN_BEMERKUNGEN,
                id="a name in the remarks",
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

    def test_the_administrator_s_write_is_refused_on_the_fixture_s_state_too(self, mongo_replica_set_url: str):
        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_off(database)
            return await outcome_of(patch(database, client, bericht())), await stored(database)

        assert on_the_league(mongo_replica_set_url, run) == (BERICHT_ABGESAGT, [])

    def test_a_correction_keeps_a_scorer_ausgetragen_since_the_match(self, mongo_replica_set_url: str):
        """Only a pupil the write newly names is judged against the live squad."""

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await put(database, client, bericht())
            await database[Collection.SAISON_SPIELER].update_one({"spieler_id": LINA}, {"$set": {"inactive_since": "2027-05-14"}})
            corrected = await outcome_of(put(database, client, bericht(torschuetzen=[tor("team1", LINA, "24")])))
            read = await get_spielbericht_bericht(
                spiel_id=SPIEL,
                identifier=REFEREE_EMAIL,
                records=record_collections(database),
                db=client,
                **handles(database),
            )
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


class TestWhatTheReportIsJudgedOnMovingMidWriteIsJudgedAgain:
    """Each a write the report's transaction reads and never writes, so none conflicts: the re-judgement outside it is all that sees them."""

    @pytest.mark.parametrize(
        ("rival", "code"),
        [
            pytest.param(take_the_referee_off, BERICHT_NICHT_GELEITET, id="the-referee-taken-off"),
            pytest.param(call_off, BERICHT_ABGESAGT, id="the-fixture-called-off"),
            pytest.param(take_lina_out_of_the_squad, BERICHT_NICHT_IM_KADER, id="the-scorer-ausgetragen"),
        ],
    )
    def test_the_write_is_refused_on_what_moved_and_writes_nothing(
        self, mongo_replica_set_url: str, rival: Callable[[AsyncDatabase], Awaitable[None]], code: str
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            berichte = BerichteRunningARivalBeforeTheirWrite(database[Collection.SPIELBERICHTE], lambda: rival(database))
            outcome = await outcome_of(put(database, client, bericht(), spielberichte_collection=berichte))
            berichte.assert_landed_inside(serially=0)

            return outcome, await stored(database), berichte.passes

        outcome, documents_now, passes = on_the_league(mongo_replica_set_url, body)

        assert (outcome, documents_now) == (code, [])
        # Once: none of these conflicts, so a retry would mean the rival was caught some other way.
        assert passes == 1


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

        assert (outcome, documents_now) == (BERICHT_NICHT_IM_KADER, [])
        # Never written: the anchor's conflict retried the transaction, whose judgement met the squad without her. An
        # anchor the erasure missed lets the write through, to be refused by the re-judgement outside the transaction.
        assert writes == 0


class TestTheReads:
    def test_the_booked_referee_alone_reads_the_form(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            def read(email: str) -> Any:
                return get_spielbericht_bericht(
                    spiel_id=SPIEL, identifier=email, records=record_collections(database), db=client, **handles(database)
                )

            return await read(REFEREE_EMAIL), await outcome_of(read(OTHER_REFEREE_EMAIL))

        form, other = on_the_league(mongo_replica_set_url, body)

        assert other == BERICHT_NICHT_GELEITET
        assert (form.bericht, form.spiel.team1.name, form.spiel.saison_phase) == (None, "Adler", "achtelfinale")
        # Live squads alone, each pupil with the number a picker shows.
        assert [(spieler.spieler_id, spieler.nummer) for spieler in form.kader.team1] == [(LINA, "7")]
        assert [spieler.spieler_id for spieler in form.kader.team2] == [MIA]

    def test_the_referee_s_list_holds_their_played_fixtures_and_whether_a_report_stands(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
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
            return before, await listed()

        before, after = on_the_league(mongo_replica_set_url, body)

        assert [(spiel.spiel_id, spiel.eingereicht_am) for spiel in before.spiele] == [(SPIEL, None)]
        assert after.spiele[0].eingereicht_am is not None


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


class TestTheTriageFindsEveryReportAwaitingTheAdministrator:
    def test_a_report_on_a_fixture_played_today_or_holding_another_result_is_unioned_in(self, mongo_replica_set_url: str):
        """Neither fixture is on the list by its own fields: dated, timed, booked, played today, then holding a result."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def triage() -> set[ObjectId]:
                listed = await get_spiele_action_required(
                    spiele_collection=database[Collection.SPIELE],
                    teams_collection=database[Collection.TEAMS],
                    saisons_collection=database[Collection.SAISONS],
                    spielorte_collection=database[Collection.SPIELORTE],
                    schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                    spielberichte_collection=database[Collection.SPIELBERICHTE],
                    saison_id=SAISON_ID,
                    today=TODAY,
                )
                return {spiel.id for spiel in listed.spiele}

            unreported = await triage()
            await put(database, client, bericht())
            proposed = await triage()
            await save_the_result(database, 0, 1)
            differing = await triage()
            await save_the_result(database, 1, 0)
            # Typed by the administrator, never adopted: still awaiting them.
            typed = await triage()

            return unreported, proposed, differing, typed

        unreported, proposed, differing, typed = on_the_league(mongo_replica_set_url, body)

        assert SPIEL not in unreported
        assert SPIEL in proposed
        assert SPIEL in differing
        assert SPIEL in typed
