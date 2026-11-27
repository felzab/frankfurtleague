"""
API · a fixture's report written, read and judged against the shipped indexes

The report writes its own document alone: never the fixture, whose result the administrator saves.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.admin_router import get_saison_overview
from app.api.saisons.overview import FLOverviewSpielberichtRow
from app.api.spielberichte.crud import count_submitted_berichte, empty_pupil_entries_in_session
from app.api.spielberichte.person_router import get_spielbericht_bericht, put_spielbericht_bericht
from app.api.spielberichte.schemas import FLSpielberichtBericht, FLSpielberichtPayload
from app.api.spielberichte.services import bericht_state_of, build_state_pipeline
from app.api.spiele.admin_router import patch_spiel
from app.api.spiele.schemas import (
    FLPatchSpielDataPayload,
)
from app.core.codes import Code
from app.core.collections import Collection
from app.core.crud import ANCHOR_FIELD, aggregate_many_from_db
from tests import documents
from tests.acts import acts_of
from tests.database import a_clean_database
from tests.isolation import COMMITTED, InterleavedCollection, outcome_of
from tests.payloads import spiel_patch_body
from tests.records import record_collections
from tests.stored import the_row
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spielbericht_test")

SAISON_ID = "2027"
VORSAISON_ID = "2026"
DATE = "2027-05-14"
NOW = datetime(2027, 5, 14, 21, tzinfo=ZoneInfo("Europe/Berlin"))
TODAY = "2027-05-14"

TEAM1 = ObjectId("6890a1b2c3d4e5f607e50001")
TEAM2 = ObjectId("6890a1b2c3d4e5f607e50002")
SPIEL = ObjectId("6890a1b2c3d4e5f607e50011")
VIERTELFINALE = ObjectId("6890a1b2c3d4e5f607e50012")
# The season read's own: a fixture called off, one a side did not turn up to, one settled on penalties.
CALLED_OFF = ObjectId("6890a1b2c3d4e5f607e50014")
NO_SHOW = ObjectId("6890a1b2c3d4e5f607e50015")
SHOOT_OUT = ObjectId("6890a1b2c3d4e5f607e50016")
# A club a correction fields in the away slot after the report.
REFIELDED = ObjectId("6890a1b2c3d4e5f607e50003")
SPIELTAG = ObjectId("6890a1b2c3d4e5f607e50021")
SPIELORT = ObjectId("6890a1b2c3d4e5f607e50031")
SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f607e50041")
OTHER_REFEREE = ObjectId("6890a1b2c3d4e5f607e50042")
LINA = ObjectId("6890a1b2c3d4e5f607e50051")
OLE = ObjectId("6890a1b2c3d4e5f607e50052")
MIA = ObjectId("6890a1b2c3d4e5f607e50053")

REFEREE_EMAIL = "otto.gruber@example.com"
OTHER_REFEREE_EMAIL = "ella.engel@example.com"
NOBODY = "niemand@example.com"

NAMES = {TEAM1: ("Adler", "ADX"), TEAM2: ("Biber", "BIX")}
PEOPLE = {TEAM1: ("Ida", "Albers"), TEAM2: ("Lea", "Dietz")}


def side(team_id: ObjectId) -> dict[str, Any]:
    return {"team_id": team_id, "tore": None}


def spiel(*, spiel_id: ObjectId = SPIEL, saison_id: str = SAISON_ID, **fields: Any) -> dict[str, Any]:
    """A round-of-16 tie played today whose winner the quarter-final draws from, booked to the referee."""

    return documents.spiel_document(
        spiel_id=spiel_id,
        saison_id=saison_id,
        spiel_nr=1,
        spieltag_id=SPIELTAG,
        **{
            "saison_phase": "achtelfinale",
            "team1": side(TEAM1),
            "team2": side(TEAM2),
            "date": DATE,
            "time": "18:00:00",
            "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER, "payment": 20},
            "spielort": {"spielort_id": SPIELORT, "mietpreis": 40},
            **fields,
        },
    )


def referee(referee_id: ObjectId, name: str, email: str) -> dict[str, Any]:
    return documents.schiedsrichter_document(
        referee_id,
        email=email,
        name=name,
        default_payment=20,
        einwilligung=documents.own_einwilligung_document(text_versions=documents.SCHIEDSRICHTER_TEXT_VERSIONS, confirmed_at="2027-01-10"),
    )


async def seed(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
    for team_id, (name, shorthand) in NAMES.items():
        first_name, last_name = PEOPLE[team_id]
        await database[Collection.TEAMS].insert_one(documents.team_document(team_id, name, shorthand))
        await database[Collection.SAISON_TEAMS].insert_one(
            documents.saison_team_document(
                SAISON_ID,
                team_id,
                name,
                shorthand,
                kontakte=documents.kontakte_document(
                    trainer=documents.kontaktperson_document(first_name, last_name=last_name, email=f"{first_name.lower()}@example.com")
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
    await database[Collection.SPIELORTE].insert_one(documents.spielort_document(SPIELORT, "Halle Ost", default_mietpreis=40))
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [referee(SCHIEDSRICHTER, "Otto Gruber", REFEREE_EMAIL), referee(OTHER_REFEREE, "Ella Engel", OTHER_REFEREE_EMAIL)]
    )
    await database[Collection.SPIELE].insert_many(
        [
            spiel(),
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


async def on_the_league(url: str, body: Body) -> Any:
    async with a_clean_database(url, DATABASE_NAME) as (client, database):
        await seed(database)
        return await body(database, client)


def tor(side: str, spieler_id: ObjectId | None, minute: str = "23") -> dict[str, Any]:
    return {"side": side, "spieler_id": spieler_id, "minute": minute, "eigentor": False}


def bericht(scorers: list[dict[str, Any]] | None = None, *, version: int | None = None, **fields: Any) -> dict[str, Any]:
    """A write composed on the document at `version`, none by default: the form opened on no report.

    Lina's 1:0 unless `scorers` says otherwise.
    """

    return {
        "bericht": {
            "ergebnis_vorschlag": {"elfmeterschiessen": None, "sonderereignis": None},
            "scorers": [tor("team1", LINA)] if scorers is None else scorers,
            "cards": [{"side": "team2", "spieler_id": MIA, "minute": "45+2", "colour": "gelb"}],
            "remarks": None,
            **fields,
        },
        "version": version,
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
    spiel_id: ObjectId = SPIEL,
    **replaced: Any,
) -> Any:
    return await put_spielbericht_bericht(
        spiel_id=spiel_id,
        bericht_data=FLSpielberichtPayload.model_validate(body),
        identifier=email,
        records=record_collections(database),
        db=client,
        germany_now=NOW,
        **handles(database, **{"schiedsrichter_collection": database[Collection.SCHIEDSRICHTER], **replaced}),
    )


async def form_read(database: AsyncDatabase, client: AsyncMongoClient, *, email: str = REFEREE_EMAIL) -> Any:
    async with client.start_session(snapshot=True) as session:
        return await get_spielbericht_bericht(
            spiel_id=SPIEL, identifier=email, records=record_collections(database), session=session, germany_now=NOW, **handles(database)
        )


async def stored(database: AsyncDatabase) -> list[dict[str, Any]]:
    return await database[Collection.SPIELBERICHTE].find({}).to_list()


class TestTheReportNeverWritesTheSpiel:
    async def test_the_spiel_and_the_tie_it_feeds_stay_as_stored(self, mongo_replica_set_url: str):
        """A knockout feeder: a report written into the result would resolve the quarter-final's side.

        The anchor's counter aside, which the report advances on its fixture and no reader sees.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await database[Collection.SPIELE].find({}, {ANCHOR_FIELD: 0}).sort("_id").to_list()
            await put(database, client, bericht([tor("team1", LINA), tor("team1", None), tor("team2", MIA)]))
            after = await database[Collection.SPIELE].find({}, {ANCHOR_FIELD: 0}).sort("_id").to_list()

            return before == after

        assert await on_the_league(mongo_replica_set_url, body)


class TestTheFirstWriteCreatesAndEveryWriteRaisesTheVersion:
    async def test_a_correction_replaces_the_block_and_keeps_when_it_was_first_sent(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await put(database, client, bericht())
            read = await form_read(database, client)
            corrected = await put(
                database,
                client,
                bericht([tor("team1", LINA), tor("team2", MIA)], version=0, remarks="Starker Regen ab der Pause."),
            )

            return first, read, corrected, await stored(database), await acts_of(database)

        first, read, corrected, documents_now, acts = await on_the_league(mongo_replica_set_url, body)

        # Each write answers the version it left, which the form's next save sends.
        assert (first.version, read.version, corrected.version) == (0, 0, 1)
        assert [spieler.spieler_id for spieler in read.kader.team1] == [LINA]
        [document] = documents_now
        # The first save and the correction, each its own row and neither naming a person.
        assert acts == [("spielbericht.saved", "schiedsrichter", None, document["_id"])] * 2
        block = document["bericht"]
        # The two counts are the entries': one goal a side.
        assert (document["version"], block["ergebnis_vorschlag"]["team2_tore"], block["remarks"]) == (1, 1, "Starker Regen ab der Pause.")
        assert block["adopted"] is False


class TestASaveSayingWhatTheReportSays:
    async def test_it_writes_nothing_and_logs_nothing(self, mongo_replica_set_url: str):
        """A second press of the form: a raised version refuses the page's next correction, and the Protokoll would hold a save of nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await put(database, client, bericht())
            before = await stored(database)
            answered = await put(database, client, bericht(version=0))

            return answered.version, before == await stored(database), len(await acts_of(database))

        assert await on_the_league(mongo_replica_set_url, body) == (0, True, 1)


class TestAFormOpenedBeforeAnotherWrite:
    """Each write replaces the whole block, so one composed on an older version would put back what a later write changed."""

    async def test_a_form_opened_before_the_referee_s_own_correction_is_refused(self, mongo_replica_set_url: str):
        """Two windows of one referee: the second saves a correction, and the first, opened on the first write, saves after it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await put(database, client, bericht())
            await put(database, client, bericht([tor("team1", LINA), tor("team1", None)], version=0))
            stale = await outcome_of(put(database, client, bericht(version=0, remarks="Starker Regen.")))
            fresh = await outcome_of(put(database, client, bericht([tor("team1", LINA), tor("team1", None)], version=1, remarks="Regen.")))

            return stale, fresh, (await stored(database))[0]

        stale, fresh, document = await on_the_league(mongo_replica_set_url, body)

        assert stale == Code.VERSION_STALE
        # A form reloaded on the correction writes as any other.
        assert fresh == COMMITTED
        assert (document["version"], document["bericht"]["ergebnis_vorschlag"]["team1_tore"], document["bericht"]["remarks"]) == (
            2,
            2,
            "Regen.",
        )

    async def test_a_form_that_showed_a_report_is_refused_once_the_report_is_gone(self, mongo_replica_set_url: str):
        """A number matches only the document it was read off: a draw's removal took it, and a save recreating it would be no correction."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await outcome_of(put(database, client, bericht(version=0))), await stored(database)

        assert await on_the_league(mongo_replica_set_url, body) == (Code.VERSION_STALE, [])


async def call_off(database: AsyncDatabase) -> None:
    await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": "ausgefallen"}})


async def move_to_tomorrow(database: AsyncDatabase) -> None:
    await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"date": "2027-05-15"}})


async def end_the_season(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"status": "past"}})


class TestEachRefusalWritesNothing:
    async def test_a_write_from_an_address_holding_no_referee_record_is_refused(self, mongo_replica_set_url: str):
        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await outcome_of(put(database, client, bericht(), email=NOBODY)), await stored(database)

        outcome, documents_now = await on_the_league(mongo_replica_set_url, run)

        assert outcome == Code.ROLE_NOT_HELD
        assert documents_now == []


class BerichteRunningARivalBeforeTheirWrite(InterleavedCollection):
    async def insert_one(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.insert_one(*args, **kwargs)


# A change no report is judged on, so the fixture's save takes it whichever order the two commit in.
MOVED_NOTE = "Halle Ost"


class TestAReportAndAFixtureSaveCrossing:
    """The report anchors the fixture it judged, so a fixture's save landing either side of it conflicts with it."""

    async def test_a_call_off_inside_the_write_refuses_it(self, mongo_replica_set_url: str):
        """Unanchored, the report would stand for a match that never took place."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            berichte = BerichteRunningARivalBeforeTheirWrite(database[Collection.SPIELBERICHTE], lambda: call_off(database))

            return await outcome_of(put(database, client, bericht(), spielberichte_collection=berichte)), await stored(database)

        assert await on_the_league(mongo_replica_set_url, body) == (Code.BERICHT_CANCELLED, [])

    async def test_a_report_written_inside_a_fixture_save_leaves_it_committing_on_the_version_its_form_read(self, mongo_replica_set_url: str):
        """The fixture's save meets the report's anchor and runs again, and the anchor moved no `version` for it to be refused on."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            loaded = await the_row(database, Collection.SPIELE, {"_id": SPIEL}, "the seed holds no fixture")

            async def the_referee_reports() -> None:
                await put(database, client, bericht())

            # After the fixture save's reads and ahead of its write of the fixture.
            spiele = InterleavedCollection(database[Collection.SPIELE], the_referee_reports, before="find_one_and_update")
            async with client.start_session(snapshot=True) as session:
                outcome = await outcome_of(
                    patch_spiel(
                        spiel_id=SPIEL,
                        spiel_data=FLPatchSpielDataPayload.model_validate(spiel_patch_body(loaded, note=MOVED_NOTE)),
                        **{**save_handles(database, client), "spiele_collection": spiele},
                        session=session,
                    )
                )
            saved = await the_row(database, Collection.SPIELE, {"_id": SPIEL}, "the seed holds no fixture")

            return (
                outcome,
                (saved["note"], saved["version"] - loaded.get("version", 0)),
                [document["version"] for document in await stored(database)],
            )

        # The fixture's save raised its version once; the report stands as the referee wrote it.
        assert await on_the_league(mongo_replica_set_url, body) == (COMMITTED, (MOVED_NOTE, 1), [0])


class TestASeasonEndingUnderAFirstWrite:
    async def test_it_conflicts_with_the_season_s_anchor_and_the_retry_refuses_it(self, mongo_replica_set_url: str):
        """The season's anchor conflicts with the end, so a retry refuses the write in its transaction.

        Unanchored, the write would commit into the ended season. A draw's removal and the activation take the same anchor.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            berichte = BerichteRunningARivalBeforeTheirWrite(database[Collection.SPIELBERICHTE], lambda: end_the_season(database))

            return await outcome_of(put(database, client, bericht(), spielberichte_collection=berichte)), await stored(database)

        assert await on_the_league(mongo_replica_set_url, body) == (Code.SAISON_PAST, [])


class PupilsRunningARivalBeforeTheAnchor(InterleavedCollection):
    async def update_many(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.update_many(*args, **kwargs)


class TestAPupilErasedMidWriteConflictsWithTheAnchor:
    async def test_the_write_retries_and_is_refused_on_the_kader_the_erasure_left(self, mongo_replica_set_url: str):
        """The erasure removes the squad row and the person after this write judged them: the anchor on either conflicts."""

        async def erase_lina(database: AsyncDatabase) -> None:
            await database[Collection.SAISON_SPIELER].delete_one({"spieler_id": LINA})
            await database[Collection.SPIELER].delete_one({"_id": LINA})

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler = PupilsRunningARivalBeforeTheAnchor(database[Collection.SPIELER], lambda: erase_lina(database))

            return await outcome_of(put(database, client, bericht(), spieler_collection=spieler)), await stored(database)

        # The anchor's conflict retried the transaction, whose judgement met the squad without her.
        assert await on_the_league(mongo_replica_set_url, body) == (Code.SPIELER_NOT_IN_KADER, [])


class TestTheReads:
    async def test_the_booked_referee_alone_reads_the_form(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            def read(email: str) -> Any:
                return form_read(database, client, email=email)

            return await read(REFEREE_EMAIL), await outcome_of(read(OTHER_REFEREE_EMAIL))

        form, other = await on_the_league(mongo_replica_set_url, body)

        assert other == Code.BERICHT_NOT_OFFICIATED
        assert (form.bericht, form.spiel.team1.name, form.spiel.saison_phase) == (None, "Adler", "achtelfinale")
        # The ground the form's lead names, by its row's current name.
        assert form.spiel.spielort is not None
        assert (form.spiel.spielort.name, form.spiel.spielort.maps_query) == ("Halle Ost", "Halle Ost, Frankfurt")
        # Live squads alone, each pupil with the number a picker shows.
        assert [(spieler.spieler_id, spieler.nummer) for spieler in form.kader.team1] == [(LINA, "7")]
        assert [spieler.spieler_id for spieler in form.kader.team2] == [MIA]

    async def test_the_form_reads_the_spiel_as_it_stands_and_marks_the_side_whose_team_moved(self, mongo_replica_set_url: str):
        """Abandoned since the report, its away side re-fielded: the form's lead and its marks read the fixture as stored now.

        Corrected once, so the version the next save is judged on is the stored one and no create's 0.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await put(database, client, bericht())
            await put(database, client, bericht([tor("team1", None)], version=0))
            await database[Collection.SAISON_TEAMS].insert_one(documents.saison_team_document(SAISON_ID, REFIELDED, "Dachs", "DAX"))
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"team2": side(REFIELDED), "sonderereignis": "abgebrochen"}})
            return await form_read(database, client)

        form = await on_the_league(mongo_replica_set_url, body)

        assert (form.spiel.date, form.spiel.time, form.spiel.sonderereignis) == (DATE, "18:00:00", "abgebrochen")
        assert form.spiel.team2 is not None and (form.spiel.team2.team_id, form.spiel.team2.name) == (REFIELDED, "Dachs")
        assert form.sides_changed == ["team2"]
        assert form.version == 1

    async def test_a_spiel_taking_no_report_serves_no_kader(self, mongo_replica_set_url: str):
        """Only the pupils the stored report names, by name: the squads are served for picking, and nothing is picked here.

        One fixture taking none, the read's wiring; which fixtures take one is `takes_a_bericht`'s, held in the shapes.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await put(database, client, bericht())
            played = await form_read(database, client)
            await move_to_tomorrow(database)
            return played, await form_read(database, client)

        played, form = await on_the_league(mongo_replica_set_url, body)

        assert (played.reportable, form.reportable) == (True, False)
        assert (form.kader.team1, form.kader.team2) == ([], [])
        assert form.bericht is not None
        assert sorted((spieler.spieler_id, spieler.last_name) for spieler in form.named) == [(LINA, "Krause"), (MIA, "Westphal")]

    async def test_a_pupil_off_both_kaders_is_named_off_their_record_and_an_erased_one_by_nobody(self, mongo_replica_set_url: str):
        """The two arms past the squad rows on the referee's form: no bare id shown, an erased pupil's entry still holding it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await put(database, client, bericht())
            await database[Collection.SAISON_SPIELER].update_one({"spieler_id": LINA}, {"$set": {"team_id": ObjectId()}})
            await database[Collection.SAISON_SPIELER].delete_one({"spieler_id": MIA})
            await database[Collection.SPIELER].delete_one({"_id": MIA})
            return await form_read(database, client)

        answer = await on_the_league(mongo_replica_set_url, body)

        assert sorted((spieler.spieler_id, spieler.first_name, spieler.last_name) for spieler in answer.named) == [
            (LINA, "Lina", "Krause"),
            (MIA, None, None),
        ]

    async def test_after_the_season_the_referee_reads_the_report_alone(self, mongo_replica_set_url: str):
        """Played and standing, so only the season's end decides: the persons the report names, no squad to pick from."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await put(database, client, bericht())
            before = await form_read(database, client)
            await end_the_season(database)
            return before, await form_read(database, client)

        before, after = await on_the_league(mongo_replica_set_url, body)

        assert (before.completed, after.completed) == (False, True)
        assert (after.kader.team1, after.kader.team2) == ([], [])
        assert after.bericht == before.bericht
        assert sorted((spieler.spieler_id, spieler.last_name) for spieler in after.named) == [(LINA, "Krause"), (MIA, "Westphal")]


async def save_the_result(database: AsyncDatabase, team1: int, team2: int) -> None:
    """The result as the save stores it, the bracket's resolution with it: the winner fielded on the quarter-final it feeds."""

    await database[Collection.SPIELE].update_one(
        {"_id": SPIEL}, {"$set": {"team1.tore": team1, "team2.tore": team2, "ergebnis": f"{team1}:{team2}"}}
    )
    await database[Collection.SPIELE].update_one(
        {"_id": VIERTELFINALE}, {"$set": {"team1": {"team_id": TEAM1 if team1 > team2 else TEAM2, "tore": None}}}
    )


async def spiel_version(database: AsyncDatabase) -> int:
    return (await the_row(database, Collection.SPIELE, {"_id": SPIEL}, "the seed holds no fixture"))["version"]


async def report_states(database: AsyncDatabase) -> list[tuple[ObjectId, str]]:
    """Every report of the season with its state, read through the pipeline and the judgement the Übersicht reads it by."""

    rows = await aggregate_many_from_db(collection=database[Collection.SPIELBERICHTE], pipeline=build_state_pipeline(saison_id=SAISON_ID))

    return [(row["spiel_id"], bericht_state_of(FLSpielberichtBericht.model_validate(row["bericht"]), row["spiel"])) for row in rows]


class TestTheAdministratorReadsTheStateAReportIsIn:
    async def test_the_season_read_judges_a_call_off_a_no_show_and_a_shoot_out_by_the_fixtures_own_fields(self, mongo_replica_set_url: str):
        """Each a report on a fixture holding an event or a shoot-out, which the state is judged against.

        Read without it, the call-off reads as proposed and the adopted no-show and shoot-out as differing: wrong on the
        administrator's overview with nothing failing.
        """

        def held(spiel_id: ObjectId, spiel_nr: int, vorschlag: dict[str, Any], scorers: list[dict[str, Any]], **fields: Any) -> Any:
            fixture = documents.spiel_document(
                spiel_id=spiel_id,
                saison_id=SAISON_ID,
                spiel_nr=spiel_nr,
                spieltag_id=SPIELTAG,
                **{"team1": side(TEAM1), "team2": side(TEAM2), "date": DATE, "time": "18:00:00", **fields},
            )
            report = documents.bericht_document(
                ergebnis_vorschlag=vorschlag, scorers=scorers, cards=[], sides=documents.spielbericht_sides(fixture), adopted=True
            )
            return fixture, documents.spielbericht_document(fixture, bericht=report)

        no_goals = {"team1_tore": None, "team2_tore": None, "elfmeterschiessen": None}
        shoot_out = {"team1": 4, "team2": 3}
        held_rows = [
            held(
                CALLED_OFF,
                3,
                {**no_goals, "team1_tore": 1, "team2_tore": 0, "sonderereignis": None},
                [tor("team1", LINA)],
                sonderereignis="annulliert",
            ),
            held(
                NO_SHOW,
                4,
                {**no_goals, "sonderereignis": "nichtantreten_team2"},
                [],
                sonderereignis="nichtantreten_team2",
                team1={"team_id": TEAM1, "tore": 3},
                team2={"team_id": TEAM2, "tore": 0},
                ergebnis="3:0",
            ),
            held(
                SHOOT_OUT,
                5,
                {"team1_tore": 1, "team2_tore": 1, "elfmeterschiessen": shoot_out, "sonderereignis": None},
                [tor("team1", LINA), tor("team2", MIA, minute="70")],
                team1={"team_id": TEAM1, "tore": 1},
                team2={"team_id": TEAM2, "tore": 1},
                ergebnis="1:1",
                elfmeterschiessen=shoot_out,
            ),
        ]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELE].insert_many([fixture for fixture, _ in held_rows])
            await database[Collection.SPIELBERICHTE].insert_many([report for _, report in held_rows])
            return await report_states(database)

        states = await on_the_league(mongo_replica_set_url, body)

        assert dict(states) == {
            CALLED_OFF: "cancelled",
            NO_SHOW: "adopted",
            SHOOT_OUT: "adopted",
        }

    async def test_a_report_agreeing_with_a_result_typed_by_hand_awaits_adoption_and_a_save_changing_nothing_adopts_it(
        self, mongo_replica_set_url: str
    ):
        """Lina's 1:0 reported, and 1:0 typed by the administrator without „Übernehmen“.

        Read as differing, the report could never be adopted: the editor's fields already hold its proposal, so the save
        adopting it changes no field of the fixture. It raises no version, which would refuse every other open editor of
        the match, and records no change of it.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await put(database, client, bericht())
            [document] = await stored(database)
            await save_the_result(database, 1, 0)
            typed = await season_states(database)
            # A matchday of its own for the tie the result resolves into, which one matchday cannot field Adler on twice.
            await database[Collection.SPIELE].update_one({"_id": VIERTELFINALE}, {"$set": {"spieltag_id": ObjectId()}})
            before, logged = await spiel_version(database), len(await acts_of(database))
            await correct_the_feeder(database, client, 1, 0, adopts_bericht=document["version"])

            return typed, await season_states(database), await spiel_version(database) - before, (await acts_of(database))[logged:]

        assert await on_the_league(mongo_replica_set_url, body) == (["proposed"], ["adopted"], 0, [])

    @pytest.mark.parametrize(
        ("spiel_moved", "bericht_moved"),
        [pytest.param(True, False, id="the fixture"), pytest.param(False, True, id="the report")],
    )
    async def test_a_save_changing_nothing_is_refused_once_what_its_editor_read_has_moved(
        self, mongo_replica_set_url: str, spiel_moved: bool, bericht_moved: bool
    ):
        """Its fields unchanged, the save writes the stamp alone: answered as saved, it would have done nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await put(database, client, bericht())
            [document] = await stored(database)
            await save_the_result(database, 1, 0)
            await database[Collection.SPIELE].update_one({"_id": VIERTELFINALE}, {"$set": {"spieltag_id": ObjectId()}})
            read = await database[Collection.SPIELE].find_one({"_id": SPIEL})
            assert read is not None, "the seed holds no fixture"
            # A write of each since the editor's read, standing in for a rival's.
            if spiel_moved:
                await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$inc": {"version": 1}})
            if bericht_moved:
                await database[Collection.SPIELBERICHTE].update_one({"spiel_id": SPIEL}, {"$inc": {"version": 1}})
            spiel_data = spiel_patch_body(read, team1={**side(TEAM1), "tore": 1}, team2={**side(TEAM2), "tore": 0})
            async with client.start_session(snapshot=True) as session:
                refused = await outcome_of(
                    patch_spiel(
                        spiel_id=SPIEL,
                        spiel_data=FLPatchSpielDataPayload.model_validate(spiel_data),
                        adopts_bericht=document["version"],
                        **save_handles(database, client),
                        session=session,
                    )
                )

            return refused, await season_states(database)

        assert await on_the_league(mongo_replica_set_url, body) == (Code.VERSION_STALE, ["proposed"])


VORJAHRESSPIEL = ObjectId("6890a1b2c3d4e5f607e50013")


async def seed_the_season_before(database: AsyncDatabase) -> None:
    """Adler's season row of the year before, its trainer Gerda Vogt, and a reported fixture of that season booked to the referee."""

    await database[Collection.SAISONS].insert_one(documents.saison_document(VORSAISON_ID, "past"))
    await database[Collection.SAISON_TEAMS].insert_one(
        documents.saison_team_document(
            VORSAISON_ID,
            TEAM1,
            *NAMES[TEAM1],
            kontakte=documents.kontakte_document(
                trainer=documents.kontaktperson_document("Gerda", last_name="Vogt", email="gerda@example.com")
            ),
        )
    )
    last_years = spiel(spiel_id=VORJAHRESSPIEL, saison_id=VORSAISON_ID, date="2026-05-14")
    await database[Collection.SPIELE].insert_one(last_years)
    await database[Collection.SPIELBERICHTE].insert_one(documents.spielbericht_document(last_years))


class TestEachReportReadKeepsToTheSpieleSeason:
    async def test_another_season_s_report_and_seat_holders_reach_none_of_this_season_s_reads(self, mongo_replica_set_url: str):
        """The season's report states, its count of submitted reports, and the names the remarks are judged against."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_the_season_before(database)
            # Last season's trainer of Adler, nobody this fixture's people hold.
            written = await outcome_of(put(database, client, bericht(remarks="Frau Vogt sah von der Tribüne zu.")))
            states = await report_states(database)
            counted = await count_submitted_berichte(
                spielberichte_collection=database[Collection.SPIELBERICHTE], saison_id=SAISON_ID, session=None
            )

            return written, [spiel_id for spiel_id, _ in states], counted

        written, listed, counted = await on_the_league(mongo_replica_set_url, body)

        assert written == COMMITTED, "a name of another season's seat holder was refused in the remarks"
        assert (listed, counted) == ([SPIEL], 1), "the season before's report was read as this season's"


class TestTheOverviewFindsEveryReportAwaitingTheAdministrator:
    async def test_a_report_on_a_spiel_played_today_or_holding_another_result_is_on_its_card(self, mongo_replica_set_url: str):
        """Neither fixture is on the list by its own fields: dated, timed, booked, played today, then holding a result."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def triage() -> tuple[set[ObjectId], list[tuple[ObjectId, str]]]:
                overview = await get_saison_overview(
                    saison_id=SAISON_ID,
                    saisons_collection=database[Collection.SAISONS],
                    spiele_collection=database[Collection.SPIELE],
                    teams_collection=database[Collection.TEAMS],
                    spielorte_collection=database[Collection.SPIELORTE],
                    schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                    germany_now=NOW,
                )
                reports = [row for card in overview.cards for row in card.rows if isinstance(row, FLOverviewSpielberichtRow)]
                return {row.spiel.id for row in reports}, [(row.spiel.id, row.state) for row in reports]

            unreported = await triage()
            await put(database, client, bericht())
            proposed = await triage()
            await save_the_result(database, 0, 1)
            differing = await triage()
            await save_the_result(database, 1, 0)
            # Typed by the administrator, never adopted: still awaiting them.
            typed = await triage()
            await database[Collection.SPIELBERICHTE].update_one({"spiel_id": SPIEL}, {"$set": {"bericht.adopted": True}})
            adopted = await triage()

            return unreported, proposed, differing, typed, adopted

        unreported, proposed, differing, typed, adopted = await on_the_league(mongo_replica_set_url, body)

        assert SPIEL not in unreported[0]
        assert SPIEL in proposed[0]
        assert SPIEL in differing[0]
        assert SPIEL in typed[0]
        # Adopted as it stands: awaiting nothing.
        assert SPIEL not in adopted[0]
        # Each row carries the state it was judged in, so the page reads no second snapshot.
        assert [unreported[1], proposed[1], differing[1], adopted[1]] == [[], [(SPIEL, "proposed")], [(SPIEL, "differing")], []]


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
        "aufstellungen_collection": database[Collection.AUFSTELLUNGEN],
        "spielbestaetigungen_collection": database[Collection.SPIELBESTAETIGUNGEN],
        # The save judges the fixture played or still to come by it.
        "germany_now": NOW,
    }


async def correct_the_feeder(
    database: AsyncDatabase, client: AsyncMongoClient, team1: int, team2: int, *, adopts_bericht: int | None = None
) -> None:
    """The administrator's save of the round-of-16 result, whose winner the bracket resolves into the quarter-final's team 1."""

    stored_spiel = await database[Collection.SPIELE].find_one({"_id": SPIEL})
    assert stored_spiel is not None, "the seed holds no fixture"
    spiel_data = spiel_patch_body(stored_spiel, team1={**side(TEAM1), "tore": team1}, team2={**side(TEAM2), "tore": team2})
    async with client.start_session(snapshot=True) as session:
        await patch_spiel(
            spiel_id=SPIEL,
            spiel_data=FLPatchSpielDataPayload.model_validate(spiel_data),
            adopts_bericht=adopts_bericht,
            **save_handles(database, client),
            session=session,
        )


async def a_reported_quarter_final(database: AsyncDatabase, client: AsyncMongoClient, scorer: ObjectId | None) -> None:
    """Adler won the round of 16 and the referee reported the quarter-final 1:0 for Adler; then the round of 16 went to Biber."""

    # A matchday of its own, dated today and booked to the referee: what a played tie holds.
    await database[Collection.SPIELE].update_one(
        {"_id": VIERTELFINALE},
        {
            "$set": {
                "spieltag_id": ObjectId(),
                "date": DATE,
                "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER, "payment": 20},
            }
        },
    )
    await correct_the_feeder(database, client, 1, 0)
    await put(database, client, bericht([tor("team1", scorer)], cards=[]), spiel_id=VIERTELFINALE)
    await correct_the_feeder(database, client, 0, 1)


async def quarter_final_report(database: AsyncDatabase) -> Mapping[str, Any]:
    return await the_row(
        database, Collection.SPIELBERICHTE, {"spiel_id": VIERTELFINALE}, "the referee's report on the quarter-final was never written"
    )


class TestAReportOutlivingItsSpieleTeam:
    """A correction upstream fields Biber where the report credits Adler's goal: adopted, the 1:0 would be Biber's."""

    async def test_it_reads_sides_changed_until_the_referee_sends_it_again(self, mongo_replica_set_url: str):
        """Sent again unchanged, the write re-stamps the clubs: a save the clubs moved under is not one that writes nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def states() -> Any:
                return [state for spiel_id, state in await report_states(database) if spiel_id == VIERTELFINALE]

            await a_reported_quarter_final(database, client, None)
            moved = await states()
            await put(database, client, bericht([tor("team1", None)], cards=[], version=0), spiel_id=VIERTELFINALE)

            return moved, await states(), await quarter_final_report(database)

        moved, sent_again, document = await on_the_league(mongo_replica_set_url, body)

        assert moved == ["sides_changed"], "a report about the club that left read as one about Biber"
        assert (document["version"], document["bericht"]["sides"]) == (1, {"team1": TEAM2, "team2": None})
        # The correction voided the quarter-final's result, so the report proposes again.
        assert sent_again == ["proposed"]

    async def test_a_scorer_of_the_team_that_left_is_judged_against_the_kader_playing_now(self, mongo_replica_set_url: str):
        """Lina scored for Adler: sent again unchanged, she would stand on the report as Biber's scorer."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_reported_quarter_final(database, client, LINA)
            again = await outcome_of(put(database, client, bericht([tor("team1", LINA)], cards=[], version=0), spiel_id=VIERTELFINALE))

            return again, (await quarter_final_report(database))["version"]

        assert await on_the_league(mongo_replica_set_url, body) == (Code.SPIELER_NOT_IN_KADER, 0)


async def season_states(database: AsyncDatabase) -> list[str]:
    return [state for _, state in await report_states(database)]


async def a_report_adopted(database: AsyncDatabase, client: AsyncMongoClient) -> int:
    """Lina's 1:0 reported and adopted by the administrator's save of that result, answering the version the editor read."""

    await put(database, client, bericht())
    [document] = await stored(database)
    # A matchday of its own for the tie the result resolves into, which one matchday cannot field Adler on twice.
    await database[Collection.SPIELE].update_one({"_id": VIERTELFINALE}, {"$set": {"spieltag_id": ObjectId()}})
    await correct_the_feeder(database, client, 1, 0, adopts_bericht=document["version"])

    return document["version"]


class TestTheAdoptionIsOneStoredAnswer:
    """`bericht.adopted`, which the document's `version` cannot stand in for: the stamp itself raises that count, and so does every job."""

    async def test_an_adopting_save_reads_adopted_though_its_stamp_raised_the_version(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            read = await a_report_adopted(database, client)
            [document] = await stored(database)

            return document["version"] - read, await season_states(database)

        assert await on_the_league(mongo_replica_set_url, body) == (1, ["adopted"])

    async def test_the_referee_s_later_save_reads_not_adopted_and_one_read_before_the_adoption_is_stale(self, mongo_replica_set_url: str):
        """The correction would withdraw an approval its form never saw given, so it is refused once and saves on a reload."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            read = await a_report_adopted(database, client)
            correction = [tor("team1", LINA, "24")]
            before = await outcome_of(put(database, client, bericht(correction, version=read)))
            after = await outcome_of(put(database, client, bericht(correction, version=read + 1)))

            return before, after, await season_states(database)

        # Its goal moved a minute, so the result still matches: the corrected report awaits adoption anew.
        assert await on_the_league(mongo_replica_set_url, body) == (Code.VERSION_STALE, COMMITTED, ["proposed"])

    async def test_an_erased_pupil_s_emptied_entries_keep_it_adopted(self, mongo_replica_set_url: str):
        """The erasure writes the document, and a report un-adopted by it would take its goals off the public page for good."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            read = await a_report_adopted(database, client)
            async with client.start_session() as session:
                await session.with_transaction(
                    lambda session: empty_pupil_entries_in_session(
                        spielberichte_collection=database[Collection.SPIELBERICHTE], spieler_id=LINA, session=session
                    )
                )
            [document] = await stored(database)

            return document["version"] - read, document["bericht"]["scorers"][0]["spieler_id"], await season_states(database)

        assert await on_the_league(mongo_replica_set_url, body) == (2, None, ["adopted"])
