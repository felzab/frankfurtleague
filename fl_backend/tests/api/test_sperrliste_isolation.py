"""
API · a ban entered while the league rolls over, or while a second ban of the same address commits

The rollover moves both things a ban is judged on in one transaction, the season it is counted from
and the rows it is checked against. Each case asserts that the outcome equals a SERIAL order of the
pair; anything else is an outcome no serial order gives.
"""

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.api.saisons.admin_router import activate_saison
from app.api.sperrliste.admin_router import post_sperrliste_eintrag
from app.api.sperrliste.schemas import FLPostSperrlistePayload
from app.api.sperrliste.services import SPERRLISTE_ADRESSE_GESPERRT, SPERRLISTE_SCHLUESSEL_VERSION, adresse_hash
from app.core.collections import Collection
from app.core.exceptions import WriteRefusalException
from tests import documents
from tests.config import build_test_config
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_sperrliste_isolation_test")

CONFIG = build_test_config()

TODAY = "2026-04-01"
ADMIN = "admin@frankfurtleague.de"
BANNED = "Zorbanax@Beispielschule.de"
GRUND = "Falsches Geburtsdatum bei der Anmeldung"

RUNNING = "2026"
# The next season, and one six seasons on: activation is not sequential, and a target past the bound
# a ban counted from `RUNNING` carries is one whose sweep would take that ban.
NEXT = "2027"
SKIPPING = "2032"

# The earlier ban names the running season as its last, so any rollover lapses it.
LAPSING_BOUND = "2026"

DUPLICATE = "duplicate key"

TEAM_ID = ObjectId("6890a1b2c3d4e5f607250001")
SPIELTAG_ID = ObjectId("6890a1b2c3d4e5f6072500a1")

Rival = Callable[[], Awaitable[Any]]
Outcome = tuple[str, list[str]]


class SeasonsRunningARivalAfterTheFirstRead:
    """Runs a rival write once, just after the first `find_one`: the ban's reference season, so the rival lands before the list check.

    Not a subclass: the driver builds a collection off a database handle, so every other call delegates.
    """

    def __init__(self, inner: Any, rival: Rival) -> None:
        self._inner = inner
        self._rival: Rival | None = rival

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        found = await self._inner.find_one(*args, **kwargs)

        # ONE-SHOT: a retry of the ban's transaction has to meet what landed rather than run the rival again.
        if self._rival is not None:
            rival, self._rival = self._rival, None
            await rival()

        return found


def saison_document(saison_id: str, status: str) -> dict[str, Any]:
    return documents.saison_document(saison_id, status, rules=documents.rules_document(number_of_groups=2, erlaubte_stufen=["E1"]))


def a_targets_fixture(target: str) -> dict[str, Any]:
    """What makes a target activatable (`REQ-ACTIVATE-003`); no matchday row is seeded, so `-004` has none to count."""

    return documents.spiel_document(
        spiel_id=ObjectId(),
        saison_id=target,
        spiel_nr=1,
        spieltag_id=SPIELTAG_ID,
        team1={"team_id": TEAM_ID, "name": "Alpha", "shorthand": "AL", "tore": None},
    )


def the_lapsing_ban() -> dict[str, Any]:
    return {
        "adresse_hash": adresse_hash(BANNED, schluessel=CONFIG.sperrliste_schluessel),
        "schluessel_version": SPERRLISTE_SCHLUESSEL_VERSION,
        "grund": GRUND,
        "erstellt_von": ADMIN,
        "erstellt_am": "2021-04-01",
        "gesperrt_bis_saison_id": LAPSING_BOUND,
    }


async def ban(database: AsyncDatabase, client: AsyncMongoClient, *, saisons: Any = None) -> str:
    try:
        created = await post_sperrliste_eintrag(
            sperrliste_data=FLPostSperrlistePayload(email=BANNED, grund=GRUND),
            sperrliste_collection=database[Collection.SPERRLISTE],
            saisons_collection=saisons if saisons is not None else database[Collection.SAISONS],
            db=client,
            config=CONFIG,
            erstellt_von=ADMIN,
            today=TODAY,
        )
    except WriteRefusalException as refusal:
        return str(refusal.error_code)
    except DuplicateKeyError:
        return DUPLICATE

    return f"banned through {created.gesperrt_bis_saison_id}"


async def active_and_bounds(database: AsyncDatabase) -> tuple[list[str], list[str]]:
    active = [str(row["_id"]) async for row in database[Collection.SAISONS].find({"status": "active"})]
    bounds = sorted([str(row["gesperrt_bis_saison_id"]) async for row in database[Collection.SPERRLISTE].find()])

    return active, bounds


def on_a_league(url: str, body: Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]], *, target: str, lapsing: bool) -> Any:
    """`RUNNING` active with nothing owed and `target` drawn; `lapsing` seeds the ban any rollover sweeps."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            # Already counted, as a running season is once anything anchored it: `$inc` on a missing
            # field creates it, so an anchor that rewrites nothing would still conflict here without it.
            running = {**saison_document(RUNNING, "active"), "bounded_writes": 3}
            await database[Collection.SAISONS].insert_many([running, saison_document(target, "future")])
            await database[Collection.SPIELE].insert_one(a_targets_fixture(target))
            if lapsing:
                await database[Collection.SPERRLISTE].insert_one(the_lapsing_ban())

            return await body(database, client)

    return on_the_seed_loop(_run())


# Per target and seed, the two serial orders, spelled rather than computed: a case reading the
# arithmetic it exists to pin would follow the code wherever it went.
ACROSS_THE_ROLLOVER: list[tuple[str, bool, Outcome, Outcome]] = [
    (NEXT, True, (SPERRLISTE_ADRESSE_GESPERRT, []), ("banned through 2032", ["2032"])),
    (NEXT, False, ("banned through 2031", ["2031"]), ("banned through 2032", ["2032"])),
    (SKIPPING, True, (SPERRLISTE_ADRESSE_GESPERRT, []), ("banned through 2037", ["2037"])),
    (SKIPPING, False, ("banned through 2031", []), ("banned through 2037", ["2037"])),
]


class TestABanWhoseReferenceSeasonIsReadJustBeforeTheRolloverCommits:
    @pytest.mark.parametrize(
        ("target", "lapsing", "ban_first", "rollover_first"),
        ACROSS_THE_ROLLOVER,
        ids=["next-over-a-lapsing-ban", "next-clean", "skipping-over-a-lapsing-ban", "skipping-clean"],
    )
    def test_the_outcome_is_one_a_serial_order_gives(
        self, mongo_replica_set_url: str, target: str, lapsing: bool, ban_first: Outcome, rollover_first: Outcome
    ):
        """`next-over-a-lapsing-ban` fails on a season read outside the ban's snapshot, `skipping-clean` on no write the two share.

        Under `skipping-clean` the sweep never sees the ban's row, so a bound of 2031 stands while 2032 runs.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, list[str], list[str]]:
            async def roll_over() -> None:
                await activate_saison(
                    saison_id=target,
                    saisons_collection=database[Collection.SAISONS],
                    spiele_collection=database[Collection.SPIELE],
                    spieltage_collection=database[Collection.SPIELTAGE],
                    sperrliste_collection=database[Collection.SPERRLISTE],
                    db=client,
                )

            outcome = await ban(database, client, saisons=SeasonsRunningARivalAfterTheFirstRead(database[Collection.SAISONS], roll_over))

            return outcome, *await active_and_bounds(database)

        outcome, active, bounds = on_a_league(mongo_replica_set_url, body, target=target, lapsing=lapsing)

        # The rollover landed at all, so the interleaving was forced rather than skipped.
        assert active == [target]
        assert (outcome, bounds) in (ban_first, rollover_first)


class TestTwoBansOfOneAddressInsideOneWindow:
    def test_the_second_is_refused_as_already_on_the_list(self, mongo_replica_set_url: str):
        """The rival ban commits after this one has read its season and before it asks the list."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, str, list[str]]:
            results: dict[str, str] = {}

            async def the_rival() -> None:
                results["rival"] = await ban(database, client)

            outcome = await ban(database, client, saisons=SeasonsRunningARivalAfterTheFirstRead(database[Collection.SAISONS], the_rival))
            _, bounds = await active_and_bounds(database)

            return results["rival"], outcome, bounds

        rival, outcome, bounds = on_a_league(mongo_replica_set_url, body, target=NEXT, lapsing=False)

        assert (rival, outcome, bounds) == ("banned through 2031", SPERRLISTE_ADRESSE_GESPERRT, ["2031"])
