"""The season's routes as a test drives them, and the drawn season the draw's and the undraw's suites seed.

Each route call takes the collection a race case hands it as a stand-in, and the database the rest.
"""

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from itertools import product
from typing import Any

from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.admin_router import activate_saison, delete_spielplan, patch_saison, post_spielplan
from app.api.saisons.schemas import FLGenerateSpielplanPayload, FLPatchSaisonPayload, FLSaisonRules
from app.api.teams.services import offered_gruppen
from app.core.collections import Collection
from app.shared.schemas.responses import FLVersionResponse
from tests import documents
from tests.database import a_clean_database

SAISON_ID = "2026"

# A SECOND season, drawn beside the one under test and never asked to be redrawn or undrawn: what a
# removal that lost its `saison_id` would take with it.
NEIGHBOUR_SAISON_ID = "2025"

# Minted well clear of the subject rows, so only the filter can leave a neighbour standing.
NEIGHBOUR_OID_OFFSET = 100

# Fixed rather than the real day, so the watermark a draw stamps is a value the suite chose.
TODAY = "2026-08-21"

GROUPS = 4
TEAMS_PER_GROUP = 4
QUALIFIERS = 2


async def call_draw(
    database: AsyncDatabase, client: AsyncMongoClient, *, saison_id: str = SAISON_ID, replace: bool = False, today: str = TODAY
) -> None:
    """`POST /saisons/{saison_id}/spielplan`, which draws from the rules the season stores."""

    await post_spielplan(
        saison_id=saison_id,
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
        db=client,
        spielplan_data=FLGenerateSpielplanPayload(replace=replace),
        today=today,
    )


async def call_undraw(database: AsyncDatabase, client: AsyncMongoClient, *, saison_id: str = SAISON_ID) -> None:
    await delete_spielplan(
        saison_id=saison_id,
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
        db=client,
    )


async def call_activate(database: AsyncDatabase, client: AsyncMongoClient, saison_id: str, *, saisons_collection: Any = None) -> None:
    await activate_saison(
        saison_id=saison_id,
        saisons_collection=database[Collection.SAISONS] if saisons_collection is None else saisons_collection,
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        ban_list_collection=database[Collection.BAN_LIST],
        db=client,
    )


async def call_season_save(
    database: AsyncDatabase,
    *,
    saison_id: str,
    start_date: str,
    end_date: str,
    rules: Mapping[str, Any],
    today: str,
    saisons_collection: Any = None,
) -> FLVersionResponse:
    """`PATCH /saisons/{saison_id}` on the version stored now, with neither window: the payload replaces the season whole."""

    return await patch_saison(
        saison_id=saison_id,
        saison_data=FLPatchSaisonPayload(
            start_date=start_date,
            end_date=end_date,
            rules=FLSaisonRules.model_validate(rules),
            # Stated rather than omitted: neither window carries a default, and no caller here is about them.
            bewerbung=None,
            registrierung=None,
            version=(await database[Collection.SAISONS].find_one({"_id": saison_id}, {"version": 1}) or {})["version"],
        ),
        saisons_collection=database[Collection.SAISONS] if saisons_collection is None else saisons_collection,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        db=database.client,
        today=today,
    )


def rules_document(*, groups: int = GROUPS, teams: int = TEAMS_PER_GROUP, qualifiers: int = QUALIFIERS) -> dict[str, Any]:
    return documents.rules_document(qualifiers_per_gruppe=qualifiers, number_of_gruppen=groups, teams_per_gruppe=teams)


def saison_document(
    *, saison_id: str = SAISON_ID, status: str = "future", rules: dict[str, Any] | None = None, spielplan: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Half a year, so `saison_span_below_spielplan` refuses no draw; `spielplan` OMITTED where absent, as an undrawn season holds it."""

    document = documents.saison_document(saison_id, status, start_date="2026-01-01", end_date="2026-06-30", rules=rules or rules_document())

    return document if spielplan is None else {**document, "spielplan": spielplan}


def entry_rows(*, saison_id: str = SAISON_ID, offset: int = 0, groups: int = GROUPS, teams: int = TEAMS_PER_GROUP) -> list[dict[str, Any]]:
    """Every club of a full season as its `saison_teams` row.

    `offset` moves both ObjectId runs along, seeding a second season that shares no row and no club.
    """

    rows: list[dict[str, Any]] = []
    # Interleaved, so entry order and group membership disagree: a draw partitioning by list
    # position pairs clubs that never meet.
    for index, (seat, gruppe) in enumerate(product(range(teams), offered_gruppen(groups))):
        rows.append(
            documents.saison_team_document(
                saison_id,
                ObjectId(f"6890a1b2c3d4e5f6075{index + offset:05d}"),
                f"{gruppe}{seat + 1}-Schule",
                f"{gruppe}S{chr(65 + seat)}",
                _id=ObjectId(f"6890a1b2c3d4e5f6074{index + offset:05d}"),
                gruppe=gruppe,
            )
        )

    return rows


@dataclass(frozen=True)
class Seed:
    """One season as the database holds it before a case's first call, and a second beside it where a case asks for one."""

    saison: dict[str, Any] = field(default_factory=saison_document)
    entered: list[dict[str, Any]] = field(default_factory=entry_rows)
    #: Seeded only by a case about what a removal must NOT reach: a database holding one season
    #: answers the same whether the removal was scoped or took the collection.
    neighbour: dict[str, Any] | None = None
    neighbour_entered: list[dict[str, Any]] = field(default_factory=list)


BESIDE_A_NEIGHBOUR = Seed(
    neighbour=saison_document(saison_id=NEIGHBOUR_SAISON_ID),
    neighbour_entered=entry_rows(saison_id=NEIGHBOUR_SAISON_ID, offset=NEIGHBOUR_OID_OFFSET),
)

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def on_a_seeded_saison(url: str, database_name: str, body: Body, *, seed: Seed | None = None, mutates_schema: bool = False) -> Any:
    """The shipped unique indexes, so a document MongoDB would refuse in production fails here too.

    `mutates_schema=True` where the body installs a validator (`tests/database.py :: a_clean_database`).
    """

    seeded = seed or Seed()

    async with a_clean_database(url, database_name, constraints=True, mutates_schema=mutates_schema) as (client, database):
        await database[Collection.SAISONS].insert_one(seeded.saison)
        await database[Collection.SAISON_TEAMS].insert_many(seeded.entered)

        if seeded.neighbour is not None:
            await database[Collection.SAISONS].insert_one(seeded.neighbour)
            await database[Collection.SAISON_TEAMS].insert_many(seeded.neighbour_entered)

        return await body(database, client)


async def counts_now(database: AsyncDatabase, *, saison_id: str = SAISON_ID) -> tuple[int, int]:
    """One season's matchdays and fixtures, read outside any transaction -- what a later request would see."""

    return (
        await database[Collection.SPIELTAGE].count_documents({"saison_id": saison_id}),
        await database[Collection.SPIELE].count_documents({"saison_id": saison_id}),
    )


async def watermark_now(database: AsyncDatabase, *, saison_id: str = SAISON_ID) -> Any:
    stored = await database[Collection.SAISONS].find_one({"_id": saison_id})

    return (stored or {}).get("spielplan")


def a_confirmation(saison_id: str) -> dict[str, Any]:
    """An open team row of one season's fixture, as the sweep mints it; the fixture itself need not exist for the removal's filter."""

    home = ObjectId()
    spiel = documents.spiel_document(
        spiel_id=ObjectId(),
        saison_id=saison_id,
        spiel_nr=1,
        spieltag_id=ObjectId(),
        team1={"team_id": home, "tore": None},
        team2={"team_id": ObjectId(), "tore": None},
        date="2026-05-01",
        time="18:00:00",
    )

    return documents.spielbestaetigung_document(spiel, party={"kind": "team", "team_id": home})


def a_report(saison_id: str) -> dict[str, Any]:
    """A report document on no fixture, which no count of submitted reports joins: the removal's filter reads the season alone."""

    return documents.spielbericht_document({"_id": ObjectId(), "saison_id": saison_id})


def a_line_up(saison_id: str) -> dict[str, Any]:
    """A line-up on no fixture, naming one pupil: the removal's filter reads the season alone."""

    return documents.aufstellung_document({"_id": ObjectId(), "saison_id": saison_id}, ObjectId(), starters=[ObjectId()])


async def the_season_now(database: AsyncDatabase, *, saison_id: str = SAISON_ID) -> dict[str, Any]:
    """One season's draw, each record naming its fixtures and its watermark, read outside any transaction.

    Each collection counted on its own: a pair compared as one passes while half a neighbour is gone.
    """

    spieltage, spiele = await counts_now(database, saison_id=saison_id)
    named = (Collection.SPIELBESTAETIGUNGEN, Collection.SPIELBERICHTE, Collection.AUFSTELLUNGEN)

    return {
        "spieltage": spieltage,
        "spiele": spiele,
        **{str(name): await database[name].count_documents({"saison_id": saison_id}) for name in named},
        "watermark": await watermark_now(database, saison_id=saison_id),
    }


async def a_record_of_each_kind_on_both_seasons(database: AsyncDatabase) -> None:
    """A confirmation, a report and a line-up on the season under test and on its neighbour."""

    for saison_id in (SAISON_ID, NEIGHBOUR_SAISON_ID):
        await database[Collection.SPIELBESTAETIGUNGEN].insert_one(a_confirmation(saison_id))
        await database[Collection.SPIELBERICHTE].insert_one(a_report(saison_id))
        await database[Collection.AUFSTELLUNGEN].insert_one(a_line_up(saison_id))
