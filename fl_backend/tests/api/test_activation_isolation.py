from collections.abc import Awaitable, Callable, Sequence
from datetime import datetime
from itertools import product
from typing import Any, Literal, cast
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spiele.admin_router import patch_spiel
from app.api.spiele.schemas import FLPatchSpielDataPayload
from app.api.spieler.admin_router import patch_spieler_saison
from app.api.spieler.schemas import FLPatchSpielerSaisonPayload
from app.api.teams.crud import write_the_team
from app.api.teams.services import offered_gruppen
from app.core.codes import Code
from app.core.collections import Collection
from app.core.crud import composite_version
from app.core.exceptions import APIError
from app.core.transactions import transaction_session
from app.shared.schemas.responses import FLVersionResponse
from tests.database import a_clean_database
from tests.documents import (
    ADDRESS,
    rules_document,
    saison_document,
    saison_spieler_document,
    saison_team_document,
    spieler_document,
    team_document,
)
from tests.isolation import InterleavedCollection, Rival, outcome_of
from tests.payloads import spiel_patch_body
from tests.season_routes import call_activate, call_draw, call_season_save
from tests.stored import the_row
from tests.team_writes import save_the_team
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_activation_isolation_test")

OUTGOING = "2025"
TARGET = "2026"
RIVAL = "2027"

# Fixed rather than the real day, so the watermark the seed's draw stamps is a value this file chose.
TODAY = "2026-08-25"
# Noon of that day, the instant a match save reads its day from.
NOW = datetime(2026, 8, 25, 12, 0, tzinfo=ZoneInfo("Europe/Berlin"))

GROUPS = 4
TEAMS_PER_GROUP = 4
QUALIFIERS = 2

# What the seed enters on every fixture of a season it needs FINISHED: `is_unplayed` counts
# the fixtures owing a result, and one carrying any result owes none.
FINAL_SCORE = "3:0"

# One block of junction-row ids per season, so two seeded seasons cannot collide on `_id`.
ENTRY_BLOCK = {OUTGOING: "1", TARGET: "2", RIVAL: "3"}

# The one pupil a case seats, in the incumbent's squad.
SPIELER = ObjectId("6890a1b2c3d4e5f607a00001")

# Days ahead of the target's seeded start and still after `TODAY`: earlier, so every matchday the seed dates stays
# inside the season (`saison_span_below_spieltage`), and the start moved is the only thing the patch asks.
MOVED_START = f"{TARGET}-08-28"


def seeded_saison(saison_id: str, status: str) -> dict[str, Any]:
    """The shape rules spelled out: the seed fills and draws each season by them.

    From September of the id's year, so the target has not started on `TODAY` and its rules stay open to a patch.
    """

    return saison_document(
        saison_id,
        status,
        start_date=f"{saison_id}-09-01",
        end_date=f"{saison_id}-12-31",
        rules=rules_document(qualifiers_per_gruppe=QUALIFIERS, number_of_gruppen=GROUPS, teams_per_gruppe=TEAMS_PER_GROUP),
    )


def entry_rows(saison_id: str) -> list[dict[str, Any]]:
    """Every offered group filled to `teams_per_gruppe`, which is what `spielplan_gruppen_off_rules` asks of a season about to be drawn."""

    return [
        saison_team_document(
            saison_id,
            # The same clubs in every seeded season: a `team_id` names a club, and a club plays year
            # after year. Only the junction row is the season's own.
            ObjectId(f"6890a1b2c3d4e5f6079{index:05d}"),
            f"{gruppe}{seat + 1}-Schule",
            f"{gruppe}S{chr(65 + seat)}",
            _id=ObjectId(f"6890a1b2c3d4e5f60{ENTRY_BLOCK[saison_id]}7{index:05d}"),
            gruppe=gruppe,
        )
        for index, (seat, gruppe) in enumerate(product(range(TEAMS_PER_GROUP), offered_gruppen(GROUPS)))
    ]


class SeasonsRunningOneHook(InterleavedCollection):
    """A `saisons` stand-in running one hook once, so the interleaving is a fact rather than a race.

    Just before the write by default -- a rollover's demotion, a patch's update -- or just after the
    first read returns, between the season row's read and the write resting on it.
    """

    def __init__(self, collection: Any, hook: Rival, *, at: Literal["after_the_first_read", "before_the_write"] = "before_the_write") -> None:
        super().__init__(collection, hook)
        self._at = at

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        found = await self._collection.find_one(*args, **kwargs)
        if self._at == "after_the_first_read":
            await self.run_the_rival()

        return found

    async def update_many(self, *args: Any, **kwargs: Any) -> Any:
        if self._at == "before_the_write":
            await self.run_the_rival()

        return await self._collection.update_many(*args, **kwargs)

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        if self._at == "before_the_write":
            await self.run_the_rival()

        return await self._collection.find_one_and_update(*args, **kwargs)


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def on_a_league(
    url: str,
    body: Body,
    *,
    saisons: list[dict[str, Any]],
    entered: Sequence[str] = (),
    drawn: Sequence[str] = (),
    finished: Sequence[str] = (),
) -> Any:
    """A transaction cannot create a collection, so every one a body writes in is built by the seed."""

    # The shipped unique indexes, and every collection -- including the one the
    # action log appends to inside each transaction below.
    async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
        await database[Collection.SAISONS].insert_many(saisons)
        for saison_id in entered:
            await database[Collection.SAISON_TEAMS].insert_many(entry_rows(saison_id))

        # Through the ROUTE rather than by hand: the fixtures an interference then adds to or
        # removes from are the ones a drawn season really holds, watermark included.
        for saison_id in drawn:
            await call_draw(database, client, saison_id=saison_id, today=TODAY)
            # The draw leaves every matchday undated, so without this `activate_spieltage_undated` would
            # answer every case in this file before the interference it is about could be judged. Inside
            # the season's span, so a patch of its dates is not refused on them.
            await database[Collection.SPIELTAGE].update_many(
                {"saison_id": saison_id}, {"$set": {"start": f"{saison_id}-09-15", "end": f"{saison_id}-09-16"}}
            )

        for saison_id in finished:
            await database[Collection.SPIELE].update_many({"saison_id": saison_id}, {"$set": {"ergebnis": FINAL_SCORE}})

        return await body(database, client)


async def rollover_under(database: AsyncDatabase, client: AsyncMongoClient, hook: Callable[[], Awaitable[Any]]) -> str:
    """`hook` lands between the rollover's judgement and its write."""

    return await outcome_of(
        call_activate(database, client, TARGET, saisons_collection=SeasonsRunningOneHook(database[Collection.SAISONS], hook))
    )


async def statuses_now(database: AsyncDatabase) -> dict[str, str]:
    """Read outside any transaction -- what a later request would see."""

    rows = await database[Collection.SAISONS].find({}).to_list(length=None)

    return {row["_id"]: row["status"] for row in rows}


async def call_patch_start(database: AsyncDatabase, *, saisons_collection: Any, start_date: str) -> FLVersionResponse:
    """The target's seeded end and whole rules every time, `rules` being required on the patch, so the start is all it moves."""

    seeded = seeded_saison(TARGET, "future")

    return await call_season_save(
        database,
        saison_id=TARGET,
        start_date=start_date,
        end_date=str(seeded["end_date"]),
        rules=seeded["rules"],
        today=TODAY,
        saisons_collection=saisons_collection,
    )


async def call_enter_a_result(database: AsyncDatabase) -> None:
    """The rival write: one drawn group fixture of the target takes a result, straight into `spiele`, which fixes its start."""

    spiel = await database[Collection.SPIELE].find_one({"saison_id": TARGET, "saison_phase": "gruppenphase"})
    assert spiel is not None, "the draw left the target no group fixture to score"

    await database[Collection.SPIELE].update_one({"_id": spiel["_id"]}, {"$set": {"ergebnis": FINAL_SCORE}})


async def results_entered(database: AsyncDatabase) -> int:
    return await database[Collection.SPIELE].count_documents({"saison_id": TARGET, "ergebnis": FINAL_SCORE})


async def start_now(database: AsyncDatabase) -> str:
    """The target's stored start, read outside any transaction."""

    return str((await the_row(database, Collection.SAISONS, {"_id": TARGET}, f"the seed holds no season {TARGET}"))["start_date"])


class TestTwoFirstActivationsRacing:
    """Nothing holds `active`, so neither demotion matches a row and the two write sets are disjoint: only `uniq_saison_active` parts them."""

    async def test_the_later_promotion_is_judged_against_the_earlier(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def promote_the_rival() -> None:
                # Permitted: nothing is running, so the rival's rollover has no incumbent to refuse on.
                await call_activate(database, client, RIVAL)

            outcome = await rollover_under(database, client, promote_the_rival)

            return outcome, await statuses_now(database)

        outcome, statuses = await on_a_league(
            mongo_replica_set_url,
            body,
            saisons=[seeded_saison(TARGET, "future"), seeded_saison(RIVAL, "future")],
            entered=(TARGET, RIVAL),
            drawn=(TARGET, RIVAL),
        )

        # The index answers the promotion with a write conflict, and the retry finds the rival
        # running with its whole Spielplan still to play. Unindexed, both commit.
        assert (outcome, statuses) == (Code.ACTIVATE_SAISON_UNFINISHED, {TARGET: "future", RIVAL: "active"})


class TestAResultLandingMidPatchIsJudgedAgain:
    """Two administrators on one season: nothing has taken place when the patch judges, and a result has when it writes.

    The rival writes `spiele`, which a moved start anchors: the anchor conflicts, and the retry refuses.
    """

    async def test_the_moved_start_is_refused_on_the_result_entered_under_it(self, mongo_replica_set_url: str):
        """Drop the fixtures' anchor from `patch_saison` and this fails."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def score_between() -> None:
                await call_enter_a_result(database)

            seasons = SeasonsRunningOneHook(database[Collection.SAISONS], score_between)

            with pytest.raises(APIError) as refusal:
                await call_patch_start(database, saisons_collection=seasons, start_date=MOVED_START)

            return refusal.value, await start_now(database), await results_entered(database)

        refusal, start, entered = await on_a_league(
            mongo_replica_set_url, body, saisons=[seeded_saison(TARGET, "future")], entered=(TARGET,), drawn=(TARGET,)
        )

        # The draw records nothing, so no fixture had taken place when this request first judged: the
        # refusal can only come from the retry the anchor's conflict forces.
        assert refusal.error_code == Code.SAISON_START_TAKEN_PLACE
        assert start == seeded_saison(TARGET, "future")["start_date"], "the start moved on a season the rival had played"
        assert entered == 1, "the rival's result was lost, so the refusal above had nothing to refuse"


class TestARolloverLandingMidSaveIsJudgedAgain:
    """A save on the incumbent: `active` when it judges `saison_past`, `past` when it writes.

    Each save only reads the season's status, so its own write meets the rollover only through an anchor: the rollover's
    on the incumbent's fixtures, and the club move's and the squad row's on the season document.
    """

    async def test_a_spiel_save_is_refused_on_the_rollover_that_landed_under_it(self, mongo_replica_set_url: str):
        """Drop the outgoing fixtures' anchor from `activate_saison` and this fails."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def roll_over_between() -> None:
                await call_activate(database, client, TARGET)

            spiel = await database[Collection.SPIELE].find_one({"saison_id": OUTGOING, "saison_phase": "gruppenphase"})
            assert spiel is not None, "the draw left the incumbent no group fixture to save"
            seasons = SeasonsRunningOneHook(database[Collection.SAISONS], roll_over_between, at="after_the_first_read")

            async with client.start_session(snapshot=True) as session:
                outcome = await outcome_of(
                    patch_spiel(
                        spiel_id=spiel["_id"],
                        # The no-op save: it writes the fixture all the same, which is what the anchor meets.
                        spiel_data=FLPatchSpielDataPayload.model_validate(spiel_patch_body(spiel)),
                        db=client,
                        spiele_collection=database[Collection.SPIELE],
                        teams_collection=database[Collection.TEAMS],
                        # The stand-in delegates every call, which the endpoint's collection type cannot say.
                        saisons_collection=cast(Any, seasons),
                        saison_teams_collection=database[Collection.SAISON_TEAMS],
                        spieltage_collection=database[Collection.SPIELTAGE],
                        spielorte_collection=database[Collection.SPIELORTE],
                        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                        spielberichte_collection=database[Collection.SPIELBERICHTE],
                        aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
                        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                        session=session,
                        germany_now=NOW,
                    )
                )

            return outcome, await statuses_now(database)

        outcome, statuses = await on_a_league(
            mongo_replica_set_url,
            body,
            saisons=[seeded_saison(OUTGOING, "active"), seeded_saison(TARGET, "future")],
            entered=(OUTGOING, TARGET),
            drawn=(OUTGOING, TARGET),
            # Played out, so the rollover has nothing of its own to refuse.
            finished=(OUTGOING,),
        )

        assert (outcome, statuses) == (Code.SAISON_PAST, {OUTGOING: "past", TARGET: "active"})

    async def test_a_team_row_save_is_refused_on_the_rollover_that_landed_under_it(self, mongo_replica_set_url: str):
        """Drop the open seasons' anchor from `write_the_team`, the one anchor the save takes on the season, and this fails."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def roll_over_between() -> None:
                await call_activate(database, client, TARGET)

            row = await database[Collection.SAISON_TEAMS].find_one({"saison_id": OUTGOING})
            assert row is not None, "the seed entered no club in the incumbent"
            await database[Collection.TEAMS].insert_one(team_document(row["team_id"], row["name"], row["shorthand"]))
            seasons = SeasonsRunningOneHook(database[Collection.SAISONS], roll_over_between, at="after_the_first_read")

            outcome = await outcome_of(
                save_the_team(
                    database,
                    team_id=row["team_id"],
                    saison_id=OUTGOING,
                    # A colour alone: a group change would meet the drawn fixtures before `saison_past` is the reason.
                    trikot_farbe="schwarz",
                    # The stand-in delegates every call, which the endpoint's collection type cannot say.
                    saisons_collection=cast(Any, seasons),
                )
            )

            return outcome, await statuses_now(database)

        outcome, statuses = await on_a_league(
            mongo_replica_set_url,
            body,
            # The incumbent undrawn, so it owes nothing and the rollover refuses nothing of its own.
            saisons=[seeded_saison(OUTGOING, "active"), seeded_saison(TARGET, "future")],
            entered=(OUTGOING, TARGET),
            drawn=(TARGET,),
        )

        assert (outcome, statuses) == (Code.SAISON_PAST, {OUTGOING: "past", TARGET: "active"})

    async def test_a_kader_row_save_is_refused_on_the_rollover_that_landed_under_it(self, mongo_replica_set_url: str):
        """Drop the season's anchor from `refuse_a_closed_kader` and this fails: the finished season's squad row takes the number."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def roll_over_between() -> None:
                await call_activate(database, client, TARGET)

            entry = await database[Collection.SAISON_TEAMS].find_one({"saison_id": OUTGOING})
            assert entry is not None, "the seed entered no club in the incumbent"
            person = spieler_document(SPIELER, "Max", "Mustermann")
            # No role, so `find_a_taken_rolle` takes no anchor of its own and the closed squad's is the one left.
            row = saison_spieler_document(SPIELER, OUTGOING, entry["team_id"])
            await database[Collection.SPIELER].insert_one(person)
            await database[Collection.SAISON_SPIELER].insert_one(row)
            # The squad check's status read is the save's first read of the season.
            seasons = SeasonsRunningOneHook(database[Collection.SAISONS], roll_over_between, at="after_the_first_read")

            outcome = await outcome_of(
                patch_spieler_saison(
                    spieler_id=SPIELER,
                    saison_id=OUTGOING,
                    spieler_data=FLPatchSpielerSaisonPayload(
                        first_name="Max",
                        last_name="Mustermann",
                        birth_date=str(person["birth_date"]),
                        nummer="7",
                        position=row["position"],
                        stufe=row["stufe"],
                        rolle=None,
                        version=composite_version(person, row),
                    ),
                    spieler_collection=database[Collection.SPIELER],
                    saison_spieler_collection=database[Collection.SAISON_SPIELER],
                    # The stand-in delegates every call, which the endpoint's collection type cannot say.
                    saisons_collection=cast(Any, seasons),
                    db=client,
                )
            )

            stored = await the_row(database, Collection.SAISON_SPIELER, {"spieler_id": SPIELER}, "the seeded squad row is gone")
            return outcome, await statuses_now(database), stored["nummer"]

        outcome, statuses, nummer = await on_a_league(
            mongo_replica_set_url,
            body,
            # The incumbent undrawn, so it owes nothing and the rollover refuses nothing of its own.
            saisons=[seeded_saison(OUTGOING, "active"), seeded_saison(TARGET, "future")],
            entered=(OUTGOING, TARGET),
            drawn=(TARGET,),
        )

        assert (outcome, statuses, nummer) == (Code.SAISON_PAST, {OUTGOING: "past", TARGET: "active"}, None)


RENAMED = "Umbenannt"


class TestARolloverLandingMidRenameIsJudgedAgain:
    """A rename rewrites the club rows of every season it reads as open, and the rollover writes no club row."""

    async def test_the_season_closed_under_it_keeps_the_name_it_was_played_under(self, mongo_replica_set_url: str):
        """Drop the open seasons' anchor from `write_the_team` and this fails: the incumbent's row is renamed after it closed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            row = await database[Collection.SAISON_TEAMS].find_one({"saison_id": OUTGOING})
            assert row is not None, "the seed entered no club in the incumbent"
            await database[Collection.TEAMS].insert_one(team_document(row["team_id"], row["name"], row["shorthand"]))

            async def roll_over_between() -> None:
                await call_activate(database, client, TARGET)

            # Just after the rename's write to the club: the transaction's first operation, which opens its snapshot, so the
            # rival commits after the snapshot and before the rename reads which seasons are still open.
            teams = InterleavedCollection(database[Collection.TEAMS], roll_over_between, after="find_one_and_update")

            # The writer alone rather than the save over it, so nothing but the rename's own anchor can meet the rollover.
            async def rename(session: AsyncClientSession) -> Any:
                return await write_the_team(
                    # The stand-in delegates every call, which the helper's collection type cannot say.
                    teams_collection=cast(Any, teams),
                    saison_teams_collection=database[Collection.SAISON_TEAMS],
                    saisons_collection=database[Collection.SAISONS],
                    team_id=row["team_id"],
                    team={
                        "name": RENAMED,
                        "shorthand": "UMX",
                        "description": "",
                        "full_name": f"{RENAMED}-Schule",
                        "website_url": "https://umbenannt.example.net",
                        "schulform": "gymnasium_g9",
                        "address": dict(ADDRESS),
                    },
                    session=session,
                )

            async with transaction_session(client) as session:
                await session.with_transaction(rename)

            rows = await database[Collection.SAISON_TEAMS].find({"team_id": row["team_id"]}).to_list(length=None)
            return row["name"], {entry["saison_id"]: entry["name"] for entry in rows}, await statuses_now(database)

        played_under, names, statuses = await on_a_league(
            mongo_replica_set_url,
            body,
            # The incumbent undrawn, so the club has no fixture there for the rollover's own anchor to meet.
            saisons=[seeded_saison(OUTGOING, "active"), seeded_saison(TARGET, "future")],
            entered=(OUTGOING, TARGET),
            drawn=(TARGET,),
        )

        assert statuses == {OUTGOING: "past", TARGET: "active"}
        assert names == {OUTGOING: played_under, TARGET: RENAMED}
