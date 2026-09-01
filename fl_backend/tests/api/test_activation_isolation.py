from itertools import product
from typing import Any, Awaitable, Callable, Sequence

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.api.saisons.admin_router import activate_saison, generate_spielplan, undraw_spielplan
from app.api.saisons.cache import invalidate_saison_cache
from app.api.saisons.schemas import FLActivateSaisonResponse, FLGenerateSpielplanPayload
from app.api.saisons.services import ACTIVATE_SAISON_UNFINISHED, ACTIVATE_TARGET_PAST, ACTIVATE_TARGET_UNDRAWN
from app.api.spiele.schemas import SONDEREREIGNIS_WITHOUT_A_RESULT
from app.api.teams.services import offered_gruppen
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException
from tests.database import a_clean_database, on_the_seed_loop

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_activation_isolation_test"

OUTGOING = "2025"
TARGET = "2026"
RIVAL = "2027"

# Fixed rather than the real day, so the watermark the seed's draw stamps is a value this file chose.
TODAY = "2026-08-25"

GROUPS = 4
TEAMS_PER_GROUP = 4
QUALIFIERS = 2

# What the seed enters on every fixture of a season it needs FINISHED: `unplayed_spiel_nrs` counts
# the fixtures owing a result, and one carrying any result owes none.
FINAL_SCORE = "3:0"

# One block of junction-row ids per season, so two seeded seasons cannot collide on `_id`.
ENTRY_BLOCK = {OUTGOING: "1", TARGET: "2", RIVAL: "3"}

# What a case reports where the rollover was not refused at all. Reported rather than raised, so a
# rollover that lands names the state it left instead of an exception that failed to arrive.
COMMITTED = "the rollover committed"


def saison_document(saison_id: str, status: str) -> dict[str, Any]:
    """Complete, because the promoted document is validated as `FLSaison` on the way back out.

    The span covers the schedule the rules imply, the seed drawing these seasons through the route
    that measures one against the other.
    """

    return {
        "_id": saison_id,
        "start_date": f"{saison_id}-01-01",
        "end_date": f"{saison_id}-06-30",
        "status": status,
        "rules": {
            "win_points": 3,
            "draw_points": 1,
            "qualifiers_per_group": QUALIFIERS,
            "number_of_groups": GROUPS,
            "teams_per_group": TEAMS_PER_GROUP,
            "tiebreak_order": "tordifferenz",
            "max_kadergroesse": 18,
            "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
            "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
        },
    }


def entry_rows(saison_id: str) -> list[dict[str, Any]]:
    """Every offered group filled to `teams_per_group`, which is what `REQ-SPIELPLAN-004` asks of a season about to be drawn."""

    return [
        {
            "_id": ObjectId(f"6890a1b2c3d4e5f60{ENTRY_BLOCK[saison_id]}7{index:05d}"),
            "saison_id": saison_id,
            # The same clubs in every seeded season: a `team_id` names a club, and a club plays year
            # after year. Only the junction row is the season's own.
            "team_id": ObjectId(f"6890a1b2c3d4e5f6079{index:05d}"),
            "gruppe": gruppe,
            "austritt": None,
            "name": f"{gruppe}{seat + 1}-Schule",
            "shorthand": f"{gruppe}{seat + 1}",
        }
        for index, (seat, gruppe) in enumerate(product(range(TEAMS_PER_GROUP), offered_gruppen(GROUPS)))
    ]


class SeasonsRunningAHookBeforeTheRollover:
    """A `saisons` stand-in running one hook just before the demotion, so the interleaving is a fact rather than a race.

    Not a subclass: Motor builds a collection off a database handle, so it has to answer every
    other call by delegating.
    """

    def __init__(self, inner: Any, hook: Callable[[], Awaitable[Any]]) -> None:
        self._inner = inner
        self._hook: Callable[[], Awaitable[Any]] | None = hook
        # Every `find_one`. A REFUSED rollover reads no echo back, so there the count is one per
        # entry into the endpoint's callback and a second one is the retry.
        self.season_reads = 0

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        self.season_reads += 1

        return await self._inner.find_one(*args, **kwargs)

    async def update_many(self, *args: Any, **kwargs: Any) -> Any:
        # ONE-SHOT: the retry has to re-judge against what landed rather than run the interference
        # again, and a second draw or rollover would be refused on its own account and mask this one.
        if self._hook is not None:
            hook, self._hook = self._hook, None
            await hook()

        return await self._inner.update_many(*args, **kwargs)


Body = Callable[[AsyncIOMotorDatabase, AsyncIOMotorClient], Awaitable[Any]]


def on_a_league(
    url: str,
    body: Body,
    *,
    saisons: list[dict[str, Any]],
    entered: Sequence[str] = (),
    drawn: Sequence[str] = (),
    finished: Sequence[str] = (),
) -> Any:
    """A transaction cannot create a collection, so every one a body writes in is built by the seed."""

    async def _run() -> Any:
        # The SHIPPED validators and unique indexes, and every collection -- including the one the
        # action log appends to inside each transaction below.
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            # Process-global and keyed by season id, so an entry another module left would answer for this one.
            invalidate_saison_cache()

            await database[Collection.SAISONS].insert_many(saisons)
            for saison_id in entered:
                await database[Collection.SAISON_TEAMS].insert_many(entry_rows(saison_id))

            # Through the ROUTE rather than by hand: the fixtures an interference then adds to or
            # removes from are the ones a drawn season really holds, watermark included.
            for saison_id in drawn:
                await call_draw(database, client, saison_id)

            for saison_id in finished:
                await database[Collection.SPIELE].update_many({"saison_id": saison_id}, {"$set": {"ergebnis": FINAL_SCORE}})

            return await body(database, client)

    return on_the_seed_loop(_run())


async def call_draw(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient, saison_id: str) -> Any:
    """No `shape` on the payload, so the draw runs on the rules the season already carries and moves none of them."""

    return await generate_spielplan(
        saison_id=saison_id,
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        db=client,
        spielplan_data=FLGenerateSpielplanPayload(),
        today=TODAY,
    )


async def call_undraw(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient, saison_id: str) -> Any:
    return await undraw_spielplan(
        saison_id=saison_id,
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        db=client,
    )


async def call_activate(
    database: AsyncIOMotorDatabase,
    client: AsyncIOMotorClient,
    saison_id: str,
    *,
    saisons_collection: Any = None,
) -> FLActivateSaisonResponse:
    """`saisons_collection` is overridable so a case can hand the endpoint the hooked stand-in and nothing else."""

    return await activate_saison(
        saison_id=saison_id,
        saisons_collection=saisons_collection if saisons_collection is not None else database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        db=client,
    )


async def rollover_under(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient, hook: Callable[[], Awaitable[Any]]) -> tuple[str, int]:
    """`hook` lands between the rollover's judgement and its write.

    Only a refusal is caught: a write conflict reaching the caller is a retry that never happened,
    and must surface as itself rather than a rollover that declined.
    """

    seasons = SeasonsRunningAHookBeforeTheRollover(database[Collection.SAISONS], hook)

    try:
        await call_activate(database, client, TARGET, saisons_collection=seasons)
        outcome = COMMITTED
    except DocumentConflictException as refusal:
        outcome = refusal.error_code

    return outcome, seasons.season_reads


async def statuses_now(database: AsyncIOMotorDatabase) -> dict[str, str]:
    """Read outside any transaction -- what a later request would see."""

    rows = await database[Collection.SAISONS].find({}).to_list(length=None)

    return {row["_id"]: row["status"] for row in rows}


async def unplayed_now(database: AsyncIOMotorDatabase, saison_id: str) -> int:
    """Fixtures owing a result, spelled as `unplayed_spiel_nrs` reads them: no result, and no cancellation standing in for one."""

    return await database[Collection.SPIELE].count_documents(
        {"saison_id": saison_id, "ergebnis": None, "sonderereignis": {"$nin": list(SONDEREREIGNIS_WITHOUT_A_RESULT)}}
    )


async def fixtures_now(database: AsyncIOMotorDatabase, saison_id: str) -> int:
    return await database[Collection.SPIELE].count_documents({"saison_id": saison_id})


class TestADrawLandingMidRolloverIsJudgedAgain:
    """The outgoing season owes nothing when the rollover judges, and a whole Spielplan when it writes.

    A missed judgement is unrecoverable: `REQ-ACTIVATE-002` never promotes a `past` season back.
    """

    def test_the_rollover_is_refused_on_the_fixtures_drawn_under_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            async def draw_the_outgoing_season() -> None:
                # Permitted while it is `active`: `REQ-SPIELPLAN-003` refuses a draw on a `past`
                # season alone, which is exactly why the rollover may not close this one blind.
                await call_draw(database, client, OUTGOING)

            outcome, season_reads = await rollover_under(database, client, draw_the_outgoing_season)

            return outcome, season_reads, await statuses_now(database), await unplayed_now(database, OUTGOING)

        outcome, season_reads, statuses, unplayed = on_a_league(
            mongo_replica_set_url,
            body,
            # The outgoing season is undrawn, which is what makes it read as owing nothing.
            saisons=[saison_document(OUTGOING, "active"), saison_document(TARGET, "future")],
            entered=(OUTGOING, TARGET),
            drawn=(TARGET,),
        )

        # `REQ-ACTIVATE-001` reads the outgoing season's fixtures, and it held none when this request
        # first judged, so only a second judgement can refuse. The statuses ride along, naming the
        # `past` season a landed rollover left unplayed.
        assert (outcome, statuses) == (ACTIVATE_SAISON_UNFINISHED, {OUTGOING: "active", TARGET: "future"})
        assert season_reads == 2, "the callback judged once, so the write conflicted without being re-judged"

        assert unplayed > 0, "the interfering draw left the outgoing season nothing to play, so the rule above had nothing to refuse"


class TestAnUndrawLandingMidRolloverIsJudgedAgain:
    """The target is drawn when the rollover judges and undrawn when it writes, which `REQ-ACTIVATE-003` exists to refuse."""

    def test_the_rollover_is_refused_on_the_fixtures_removed_under_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            async def undraw_the_target() -> None:
                # Permitted on a `future` season with nothing recorded against it, which the target
                # of a rollover is by definition.
                await call_undraw(database, client, TARGET)

            outcome, season_reads = await rollover_under(database, client, undraw_the_target)

            return outcome, season_reads, await statuses_now(database), await fixtures_now(database, TARGET)

        outcome, season_reads, statuses, fixtures = on_a_league(
            mongo_replica_set_url,
            body,
            # Nothing holds `active`, so no incumbent can be the reason for the refusal below.
            saisons=[saison_document(TARGET, "future")],
            entered=(TARGET,),
            drawn=(TARGET,),
        )

        # Paired as above: a rollover that lands names the league it left going live with nothing to play.
        assert (outcome, statuses) == (ACTIVATE_TARGET_UNDRAWN, {TARGET: "future"})
        assert season_reads == 2, "the callback judged once, so the write conflicted without being re-judged"

        assert fixtures == 0, "the interfering undraw left the target its fixtures, so the rule above had nothing to refuse"


class TestARivalRolloverLandingMidRolloverIsJudgedAgain:
    """The target holds `active` when the rollover judges and `past` when it writes, a rival having been promoted.

    Two seasons hold `active` here, which `app/core/domain.py :: UNENFORCED` says nothing prevents.
    """

    def test_a_target_demoted_under_the_rollover_is_refused_as_past(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            async def promote_the_rival() -> None:
                # Permitted: both incumbents are played out, so this rollover has nothing of its own
                # to refuse -- and it demotes the pair, the target included.
                await call_activate(database, client, RIVAL)

            outcome, season_reads = await rollover_under(database, client, promote_the_rival)

            return outcome, season_reads, await statuses_now(database), await unplayed_now(database, RIVAL)

        outcome, season_reads, statuses, unplayed = on_a_league(
            mongo_replica_set_url,
            body,
            # Both incumbents matter: a rival's rollover demotes the target out from under this one,
            # and with only one seeded the demotion matches nothing -- the promotion then changes no
            # field, takes no write conflict and is never re-judged.
            saisons=[saison_document(OUTGOING, "active"), saison_document(TARGET, "active"), saison_document(RIVAL, "future")],
            entered=(OUTGOING, TARGET, RIVAL),
            drawn=(OUTGOING, TARGET, RIVAL),
            finished=(OUTGOING, TARGET),
        )

        # The rival keeps what the interference gave it: a season promoted and then swept straight
        # back to `past` unplayed is the second thing this refusal saves.
        assert (outcome, statuses) == (ACTIVATE_TARGET_PAST, {OUTGOING: "past", TARGET: "past", RIVAL: "active"})
        assert season_reads == 2, "the callback judged once, so the write conflicted without being re-judged"

        assert unplayed > 0, "the rival was seeded played out, and demoting it would then have broken no rule"


class TestTheRolloverStillCommitsWithNothingInterfering:
    """The control: without it every case above would pass on an endpoint that refused every rollover."""

    def test_the_outgoing_season_is_demoted_and_the_target_promoted(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            response = await call_activate(database, client, TARGET)

            return response, await statuses_now(database)

        response, statuses = on_a_league(
            mongo_replica_set_url,
            body,
            # The same seed the draw case runs on, interference apart.
            saisons=[saison_document(OUTGOING, "active"), saison_document(TARGET, "future")],
            entered=(OUTGOING, TARGET),
            drawn=(TARGET,),
        )

        assert statuses == {OUTGOING: "past", TARGET: "active"}
        assert response.deactivated == 1
        assert (response.updated_document.id, response.updated_document.status) == (TARGET, "active")
