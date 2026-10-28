from collections.abc import Awaitable, Callable, Sequence
from itertools import product
from typing import Any, Literal

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.admin_router import activate_saison, generate_spielplan, patch_saison
from app.api.saisons.schemas import (
    FLActivateSaisonResponse,
    FLGenerateSpielplanPayload,
    FLGenerateSpielplanResponse,
    FLPatchSaisonPayload,
    FLPatchSaisonResponse,
    FLSaisonRules,
    FLSpielplanShape,
)
from app.api.saisons.services import RULES_SAISON_FINISHED, RULES_TIEBREAK_AFTER_KNOCKOUT
from app.api.spiele.schemas import KNOCKOUT_PHASES
from app.api.teams.services import offered_gruppen
from app.core.collections import Collection
from app.core.exceptions import WriteRefusalException
from tests import documents
from tests.actor_tokens import FRESH_STEP_UP_CHECK
from tests.database import a_clean_database, on_the_seed_loop
from tests.isolation import MISCOUNTED_JUDGEMENTS, InterleavedCollection, Rival
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_saison_patch_isolation_test")

SAISON_ID = "2026"
# The season a rollover promotes, which is the one way the season under test reaches `past`.
RIVAL_SAISON_ID = "2027"

# One block of junction-row ids per season, so two seeded seasons cannot collide on `_id`.
ENTRY_BLOCK = {SAISON_ID: "1", RIVAL_SAISON_ID: "2"}

# Fixed rather than the real day, so the watermark's date is a value this file chose.
TODAY = "2026-08-21"

GROUPS = 4
TEAMS_PER_GROUP = 4
QUALIFIERS = 2

# The other order the season could rank a group by. NOT a shape field, so `REQ-RULES-011` passes it
# on a drawn season and `REQ-RULES-012` is the only rule left to refuse it.
REORDERED_TIEBREAK = "direkter_vergleich"
STORED_TIEBREAK = "tordifferenz"


def rules_document(**overrides: Any) -> dict[str, Any]:
    return documents.rules_document(
        **{
            "qualifiers_per_group": QUALIFIERS,
            "number_of_groups": GROUPS,
            "teams_per_group": TEAMS_PER_GROUP,
            "tiebreak_order": STORED_TIEBREAK,
            **overrides,
        }
    )


def saison_document(saison_id: str = SAISON_ID, status: str = "future") -> dict[str, Any]:
    """`future` and undrawn by default: the state in which the shape rules are still open to a patch."""

    return documents.saison_document(saison_id, status, rules=rules_document())


# The patch resubmits the seeded season's own dates, so no case here is a date edit.
SAISON_START = str(saison_document()["start_date"])
SAISON_END = str(saison_document()["end_date"])


def entry_rows(saison_id: str = SAISON_ID) -> list[dict[str, Any]]:
    """Every offered group filled to `teams_per_group`, which is what `REQ-SPIELPLAN-004` asks of a season about to be drawn."""

    return [
        documents.saison_team_document(
            saison_id,
            # The same clubs in every seeded season: a `team_id` names a club, and a club plays year
            # after year. Only the junction row is the season's own.
            ObjectId(f"6890a1b2c3d4e5f6079{index:05d}"),
            f"{gruppe}{seat + 1}-Schule",
            f"{gruppe}{seat + 1}",
            _id=ObjectId(f"6890a1b2c3d4e5f60{ENTRY_BLOCK[saison_id]}8{index:05d}"),
            gruppe=gruppe,
        )
        for index, (seat, gruppe) in enumerate(product(range(TEAMS_PER_GROUP), offered_gruppen(GROUPS)))
    ]


class SeasonsRunningOneHook(InterleavedCollection):
    """The seasons collection, running one hook once at whichever of two points a case names."""

    def __init__(self, collection: Any, hook: Rival, *, at: Literal["after_the_first_read", "before_the_write"]) -> None:
        super().__init__(collection, hook)
        self._at = at
        # Every `find_one` answered. A REFUSED patch reads no echo back, so there the count is one
        # per entry into the endpoint's callback and a second one is the retry.
        self.season_reads = 0

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        self.season_reads += 1
        found = await self._collection.find_one(*args, **kwargs)

        # AFTER the read returns: the rival lands between the season row's read and the write resting on it.
        if self._at == "after_the_first_read":
            await self.run_the_rival()

        return found

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        if self._at == "before_the_write":
            await self.run_the_rival()

        return await self._collection.find_one_and_update(*args, **kwargs)


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_seeded_saison(url: str, body: Body, *, saisons: Sequence[dict[str, Any]] = (), drawn: Sequence[str] = ()) -> Any:
    """A transaction cannot create a collection, so every one a body writes in is built by the seed."""

    async def _run() -> Any:
        # The SHIPPED validators and unique indexes, and every collection -- including the one the
        # action log appends to inside each transaction below.
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            seeded = list(saisons) or [saison_document()]
            await database[Collection.SAISONS].insert_many(seeded)
            for season in seeded:
                await database[Collection.SAISON_TEAMS].insert_many(entry_rows(str(season["_id"])))

            # Through the ROUTE rather than by hand: what a rollover then judges is the Spielplan a
            # drawn season really holds, watermark included.
            for saison_id in drawn:
                await call_draw(database, client, saison_id=saison_id)
                # The draw leaves every matchday undated, and this file's rival write is a rollover
                # onto the drawn season, which `REQ-ACTIVATE-004` would otherwise refuse.
                await database[Collection.SPIELTAGE].update_many(
                    {"saison_id": saison_id}, {"$set": {"beginn": f"{saison_id}-03-01", "ende": f"{saison_id}-03-02"}}
                )

            return await body(database, client)

    return on_the_seed_loop(_run())


async def call_draw(database: AsyncDatabase, client: AsyncMongoClient, saison_id: str = SAISON_ID) -> FLGenerateSpielplanResponse:
    """The shape the season already carries, so the draw moves the fixtures and no rule of its own."""

    return await generate_spielplan(
        saison_id=saison_id,
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        db=client,
        spielplan_data=FLGenerateSpielplanPayload(
            shape=FLSpielplanShape(number_of_groups=GROUPS, teams_per_group=TEAMS_PER_GROUP, qualifiers_per_group=QUALIFIERS)
        ),
        today=TODAY,
        refuse_unconfirmed=FRESH_STEP_UP_CHECK,
    )


async def call_patch_rules(
    database: AsyncDatabase, client: AsyncMongoClient, *, saisons_collection: Any, **overrides: Any
) -> FLPatchSaisonResponse:
    """The whole rules object every time, `rules` being required on the patch, so a case names only the value it moves."""

    return await patch_saison(
        saison_id=SAISON_ID,
        saison_data=FLPatchSaisonPayload(
            start_date=SAISON_START,
            end_date=SAISON_END,
            rules=FLSaisonRules.model_validate(rules_document(**overrides)),
            # Stated rather than omitted: the payload replaces the season wholesale, so neither
            # window carries a default and this helper is about neither of them.
            bewerbung=None,
            registrierung=None,
        ),
        saisons_collection=saisons_collection,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        db=client,
    )


async def call_abandon_a_knockout(database: AsyncDatabase) -> None:
    """The rival write: one drawn knockout fixture is marked abandoned, straight into `spiele`.

    Not through the fixture route: a knockout slot drawn from a `quelle` names no teams yet, so
    there is no result for that route to take.
    """

    fixture = await database[Collection.SPIELE].find_one({"saison_id": SAISON_ID, "saison_phase": {"$in": list(KNOCKOUT_PHASES)}})
    assert fixture is not None, "the draw left this season no knockout fixture to record against"

    await database[Collection.SPIELE].update_one({"_id": fixture["_id"]}, {"$set": {"sonderereignis": "abgebrochen"}})


async def call_roll_the_league_over(database: AsyncDatabase, client: AsyncMongoClient) -> FLActivateSaisonResponse:
    """The rival write: the league rolls over to the other seeded season, which demotes this one to `past`."""

    return await activate_saison(
        saison_id=RIVAL_SAISON_ID,
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        sperrliste_collection=database[Collection.SPERRLISTE],
        db=client,
    )


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


async def statuses_now(database: AsyncDatabase) -> dict[str, str]:
    """Every seeded season, so a rollover that landed names the league it left rather than the target alone."""

    rows = await database[Collection.SAISONS].find({}).to_list(length=None)

    return {str(row["_id"]): str(row["status"]) for row in rows}


class TestAKnockoutResultLandingMidPatchIsJudgedAgain:
    """Two administrators on one season: no knockout fixture holds a record when the patch judges, and one does when it writes.

    The rival writes `spiele`, which the callback only reads: no conflict, no retry; the
    out-of-session re-judgement refuses.
    """

    def test_the_reorder_is_refused_on_the_record_left_under_it(self, mongo_replica_set_url: str):
        """Drop the re-judgement `patch_saison` makes after its transaction and this fails."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_draw(database, client)

            async def abandon_between() -> None:
                await call_abandon_a_knockout(database)

            seasons = SeasonsRunningOneHook(database[Collection.SAISONS], abandon_between, at="before_the_write")

            with pytest.raises(WriteRefusalException) as refusal:
                await call_patch_rules(database, client, saisons_collection=seasons, tiebreak_order=REORDERED_TIEBREAK)

            return refusal.value, seasons.season_reads, await season_now(database), await abandoned_knockouts_now(database)

        refusal, season_reads, stored, abandoned = on_a_seeded_saison(mongo_replica_set_url, body)

        # `REQ-RULES-012` weighs the knockout fixtures holding a record, and there were none when
        # this request first judged: the refusal can only come from the re-judgement after the write.
        assert refusal.error_code == RULES_TIEBREAK_AFTER_KNOCKOUT
        # TWO, and neither is a retry: the judgement's read, then the echo read the write itself
        # makes -- the rival touched `spiele` alone, so nothing conflicted.
        assert season_reads == 2, (
            f"{season_reads} reads where the judgement and the write's echo make two: "
            "one is a rival that landed before the patch judged, a third a conflict this case says cannot happen"
        )

        assert stored["rules"]["tiebreak_order"] == STORED_TIEBREAK, "the reorder landed on top of the rival's record"
        assert abandoned == 1, "the rival's record was lost, so the refusal above had nothing to refuse"


class TestARolloverLandingMidPatchIsJudgedAgain:
    """Two administrators on one season: it is `active` when the patch judges and `past` when it writes.

    The rollover writes `saisons`, so the update conflicts and the callback re-judges -- on `status`,
    which nothing but the season row supplies.
    """

    def test_the_reorder_is_refused_on_the_rollover_that_landed_under_it(self, mongo_replica_set_url: str):
        """Drop `session=` from the season read in `judge_and_write_the_rules` and this fails.

        That read pins the transaction's snapshot; outside the session it opens after the rollover,
        so the update conflicts with nothing and lands.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            promoted: list[FLActivateSaisonResponse] = []

            async def roll_over_between() -> None:
                # Permitted: the incumbent is undrawn and so owes nothing, and the rival is drawn.
                # Demoting the incumbent is what makes the season under test `past`.
                promoted.append(await call_roll_the_league_over(database, client))

            seasons = SeasonsRunningOneHook(database[Collection.SAISONS], roll_over_between, at="after_the_first_read")

            with pytest.raises(WriteRefusalException) as refusal:
                await call_patch_rules(database, client, saisons_collection=seasons, tiebreak_order=REORDERED_TIEBREAK)

            return refusal.value, promoted[0], seasons.season_reads, await season_now(database), await statuses_now(database)

        refusal, promoted, season_reads, stored, statuses = on_a_seeded_saison(
            mongo_replica_set_url,
            body,
            # The incumbent is UNDRAWN, which is what leaves it owing nothing for the rollover to
            # refuse, and leaves `REQ-RULES-011` no fixtures to refuse the reorder on either.
            saisons=[saison_document(status="active"), saison_document(RIVAL_SAISON_ID)],
            drawn=(RIVAL_SAISON_ID,),
        )

        # `REQ-RULES-005` weighs the season's own `status`, and it was `active` when this request
        # first judged: the refusal can only come from a read made after the rollover committed.
        assert refusal.error_code == RULES_SAISON_FINISHED
        assert (promoted.updated_document.id, statuses) == (RIVAL_SAISON_ID, {SAISON_ID: "past", RIVAL_SAISON_ID: "active"})

        # TWO: the judgement's read and the retry's. The write conflicted rather than echoing, and a
        # third would mean the callback was entered once more than this case accounts for.
        assert season_reads == 2, f"{season_reads} reads: {MISCOUNTED_JUDGEMENTS}"

        assert stored["rules"]["tiebreak_order"] == STORED_TIEBREAK, "the reorder landed on a season the rollover had already finished"
