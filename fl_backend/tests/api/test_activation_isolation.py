from collections.abc import Awaitable, Callable, Sequence
from itertools import product
from typing import Any, Literal, cast

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.admin_router import activate_saison, delete_spielplan, patch_saison, post_spielplan
from app.api.saisons.schemas import (
    FLActivateSaisonResponse,
    FLGenerateSpielplanPayload,
    FLPatchSaisonPayload,
    FLPatchSaisonResponse,
    FLSaisonRules,
)
from app.api.spiele.admin_router import patch_spiel
from app.api.spiele.schemas import SONDEREREIGNIS_WITHOUT_A_RESULT, FLPatchSpielDataPayload
from app.api.teams.admin_router import patch_saison_team, patch_team
from app.api.teams.schemas import FLPatchSaisonTeamPayload, FLPatchTeamPayload
from app.api.teams.services import offered_gruppen
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import ADDRESS, rules_document, saison_document, saison_team_document, team_document
from tests.isolation import MISCOUNTED_JUDGEMENTS, InterleavedCollection, Rival, outcome_of
from tests.payloads import spiel_patch_body
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_activation_isolation_test")

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

# The other order a season can rank a group by than the seed's. NOT a shape field, so `rules_shape_after_spielplan`
# passes it on a drawn season and `rules_saison_started` is the only rule left to refuse it.
REORDERED_TIEBREAK = "direkter_vergleich"
SEEDED_TIEBREAK = rules_document()["tiebreak_order"]

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
        # Every `find_one`. A REFUSED write reads no echo back, so there the count is one per entry
        # into the endpoint's callback and a second one is the retry.
        self.season_reads = 0

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        self.season_reads += 1
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
        # The shipped unique indexes, and every collection -- including the one the
        # action log appends to inside each transaction below.
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_many(saisons)
            for saison_id in entered:
                await database[Collection.SAISON_TEAMS].insert_many(entry_rows(saison_id))

            # Through the ROUTE rather than by hand: the fixtures an interference then adds to or
            # removes from are the ones a drawn season really holds, watermark included.
            for saison_id in drawn:
                await call_draw(database, client, saison_id)
                # The draw leaves every matchday undated, so without this `activate_spieltage_undated` would
                # answer every case in this file before the interference it is about could be judged. Inside
                # the season's span, so a patch of its dates is not refused on them.
                await database[Collection.SPIELTAGE].update_many(
                    {"saison_id": saison_id}, {"$set": {"beginn": f"{saison_id}-09-15", "ende": f"{saison_id}-09-16"}}
                )

            for saison_id in finished:
                await database[Collection.SPIELE].update_many({"saison_id": saison_id}, {"$set": {"ergebnis": FINAL_SCORE}})

            return await body(database, client)

    return on_the_seed_loop(_run())


async def call_draw(database: AsyncDatabase, client: AsyncMongoClient, saison_id: str) -> Any:
    """No `shape` on the payload, so the draw runs on the rules the season already carries and moves none of them."""

    return await post_spielplan(
        saison_id=saison_id,
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        db=client,
        spielplan_data=FLGenerateSpielplanPayload(),
        today=TODAY,
    )


async def call_undraw(database: AsyncDatabase, client: AsyncMongoClient, saison_id: str) -> Any:
    return await delete_spielplan(
        saison_id=saison_id,
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        db=client,
    )


async def call_activate(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    saison_id: str,
    *,
    saisons_collection: Any = None,
) -> FLActivateSaisonResponse:
    """`saisons_collection` is overridable so a case can hand the endpoint the hooked stand-in and nothing else."""

    return await activate_saison(
        saison_id=saison_id,
        saisons_collection=saisons_collection if saisons_collection is not None else database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        ban_list_collection=database[Collection.BAN_LIST],
        db=client,
    )


async def rollover_under(database: AsyncDatabase, client: AsyncMongoClient, hook: Callable[[], Awaitable[Any]]) -> tuple[str, int]:
    """`hook` lands between the rollover's judgement and its write.

    Only a refusal is caught: a write conflict reaching the caller is a retry that never happened,
    and must surface as itself rather than a rollover that declined.
    """

    seasons = SeasonsRunningOneHook(database[Collection.SAISONS], hook)

    try:
        await call_activate(database, client, TARGET, saisons_collection=seasons)
        outcome = COMMITTED
    except APIError as refusal:
        outcome = refusal.error_code

    return outcome, seasons.season_reads


async def statuses_now(database: AsyncDatabase) -> dict[str, str]:
    """Read outside any transaction -- what a later request would see."""

    rows = await database[Collection.SAISONS].find({}).to_list(length=None)

    return {row["_id"]: row["status"] for row in rows}


async def unplayed_now(database: AsyncDatabase, saison_id: str) -> int:
    """Fixtures owing a result, spelled as `unplayed_spiel_nrs` reads them: no result, and no cancellation standing in for one."""

    return await database[Collection.SPIELE].count_documents(
        {"saison_id": saison_id, "ergebnis": None, "sonderereignis": {"$nin": list(SONDEREREIGNIS_WITHOUT_A_RESULT)}}
    )


async def fixtures_now(database: AsyncDatabase, saison_id: str) -> int:
    return await database[Collection.SPIELE].count_documents({"saison_id": saison_id})


async def call_patch_rules(
    database: AsyncDatabase, client: AsyncMongoClient, *, saisons_collection: Any, start_date: str | None = None, **overrides: Any
) -> FLPatchSaisonResponse:
    """The target's seeded dates and whole rules every time, `rules` being required on the patch, so a case names only the value it moves."""

    seeded = seeded_saison(TARGET, "future")

    return await patch_saison(
        saison_id=TARGET,
        saison_data=FLPatchSaisonPayload(
            start_date=str(seeded["start_date"]) if start_date is None else start_date,
            end_date=str(seeded["end_date"]),
            rules=FLSaisonRules.model_validate({**seeded["rules"], **overrides}),
            # Stated rather than omitted: the payload replaces the season wholesale, so neither
            # window carries a default and this helper is about neither of them.
            bewerbung=None,
            registrierung=None,
            version=(await database[Collection.SAISONS].find_one({"_id": TARGET}, {"version": 1}) or {})["version"],
        ),
        saisons_collection=saisons_collection,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        db=client,
        today=TODAY,
    )


async def call_enter_a_result(database: AsyncDatabase) -> None:
    """The rival write: one drawn group fixture of the target takes a result, straight into `spiele`, which fixes its start."""

    fixture = await database[Collection.SPIELE].find_one({"saison_id": TARGET, "saison_phase": "gruppenphase"})
    assert fixture is not None, "the draw left the target no group fixture to score"

    await database[Collection.SPIELE].update_one({"_id": fixture["_id"]}, {"$set": {"ergebnis": FINAL_SCORE}})


async def results_entered(database: AsyncDatabase) -> int:
    return await database[Collection.SPIELE].count_documents({"saison_id": TARGET, "ergebnis": FINAL_SCORE})


async def start_now(database: AsyncDatabase) -> str:
    """The target's stored start, read outside any transaction."""

    stored = await database[Collection.SAISONS].find_one({"_id": TARGET})
    assert stored is not None, f"the seed holds no season {TARGET}"

    return str(stored["start_date"])


async def tiebreak_now(database: AsyncDatabase) -> str:
    """The target's stored order, read outside any transaction."""

    stored = await database[Collection.SAISONS].find_one({"_id": TARGET})
    assert stored is not None, f"the seed holds no season {TARGET}"

    return str(stored["rules"]["tiebreak_order"])


class TestADrawLandingMidRolloverIsJudgedAgain:
    """The outgoing season owes nothing when the rollover judges, and a whole Spielplan when it writes.

    A missed judgement is unrecoverable: `saison_past` never promotes a `past` season back.
    """

    def test_the_rollover_is_refused_on_the_fixtures_drawn_under_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def draw_the_outgoing_season() -> None:
                # Permitted while it is `active`: `saison_past` refuses a draw on a `past`
                # season alone, which is exactly why the rollover may not close this one blind.
                await call_draw(database, client, OUTGOING)

            outcome, season_reads = await rollover_under(database, client, draw_the_outgoing_season)

            return outcome, season_reads, await statuses_now(database), await unplayed_now(database, OUTGOING)

        outcome, season_reads, statuses, unplayed = on_a_league(
            mongo_replica_set_url,
            body,
            # The outgoing season is undrawn, which is what makes it read as owing nothing.
            saisons=[seeded_saison(OUTGOING, "active"), seeded_saison(TARGET, "future")],
            entered=(OUTGOING, TARGET),
            drawn=(TARGET,),
        )

        # `activate_saison_unfinished` reads the outgoing season's fixtures, and it held none when this request
        # first judged, so only a second judgement can refuse. The statuses ride along, naming the
        # `past` season a landed rollover left unplayed.
        assert (outcome, statuses) == (Code.ACTIVATE_SAISON_UNFINISHED, {OUTGOING: "active", TARGET: "future"})
        assert season_reads == 2, f"{season_reads} judgements: {MISCOUNTED_JUDGEMENTS}"

        assert unplayed > 0, "the interfering draw left the outgoing season nothing to play, so the rule above had nothing to refuse"


class TestAnUndrawLandingMidRolloverIsJudgedAgain:
    """The target is drawn when the rollover judges and undrawn when it writes, which `activate_target_undrawn` exists to refuse."""

    def test_the_rollover_is_refused_on_the_fixtures_removed_under_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def undraw_the_target() -> None:
                # Permitted on a `future` season with nothing recorded against it, which the target
                # of a rollover is by definition.
                await call_undraw(database, client, TARGET)

            drawn = await fixtures_now(database, TARGET)
            outcome, season_reads = await rollover_under(database, client, undraw_the_target)

            return outcome, season_reads, await statuses_now(database), drawn, await fixtures_now(database, TARGET)

        outcome, season_reads, statuses, drawn, fixtures = on_a_league(
            mongo_replica_set_url,
            body,
            # Nothing holds `active`, so no incumbent can be the reason for the refusal below.
            saisons=[seeded_saison(TARGET, "future")],
            entered=(TARGET,),
            drawn=(TARGET,),
        )

        # Paired as above: a rollover that lands names the league it left going live with nothing to play.
        assert (outcome, statuses) == (Code.ACTIVATE_TARGET_UNDRAWN, {TARGET: "future"})
        assert season_reads == 2, f"{season_reads} judgements: {MISCOUNTED_JUDGEMENTS}"

        # The count's own floor: one reading no fixture would answer none below whatever the undraw did.
        assert drawn > 0
        assert fixtures == 0, "the interfering undraw left the target its fixtures, so the rule above had nothing to refuse"


class TestTwoFirstActivationsRacing:
    """Nothing holds `active`, so neither demotion matches a row and the two write sets are disjoint: only `uniq_saison_active` parts them."""

    def test_the_later_promotion_is_judged_against_the_earlier(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def promote_the_rival() -> None:
                # Permitted: nothing is running, so the rival's rollover has no incumbent to refuse on.
                await call_activate(database, client, RIVAL)

            outcome, season_reads = await rollover_under(database, client, promote_the_rival)

            return outcome, season_reads, await statuses_now(database)

        outcome, season_reads, statuses = on_a_league(
            mongo_replica_set_url,
            body,
            saisons=[seeded_saison(TARGET, "future"), seeded_saison(RIVAL, "future")],
            entered=(TARGET, RIVAL),
            drawn=(TARGET, RIVAL),
        )

        # The index answers the promotion with a write conflict, and the retry finds the rival
        # running with its whole Spielplan still to play. Unindexed, both commit.
        assert (outcome, statuses) == (Code.ACTIVATE_SAISON_UNFINISHED, {TARGET: "future", RIVAL: "active"})
        # A rival promoted before this rollover began refuses it at its first judgement, index or none.
        assert season_reads == 2, (
            f"{season_reads} judgements: one is a rival promoted before this rollover began, a third a retry that conflicted again"
        )


class TestARivalRolloverLandingMidReactivationIsJudgedAgain:
    """The target is the SOLE incumbent, so the rollover re-activates it and the promotion changes no field.

    The promotion still raises the target's version, so the rival's demotion conflicts with it and the
    retry refuses the target as `past`.
    """

    def test_a_reactivated_target_demoted_under_the_rollover_is_refused_as_past(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def promote_the_rival() -> None:
                # Permitted: the one incumbent is played out, so this rollover has nothing of its own
                # to refuse -- and it demotes the target.
                await call_activate(database, client, RIVAL)

            outcome, season_reads = await rollover_under(database, client, promote_the_rival)

            return outcome, season_reads, await statuses_now(database)

        outcome, season_reads, statuses = on_a_league(
            mongo_replica_set_url,
            body,
            # ONE incumbent, and it is the target: nothing else holds `active`, so the demotion matches
            # nothing and the promotion is the no-op this case exists for.
            saisons=[seeded_saison(TARGET, "active"), seeded_saison(RIVAL, "future")],
            entered=(TARGET, RIVAL),
            drawn=(TARGET, RIVAL),
            finished=(TARGET,),
        )

        # Unrefused, the endpoint answers 200 echoing `active` over a database reading `past` -- and
        # `saison_past` never promotes a `past` season back, so the admin acts on a state nobody
        # can restore.
        assert (outcome, statuses) == (Code.SAISON_PAST, {TARGET: "past", RIVAL: "active"})

        # The judgement, then the retry's: the conflicted write reads no echo back, so the retry is what refused.
        assert season_reads == 2, (
            f"{season_reads} season reads where the judgement and the retry's make two: "
            "one is a rival that landed outside the rollover, three an echo of a promotion that committed"
        )


class TestTheRolloverStillCommitsWithNothingInterfering:
    """The control: without it every case above would pass on an endpoint that refused every rollover."""

    def test_the_outgoing_season_is_demoted_and_the_target_promoted(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await call_activate(database, client, TARGET)

            return response, await statuses_now(database)

        response, statuses = on_a_league(
            mongo_replica_set_url,
            body,
            # The same seed the draw case runs on, interference apart.
            saisons=[seeded_saison(OUTGOING, "active"), seeded_saison(TARGET, "future")],
            entered=(OUTGOING, TARGET),
            drawn=(TARGET,),
        )

        assert statuses == {OUTGOING: "past", TARGET: "active"}
        assert response.deactivated == 1

    def test_the_sole_incumbent_is_re_activated_rather_than_refused(self, mongo_replica_set_url: str):
        """The second control, and the one the re-judgement above could break: re-activation is deliberately permitted."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await call_activate(database, client, TARGET)

            return response, await statuses_now(database)

        response, statuses = on_a_league(
            mongo_replica_set_url,
            body,
            saisons=[seeded_saison(TARGET, "active")],
            entered=(TARGET,),
            drawn=(TARGET,),
        )

        assert statuses == {TARGET: "active"}
        # Nothing but the target held `active`, so the rollover demoted nobody.
        assert response.deactivated == 0


class TestAResultLandingMidPatchIsJudgedAgain:
    """Two administrators on one season: nothing has taken place when the patch judges, and a result has when it writes.

    The rival writes `spiele`, which a moved start anchors: the anchor conflicts, and the retry refuses.
    """

    def test_the_moved_start_is_refused_on_the_result_entered_under_it(self, mongo_replica_set_url: str):
        """Drop the fixtures' anchor from `patch_saison` and this fails."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def score_between() -> None:
                await call_enter_a_result(database)

            seasons = SeasonsRunningOneHook(database[Collection.SAISONS], score_between)

            with pytest.raises(APIError) as refusal:
                await call_patch_rules(database, client, saisons_collection=seasons, start_date=MOVED_START)

            return refusal.value, seasons.season_reads, await start_now(database), await results_entered(database)

        refusal, season_reads, start, entered = on_a_league(
            mongo_replica_set_url, body, saisons=[seeded_saison(TARGET, "future")], entered=(TARGET,), drawn=(TARGET,)
        )

        # The draw records nothing, so no fixture had taken place when this request first judged: the
        # refusal can only come from the retry the anchor's conflict forces.
        assert refusal.error_code == Code.SAISON_START_TAKEN_PLACE
        # THREE: the judgement's read, the echo read its write makes, then the retry's judgement, which refuses
        # and so writes and echoes nothing.
        assert season_reads == 3, (
            f"{season_reads} reads where the judgement, its echo and the retry make three: "
            "one is a rival that landed before the patch judged, four a retry that conflicted again"
        )

        assert start == seeded_saison(TARGET, "future")["start_date"], "the start moved on a season the rival had played"
        assert entered == 1, "the rival's result was lost, so the refusal above had nothing to refuse"


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
                promoted.append(await call_activate(database, client, RIVAL))

            seasons = SeasonsRunningOneHook(database[Collection.SAISONS], roll_over_between, at="after_the_first_read")

            with pytest.raises(APIError) as refusal:
                await call_patch_rules(database, client, saisons_collection=seasons, tiebreak_order=REORDERED_TIEBREAK)

            return refusal.value, promoted[0], seasons.season_reads, await tiebreak_now(database), await statuses_now(database)

        refusal, _, season_reads, tiebreak, statuses = on_a_league(
            mongo_replica_set_url,
            body,
            # The incumbent is UNDRAWN, which is what leaves it owing nothing for the rollover to
            # refuse, and leaves `rules_shape_after_spielplan` no fixtures to refuse the reorder on either.
            saisons=[seeded_saison(TARGET, "active"), seeded_saison(RIVAL, "future")],
            entered=(TARGET, RIVAL),
            drawn=(RIVAL,),
        )

        # `rules_saison_started` weighs the season's own `status`, and it was `active` when this request
        # first judged: the refusal can only come from a read made after the rollover committed.
        assert refusal.error_code == Code.RULES_SAISON_STARTED
        assert statuses == {TARGET: "past", RIVAL: "active"}

        # TWO: the judgement's read and the retry's. The write conflicted rather than echoing, and a
        # third would mean the callback was entered once more than this case accounts for.
        assert season_reads == 2, f"{season_reads} reads: {MISCOUNTED_JUDGEMENTS}"

        assert tiebreak == SEEDED_TIEBREAK, "the reorder landed on a season the rollover had already finished"


class TestARolloverLandingMidSaveIsJudgedAgain:
    """A save on the incumbent: `active` when it judges `saison_past`, `past` when it writes.

    Each save only reads the season's status, so its own write meets the rollover only through an anchor: the rollover's
    on the incumbent's fixtures, and the club move's on the season document.
    """

    def test_a_fixture_save_is_refused_on_the_rollover_that_landed_under_it(self, mongo_replica_set_url: str):
        """Drop the outgoing fixtures' anchor from `activate_saison` and this fails."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def roll_over_between() -> None:
                await call_activate(database, client, TARGET)

            fixture = await database[Collection.SPIELE].find_one({"saison_id": OUTGOING, "saison_phase": "gruppenphase"})
            assert fixture is not None, "the draw left the incumbent no group fixture to save"
            seasons = SeasonsRunningOneHook(database[Collection.SAISONS], roll_over_between, at="after_the_first_read")

            outcome = await outcome_of(
                patch_spiel(
                    spiel_id=fixture["_id"],
                    # The no-op save: it writes the fixture all the same, which is what the anchor meets.
                    spiel_data=FLPatchSpielDataPayload.model_validate(spiel_patch_body(fixture)),
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
                )
            )

            return outcome, seasons.season_reads, await statuses_now(database)

        outcome, season_reads, statuses = on_a_league(
            mongo_replica_set_url,
            body,
            saisons=[seeded_saison(OUTGOING, "active"), seeded_saison(TARGET, "future")],
            entered=(OUTGOING, TARGET),
            drawn=(OUTGOING, TARGET),
            # Played out, so the rollover has nothing of its own to refuse.
            finished=(OUTGOING,),
        )

        assert (outcome, statuses) == (Code.SAISON_PAST, {OUTGOING: "past", TARGET: "active"})
        # The judgement's read and the retry's: the save conflicted rather than committing.
        assert season_reads == 2, f"{season_reads} reads: {MISCOUNTED_JUDGEMENTS}"

    def test_a_club_row_save_is_refused_on_the_rollover_that_landed_under_it(self, mongo_replica_set_url: str):
        """Drop the season's anchor from `patch_saison_team` and this fails."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def roll_over_between() -> None:
                await call_activate(database, client, TARGET)

            row = await database[Collection.SAISON_TEAMS].find_one({"saison_id": OUTGOING})
            assert row is not None, "the seed entered no club in the incumbent"
            seasons = SeasonsRunningOneHook(database[Collection.SAISONS], roll_over_between, at="after_the_first_read")

            outcome = await outcome_of(
                patch_saison_team(
                    team_id=row["team_id"],
                    saison_id=OUTGOING,
                    # A colour alone: a group change would meet the drawn fixtures before `saison_past` is the reason.
                    saison_team_data=FLPatchSaisonTeamPayload(gruppe=row["gruppe"], austritt=None, trikot_farbe="schwarz"),
                    saison_teams_collection=database[Collection.SAISON_TEAMS],
                    # The stand-in delegates every call, which the endpoint's collection type cannot say.
                    saisons_collection=cast(Any, seasons),
                    spiele_collection=database[Collection.SPIELE],
                    db=client,
                )
            )

            return outcome, seasons.season_reads, await statuses_now(database)

        outcome, season_reads, statuses = on_a_league(
            mongo_replica_set_url,
            body,
            # The incumbent undrawn, so it owes nothing and the rollover refuses nothing of its own.
            saisons=[seeded_saison(OUTGOING, "active"), seeded_saison(TARGET, "future")],
            entered=(OUTGOING, TARGET),
            drawn=(TARGET,),
        )

        assert (outcome, statuses) == (Code.SAISON_PAST, {OUTGOING: "past", TARGET: "active"})
        assert season_reads == 2, f"{season_reads} reads: {MISCOUNTED_JUDGEMENTS}"


class TeamsRunningOneHook(InterleavedCollection):
    """A `teams` stand-in running one hook once, just after the rename's write to the club returns.

    That write is the transaction's first operation and opens its snapshot, so a rival landing here commits after the
    snapshot and before the rename reads which seasons are still open.
    """

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        written = await self._collection.find_one_and_update(*args, **kwargs)
        await self.run_the_rival()

        return written


RENAMED = "Umbenannt"


class TestARolloverLandingMidRenameIsJudgedAgain:
    """A rename rewrites the club rows of every season it reads as open, and the rollover writes no club row."""

    def test_the_season_closed_under_it_keeps_the_name_it_was_played_under(self, mongo_replica_set_url: str):
        """Drop the open seasons' anchor from `patch_team` and this fails: the incumbent's row is renamed after it closed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            row = await database[Collection.SAISON_TEAMS].find_one({"saison_id": OUTGOING})
            assert row is not None, "the seed entered no club in the incumbent"
            await database[Collection.TEAMS].insert_one(team_document(row["team_id"], row["name"], row["shorthand"]))

            async def roll_over_between() -> None:
                await call_activate(database, client, TARGET)

            teams = TeamsRunningOneHook(database[Collection.TEAMS], roll_over_between)
            await patch_team(
                team_id=row["team_id"],
                team_data=FLPatchTeamPayload.model_validate(
                    {
                        "name": RENAMED,
                        "shorthand": "UMX",
                        "description": "",
                        "full_name": f"{RENAMED}-Schule",
                        "website_url": "https://umbenannt.example.de",
                        "schulform": "gymnasium_g9",
                        "address": dict(ADDRESS),
                    }
                ),
                # The stand-in delegates every call, which the endpoint's collection type cannot say.
                teams_collection=cast(Any, teams),
                spiele_collection=database[Collection.SPIELE],
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                saisons_collection=database[Collection.SAISONS],
                db=client,
            )

            rows = await database[Collection.SAISON_TEAMS].find({"team_id": row["team_id"]}).to_list(length=None)
            return row["name"], {entry["saison_id"]: entry["name"] for entry in rows}, teams.passes, await statuses_now(database)

        played_under, names, passes, statuses = on_a_league(
            mongo_replica_set_url,
            body,
            # The incumbent undrawn, so the club has no fixture there for the rollover's own anchor to meet.
            saisons=[seeded_saison(OUTGOING, "active"), seeded_saison(TARGET, "future")],
            entered=(OUTGOING, TARGET),
            drawn=(TARGET,),
        )

        assert statuses == {OUTGOING: "past", TARGET: "active"}
        assert names == {OUTGOING: played_under, TARGET: RENAMED}
        # The rename's first write and the retry's: the rename conflicted rather than committing on its stale read.
        assert passes == 2, f"{passes} passes: {MISCOUNTED_JUDGEMENTS}"
