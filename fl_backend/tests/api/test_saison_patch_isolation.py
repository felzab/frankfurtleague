from itertools import product
from typing import Any, Awaitable, Callable, Sequence

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.admin_router import activate_saison, generate_spielplan, patch_saison
from app.api.saisons.cache import invalidate_saison_cache
from app.api.saisons.schemas import (
    FLActivateSaisonResponse,
    FLGenerateSpielplanPayload,
    FLGenerateSpielplanResponse,
    FLPatchSaisonPayload,
    FLPatchSaisonResponse,
    FLSaisonRules,
    FLSpielplanShape,
)
from app.api.saisons.services import (
    RULES_KADER_BELOW_USE,
    RULES_SAISON_FINISHED,
    RULES_SHAPE_AFTER_DRAW,
    RULES_TIEBREAK_AFTER_KNOCKOUT,
)
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
# The season a rollover promotes, which is the one way the season under test reaches `past`.
RIVAL_SAISON_ID = "2027"

# One block of junction-row ids per season, so two seeded seasons cannot collide on `_id`.
ENTRY_BLOCK = {SAISON_ID: "1", RIVAL_SAISON_ID: "2"}

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


def saison_document(saison_id: str = SAISON_ID, status: str = "future") -> dict[str, Any]:
    """`future` and undrawn by default: the state in which the shape rules are still open to a patch.

    Each season spans its own year's first half, which covers the schedule these rules imply.
    """

    return {
        "_id": saison_id,
        "start_date": f"{saison_id}-01-01",
        "end_date": f"{saison_id}-06-30",
        "status": status,
        "rules": rules_document(),
    }


# The patch resubmits the seeded season's own dates, so no case here is a date edit.
SAISON_START = str(saison_document()["start_date"])
SAISON_END = str(saison_document()["end_date"])


def entry_rows(saison_id: str = SAISON_ID) -> list[dict[str, Any]]:
    """Every offered group filled to `teams_per_group`, which is what `REQ-SPIELPLAN-004` asks of a season about to be drawn."""

    return [
        {
            "_id": ObjectId(f"6890a1b2c3d4e5f60{ENTRY_BLOCK[saison_id]}8{index:05d}"),
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


Hook = Callable[[], Awaitable[Any]]


class SeasonsRunningOneHook:
    """The seasons collection, running one hook once at whichever of two points a case names.

    A stand-in rather than a subclass: the driver builds a collection off a database handle, so the
    endpoint's handle must delegate every other call.
    """

    def __init__(self, inner: Any, *, after_the_first_read: Hook | None = None, before_the_write: Hook | None = None) -> None:
        self._inner = inner
        self._after_the_first_read = after_the_first_read
        self._before_the_write = before_the_write
        # Every `find_one` answered. A REFUSED patch reads no echo back, so there the count is one
        # per entry into the endpoint's callback and a second one is the retry.
        self.season_reads = 0

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        self.season_reads += 1
        found = await self._inner.find_one(*args, **kwargs)

        # AFTER the read returns, and once: the rival lands between the season row's read and the
        # write resting on it, where a second one would land after the retry had judged.
        hook, self._after_the_first_read = self._after_the_first_read, None
        if hook is not None:
            await hook()

        return found

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        # ONE-SHOT: the retry has to re-judge against the draw rather than draw again, and a second
        # draw would be refused on its own account and mask the refusal this proves.
        hook, self._before_the_write = self._before_the_write, None
        if hook is not None:
            await hook()

        return await self._inner.find_one_and_update(*args, **kwargs)


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_seeded_saison(url: str, body: Body, *, saisons: Sequence[dict[str, Any]] = (), drawn: Sequence[str] = ()) -> Any:
    """A transaction cannot create a collection, so every one a body writes in is built by the seed."""

    async def _run() -> Any:
        # The SHIPPED validators and unique indexes, and every collection -- including the one the
        # action log appends to inside each transaction below.
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            # Process-global and keyed by season id, so an entry another module left would answer for this one.
            invalidate_saison_cache()

            seeded = list(saisons) or [saison_document()]
            await database[Collection.SAISONS].insert_many(seeded)
            for season in seeded:
                await database[Collection.SAISON_TEAMS].insert_many(entry_rows(str(season["_id"])))

            # Through the ROUTE rather than by hand: what a rollover then judges is the Spielplan a
            # drawn season really holds, watermark included.
            for saison_id in drawn:
                await call_draw(database, client, saison_id=saison_id)

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


async def call_roll_the_league_over(database: AsyncDatabase, client: AsyncMongoClient) -> FLActivateSaisonResponse:
    """The rival write: the league rolls over to the other seeded season, which demotes this one to `past`."""

    return await activate_saison(
        saison_id=RIVAL_SAISON_ID,
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
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

            seasons = SeasonsRunningOneHook(database[Collection.SAISONS], before_the_write=add_between)

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

            seasons = SeasonsRunningOneHook(database[Collection.SAISONS], before_the_write=draw_between)

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

            seasons = SeasonsRunningOneHook(database[Collection.SAISONS], before_the_write=abandon_between)

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

            seasons = SeasonsRunningOneHook(database[Collection.SAISONS], after_the_first_read=roll_over_between)

            with pytest.raises(DocumentConflictException) as refusal:
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
        assert season_reads == 2, "the callback was entered a third time"

        assert stored["rules"]["tiebreak_order"] == "tordifferenz", "the reorder landed on a season the rollover had already finished"

    def test_the_same_reorder_commits_when_no_rollover_lands(self, mongo_replica_set_url: str):
        """The control: without it the case above would pass on an endpoint that refused every reorder on an `active` season."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await call_patch_rules(database, client, tiebreak_order=REORDERED_TIEBREAK)

            return response, await season_now(database)

        response, stored = on_a_seeded_saison(mongo_replica_set_url, body, saisons=[saison_document(status="active")])

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
