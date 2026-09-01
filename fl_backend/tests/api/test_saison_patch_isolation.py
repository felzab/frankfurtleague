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
from app.api.saisons.services import RULES_SHAPE_AFTER_DRAW
from app.api.teams.services import offered_gruppen
from app.core.collections import Collection
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentConflictException, DocumentNotFoundException
from tests.database import a_clean_database, on_the_seed_loop

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_saison_patch_isolation_test"

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
