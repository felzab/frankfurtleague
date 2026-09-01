from itertools import product
from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.admin_router import generate_spielplan, patch_saison
from app.api.saisons.cache import invalidate_saison_cache
from app.api.saisons.schemas import (
    FLGenerateSpielplanPayload,
    FLGenerateSpielplanResponse,
    FLPatchSaisonPayload,
    FLPatchSaisonResponse,
    FLSaisonRules,
    FLSpielplanShape,
)
from app.api.saisons.services import RULES_KADER_BELOW_USE, RULES_SHAPE_AFTER_DRAW, RULES_TIEBREAK_AFTER_KNOCKOUT
from app.api.spiele.schemas import KNOCKOUT_PHASES
from app.api.spieler.admin_router import post_saison_spieler
from app.api.spieler.schemas import FLPostSaisonSpielerPayload
from app.api.teams.services import offered_gruppen
from app.core.collections import Collection
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentConflictException, DocumentNotFoundException
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_saison_patch_isolation_test")

SAISON_ID = "2026"
SAISON_START = "2026-01-01"
SAISON_END = "2026-06-30"

# Fixed rather than the real day, so the watermark's date is a value this file chose.
TODAY = "2026-08-21"

GROUPS = 4
TEAMS_PER_GROUP = 4
QUALIFIERS = 2

# The edit the second administrator submits. A WIDENING, so nothing but `REQ-RULES-011` can refuse
# it: `REQ-RULES-003` reads the narrowing direction, and the season's span covers the longer schedule.
WIDER_PER_GROUP = 6

# The squad the seed fills, and the cap the narrowing patch proposes: equal, so `REQ-RULES-009`
# has nothing to refuse until the rival's insert lands.
SEEDED_SQUAD = 3

# The other order the season could rank a group by. NOT a shape field, so `REQ-RULES-011` passes it
# on a drawn season and `REQ-RULES-012` is the only rule left to refuse it.
REORDERED_TIEBREAK = "direkter_vergleich"

# The one squad the seed and the rival both write, the first seeded club's.
SQUAD_TEAM_ID = ObjectId(f"6890a1b2c3d4e5f6079{0:05d}")


def rules_document(**overrides: Any) -> dict[str, Any]:
    """Every key spelled out, so a key added to the model fails here rather than taking a default nobody picked."""

    return {
        "win_points": 3,
        "draw_points": 1,
        "qualifiers_per_group": QUALIFIERS,
        "number_of_groups": GROUPS,
        "teams_per_group": TEAMS_PER_GROUP,
        "tiebreak_order": "tordifferenz",
        "max_kadergroesse": 18,
        "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
        "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
        **overrides,
    }


def saison_document() -> dict[str, Any]:
    """`future` and undrawn: the state in which the shape rules are still open to a patch."""

    return {"_id": SAISON_ID, "start_date": SAISON_START, "end_date": SAISON_END, "status": "future", "rules": rules_document()}


def entry_rows() -> list[dict[str, Any]]:
    """Every offered group filled to `teams_per_group`, which is what `REQ-SPIELPLAN-004` asks of a season about to be drawn."""

    return [
        {
            "_id": ObjectId(f"6890a1b2c3d4e5f6078{index:05d}"),
            "saison_id": SAISON_ID,
            "team_id": ObjectId(f"6890a1b2c3d4e5f6079{index:05d}"),
            "gruppe": gruppe,
            "austritt": None,
            "name": f"{gruppe}{seat + 1}-Schule",
            "shorthand": f"{gruppe}{seat + 1}",
        }
        for index, (seat, gruppe) in enumerate(product(range(TEAMS_PER_GROUP), offered_gruppen(GROUPS)))
    ]


def squad_rows(count: int) -> list[dict[str, Any]]:
    """One club's live squad at `count`, every validator-required key stated."""

    return [
        {
            "_id": ObjectId(f"6890a1b2c3d4e5f6076{index:05d}"),
            "spieler_id": ObjectId(f"6890a1b2c3d4e5f6075{index:05d}"),
            "saison_id": SAISON_ID,
            "team_id": SQUAD_TEAM_ID,
            "is_nachgetragen": False,
            "stufe": None,
            "position": None,
            "nummer": None,
            "rolle": None,
            "inactive_since": None,
        }
        for index in range(count)
    ]


class SeasonsRunningAHookBeforeTheWrite:
    """The seasons collection, running one hook immediately before the first update asked of it.

    A stand-in rather than a subclass: the driver builds a collection off a database handle, so what
    the endpoint is handed must delegate every other call.
    """

    def __init__(self, inner: Any, hook: Callable[[], Awaitable[Any]]) -> None:
        self._inner = inner
        self._hook: Callable[[], Awaitable[Any]] | None = hook
        # Every `find_one` answered. A REFUSED patch reads no echo back, so there the count is one
        # per entry into the endpoint's callback and a second one is the retry.
        self.season_reads = 0

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        self.season_reads += 1

        return await self._inner.find_one(*args, **kwargs)

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        # ONE-SHOT: the retry has to re-judge against the draw rather than draw again, and a second
        # draw would be refused on its own account and mask the refusal this proves.
        if self._hook is not None:
            hook, self._hook = self._hook, None
            await hook()

        return await self._inner.find_one_and_update(*args, **kwargs)


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_seeded_saison(url: str, body: Body) -> Any:
    """A transaction cannot create a collection, so every one a body writes in is built by the seed."""

    async def _run() -> Any:
        # The SHIPPED validators and unique indexes, and every collection -- including the one the
        # action log appends to inside each of the two transactions below.
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            # Process-global and keyed by season id, so an entry another module left would answer for this one.
            invalidate_saison_cache()

            await database[Collection.SAISONS].insert_one(saison_document())
            await database[Collection.SAISON_TEAMS].insert_many(entry_rows())

            return await body(database, client)

    return on_the_seed_loop(_run())


async def call_draw(database: AsyncDatabase, client: AsyncMongoClient) -> FLGenerateSpielplanResponse:
    """The shape the season already carries, so the draw moves the fixtures and no rule of its own."""

    return await generate_spielplan(
        saison_id=SAISON_ID,
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        db=client,
        spielplan_data=FLGenerateSpielplanPayload(
            shape=FLSpielplanShape(number_of_groups=GROUPS, teams_per_group=TEAMS_PER_GROUP, qualifiers_per_group=QUALIFIERS)
        ),
        today=TODAY,
    )


async def call_patch_rules(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    *,
    saison_id: str = SAISON_ID,
    saisons_collection: Any = None,
    **overrides: Any,
) -> FLPatchSaisonResponse:
    """The whole rules object every time, `rules` being required on the patch, so a case names only the value it moves."""

    return await patch_saison(
        saison_id=saison_id,
        saison_data=FLPatchSaisonPayload(
            start_date=SAISON_START,
            end_date=SAISON_END,
            rules=FLSaisonRules.model_validate(rules_document(**overrides)),
            # Stated rather than omitted: the payload replaces the season wholesale, so `bewerbung`
            # carries no default and this helper is not about the application window.
            bewerbung=None,
        ),
        saisons_collection=saisons_collection if saisons_collection is not None else database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        db=client,
    )


async def call_add_a_player(database: AsyncDatabase) -> Any:
    """The rival write: one more player into the seeded squad, through the route, outside any transaction."""

    return await post_saison_spieler(
        spieler_id=ObjectId(f"6890a1b2c3d4e5f6075{SEEDED_SQUAD:05d}"),
        saison_spieler_data=FLPostSaisonSpielerPayload(
            saison_id=SAISON_ID,
            team_id=SQUAD_TEAM_ID,
            nummer=None,
            position=None,
            stufe=None,
            is_nachgetragen=False,
            rolle=None,
        ),
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
    )


async def call_abandon_a_knockout(database: AsyncDatabase) -> None:
    """The rival write: one drawn knockout fixture is marked abandoned, straight into `spiele`.

    Not through the fixture route: a knockout slot drawn from a `quelle` names no teams yet, so
    there is no result for that route to take.
    """

    fixture = await database[Collection.SPIELE].find_one({"saison_id": SAISON_ID, "saison_phase": {"$in": list(KNOCKOUT_PHASES)}})
    assert fixture is not None, "the draw left this season no knockout fixture to record against"

    await database[Collection.SPIELE].update_one({"_id": fixture["_id"]}, {"$set": {"sonderereignis": "abgebrochen"}})


async def abandoned_knockouts_now(database: AsyncDatabase) -> int:
    """The records this file's rival leaves, counted where `app/api/teams/services.py :: has_taken_place` would answer True."""

    return await database[Collection.SPIELE].count_documents(
        {"saison_id": SAISON_ID, "saison_phase": {"$in": list(KNOCKOUT_PHASES)}, "sonderereignis": "abgebrochen"}
    )


async def season_now(database: AsyncDatabase) -> dict[str, Any]:
    """Read outside any transaction -- what a later request would find."""

    stored = await database[Collection.SAISONS].find_one({"_id": SAISON_ID})
    assert stored is not None, f"the seed holds no season {SAISON_ID}"

    return dict(stored)


async def counts_now(database: AsyncDatabase) -> tuple[int, int]:
    return (
        await database[Collection.SPIELTAGE].count_documents({"saison_id": SAISON_ID}),
        await database[Collection.SPIELE].count_documents({"saison_id": SAISON_ID}),
    )


async def live_squad_now(database: AsyncDatabase) -> int:
    """The seeded club's live rows, counted as `REQ-RULES-009`'s judgement counts them."""

    return await database[Collection.SAISON_SPIELER].count_documents({"saison_id": SAISON_ID, "team_id": SQUAD_TEAM_ID, "inactive_since": None})


class TestAPlayerAddedMidPatchIsJudgedAgain:
    """Two administrators on one season: the squad is at the proposed cap when the patch judges, and over it when it writes.

    The rival writes `saison_spieler`, which the callback only reads: no conflict, no retry;
    the out-of-session re-judgement refuses.
    """

    def test_the_narrowing_is_refused_on_the_player_added_under_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_SPIELER].insert_many(squad_rows(SEEDED_SQUAD))

            async def add_between() -> None:
                await call_add_a_player(database)

            seasons = SeasonsRunningAHookBeforeTheWrite(database[Collection.SAISONS], add_between)

            with pytest.raises(DocumentConflictException) as refusal:
                await call_patch_rules(database, client, saisons_collection=seasons, max_kadergroesse=SEEDED_SQUAD)

            return refusal.value, seasons.season_reads, await season_now(database), await live_squad_now(database)

        refusal, season_reads, stored, squad = on_a_seeded_saison(mongo_replica_set_url, body)

        # `REQ-RULES-009` weighs the largest live squad, and it stood AT the proposed cap when this
        # request first judged: the refusal can only come from the re-judgement after the write.
        assert refusal.error_code == RULES_KADER_BELOW_USE
        # TWO, and neither is a retry: the judgement's read, then the echo read the write itself
        # makes -- the refusal lands after the write, so the write's own re-read has happened.
        assert season_reads == 2, "a third read means the write conflicted and the retry re-entered the callback"

        assert stored["rules"]["max_kadergroesse"] == 18, "the narrowing landed on top of the rival's insert"
        assert squad == SEEDED_SQUAD + 1, "the rival's insert was lost, so the refusal above had nothing to refuse"

    def test_the_same_narrowing_commits_when_no_player_is_added(self, mongo_replica_set_url: str):
        """The control: without it the case above would pass on an endpoint that refused every narrowing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_SPIELER].insert_many(squad_rows(SEEDED_SQUAD))

            response = await call_patch_rules(database, client, max_kadergroesse=SEEDED_SQUAD)

            return response, await season_now(database)

        response, stored = on_a_seeded_saison(mongo_replica_set_url, body)

        assert response.updated_document.rules.max_kadergroesse == SEEDED_SQUAD
        assert stored["rules"]["max_kadergroesse"] == SEEDED_SQUAD


class TestADrawLandingMidPatchIsJudgedAgain:
    """Two administrators on one season: the shape rules are open when the patch judges and closed when it writes.

    The hook makes the interleaving a fact rather than a race -- the draw runs to completion inside
    the very call the update is made from.
    """

    def test_the_widening_is_refused_on_the_draw_that_landed_under_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            drawn: list[FLGenerateSpielplanResponse] = []

            async def draw_between() -> None:
                drawn.append(await call_draw(database, client))

            seasons = SeasonsRunningAHookBeforeTheWrite(database[Collection.SAISONS], draw_between)

            with pytest.raises(DocumentConflictException) as refusal:
                await call_patch_rules(database, client, saisons_collection=seasons, teams_per_group=WIDER_PER_GROUP)

            return refusal.value, drawn[0], seasons.season_reads, await season_now(database), await counts_now(database)

        refusal, drawn, season_reads, stored, counts = on_a_seeded_saison(mongo_replica_set_url, body)

        # `REQ-RULES-011` reads the season's stored fixtures, and there were none when this request
        # first judged: the refusal can only come from a judgement made after the draw committed.
        assert refusal.error_code == RULES_SHAPE_AFTER_DRAW
        assert season_reads == 2, "the callback judged once, so the write conflicted without being re-judged"

        assert stored["rules"]["teams_per_group"] == TEAMS_PER_GROUP, "the patch landed on top of the draw"
        assert counts == (drawn.spieltage, drawn.spiele)
        assert stored["spielplan"] == {"generiert_am": TODAY, "spieltage": drawn.spieltage, "spiele": drawn.spiele}

    def test_the_same_widening_commits_when_no_draw_lands(self, mongo_replica_set_url: str):
        """The control: without it the case above would pass on an endpoint that refused every widening."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await call_patch_rules(database, client, teams_per_group=WIDER_PER_GROUP)

            return response, await season_now(database), await counts_now(database)

        response, stored, counts = on_a_seeded_saison(mongo_replica_set_url, body)

        assert response.updated_document.rules.teams_per_group == WIDER_PER_GROUP
        assert stored["rules"]["teams_per_group"] == WIDER_PER_GROUP
        assert counts == (0, 0), "the control drew a Spielplan of its own"


class TestAKnockoutResultLandingMidPatchIsJudgedAgain:
    """Two administrators on one season: no knockout fixture holds a record when the patch judges, and one does when it writes.

    The rival writes `spiele`, which the callback only reads: no conflict, no retry; the
    out-of-session re-judgement refuses.
    """

    def test_the_reorder_is_refused_on_the_record_left_under_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_draw(database, client)

            async def abandon_between() -> None:
                await call_abandon_a_knockout(database)

            seasons = SeasonsRunningAHookBeforeTheWrite(database[Collection.SAISONS], abandon_between)

            with pytest.raises(DocumentConflictException) as refusal:
                await call_patch_rules(database, client, saisons_collection=seasons, tiebreak_order=REORDERED_TIEBREAK)

            return refusal.value, seasons.season_reads, await season_now(database), await abandoned_knockouts_now(database)

        refusal, season_reads, stored, abandoned = on_a_seeded_saison(mongo_replica_set_url, body)

        # `REQ-RULES-012` weighs the knockout fixtures holding a record, and there were none when
        # this request first judged: the refusal can only come from the re-judgement after the write.
        assert refusal.error_code == RULES_TIEBREAK_AFTER_KNOCKOUT
        # TWO, and neither is a retry: the judgement's read, then the echo read the write itself
        # makes -- the rival touched `spiele` alone, so nothing conflicted.
        assert season_reads == 2, "a third read means the write conflicted and the retry re-entered the callback"

        assert stored["rules"]["tiebreak_order"] == "tordifferenz", "the reorder landed on top of the rival's record"
        assert abandoned == 1, "the rival's record was lost, so the refusal above had nothing to refuse"

    def test_the_same_reorder_commits_when_no_record_lands(self, mongo_replica_set_url: str):
        """The control: without it the case above would pass on an endpoint that refused every reorder."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_draw(database, client)

            response = await call_patch_rules(database, client, tiebreak_order=REORDERED_TIEBREAK)

            return response, await season_now(database)

        response, stored = on_a_seeded_saison(mongo_replica_set_url, body)

        assert response.updated_document.rules.tiebreak_order == REORDERED_TIEBREAK
        assert stored["rules"]["tiebreak_order"] == REORDERED_TIEBREAK


class TestAnUnknownSeasonIsStillNotFound:
    """The read raising it runs inside the transaction, which has to abort on it rather than carry it."""

    def test_a_season_id_naming_nothing_answers_404(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException) as missing:
                await call_patch_rules(database, client, saison_id="2099")

            return missing.value.error_code, await season_now(database)

        error_code, stored = on_a_seeded_saison(mongo_replica_set_url, body)

        assert error_code == DOCUMENT_NOT_FOUND
        assert stored["rules"]["teams_per_group"] == TEAMS_PER_GROUP, "the seeded season was touched"
