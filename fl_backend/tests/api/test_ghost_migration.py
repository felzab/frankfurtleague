"""
API · the one-shot migration that moves an older erasure's rows onto the ghost

Loaded by path rather than imported: the script sits in the ops tree, which is on no interpreter
path this suite sets, and a second copy of the ghost's shape here is the drift the script exists to
avoid. Driven against a real database because every step it takes is a database state.
"""

import importlib.util
import sys
from pathlib import Path
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.core.collections import Collection
from app.core.constraints import COLLECTION_VALIDATORS, UNIQUE_INDEXES, apply_validator
from app.core.sentinels import GHOST_INACTIVE_SINCE, GHOST_SCHIEDSRICHTER_ID
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_ghost_migration_test")

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "scripts" / "ops" / "ghost_schiedsrichter.py"


def _loaded() -> Any:
    """The script as a module. Its own `sys.path` insert is what resolves its `app` imports."""

    spec = importlib.util.spec_from_file_location("fl_ghost_schiedsrichter", SCRIPT)
    assert spec is not None and spec.loader is not None, f"{SCRIPT} could not be loaded"

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    return module


MIGRATION = _loaded()

ERASED_OID = ObjectId("6890a1b2c3d4e5f607900001")
SECOND_ERASED_OID = ObjectId("6890a1b2c3d4e5f607900002")
LIVE_OID = ObjectId("6890a1b2c3d4e5f607900003")

ERASED_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607900011")
SECOND_ERASED_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607900012")
LIVE_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607900013")
UNBOOKED_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607900014")

SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f6079000a1")
SAISON_ID = "2026"

# The field the superseded design stamped, named here as the script names it: no model declares it.
ANONYMISIERT_AM = "anonymisiert_am"

AN_ERASURE_DAY = "2026-03-02"
PAYMENT = 20


def referee_document(schiedsrichter_id: ObjectId, *, name: str | None, erased_on: str | None) -> dict[str, Any]:
    """A row as the SUPERSEDED erasure left it: nulled in place and stamped, or a referee still serving."""

    return {
        "_id": schiedsrichter_id,
        "name": name,
        "schule": None,
        "default_payment": PAYMENT,
        "kontakt": {"telefon": None, "email": None},
        "inactive_since": AN_ERASURE_DAY if erased_on else None,
        ANONYMISIERT_AM: erased_on,
    }


def fixture_document(schiedsrichter_id: ObjectId, spiel_id: ObjectId, spiel_nr: int) -> dict[str, Any]:
    return {
        "_id": spiel_id,
        "spiel_nr": spiel_nr,
        "saison_id": SAISON_ID,
        "saison_phase": "gruppenphase",
        "spieltag_id": SPIELTAG_OID,
        "team1": None,
        "team2": None,
        "team1_quelle": None,
        "team2_quelle": None,
        "datum": "2026-03-15",
        "uhrzeit": "14:00:00",
        "ort": None,
        "schiedsrichter": {"schiedsrichter_id": schiedsrichter_id, "name": None, "payment": PAYMENT},
        "ergebnis": "2:1",
        "elfmeterschiessen": None,
        "sonderereignis": None,
    }


REPOINTED_BOOKING: dict[str, Any] = {"schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID, "name": None, "payment": PAYMENT}

NAME_INDEX = next(index for index in UNIQUE_INDEXES if index.collection == Collection.SCHIEDSRICHTER)


def _the_old_validator() -> dict[str, Any]:
    """The shipped validator with the one field this change removed put back, REQUIRED as it was.

    Derived rather than spelled: a hand-written copy would quietly stop being the validator the
    script meets.
    """

    shipped = COLLECTION_VALIDATORS[Collection.SCHIEDSRICHTER]["$jsonSchema"]

    return {
        "$jsonSchema": {
            **shipped,
            "required": [*shipped["required"], ANONYMISIERT_AM],
            "properties": {**shipped["properties"], ANONYMISIERT_AM: {"bsonType": ["string", "null"]}},
        }
    }


async def _seed(database: AsyncDatabase) -> None:
    """The OLD validator and the OLD narrowed index are put back over the seed.

    Both are why this runs before the boot: that validator REQUIRES the stamp the script removes,
    and the shipped index refuses a second nameless row.
    """

    await apply_validator(database, Collection.SCHIEDSRICHTER, _the_old_validator())

    await database[Collection.SCHIEDSRICHTER].drop_index(NAME_INDEX.name)
    await database[Collection.SCHIEDSRICHTER].create_index(
        [("name", 1)], name=NAME_INDEX.name, unique=True, partialFilterExpression={ANONYMISIERT_AM: None}
    )

    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            referee_document(ERASED_OID, name=None, erased_on=AN_ERASURE_DAY),
            referee_document(SECOND_ERASED_OID, name=None, erased_on="2026-05-04"),
            referee_document(LIVE_OID, name="Bernd Kraus", erased_on=None),
        ]
    )
    await database[Collection.SPIELE].insert_many(
        [
            fixture_document(ERASED_OID, ERASED_SPIEL_OID, 1),
            fixture_document(SECOND_ERASED_OID, SECOND_ERASED_SPIEL_OID, 2),
            {
                **fixture_document(LIVE_OID, LIVE_SPIEL_OID, 3),
                "schiedsrichter": {"schiedsrichter_id": LIVE_OID, "name": "Bernd Kraus", "payment": PAYMENT},
            },
            # The other half of what the superseded erasure left: it took the whole block off a
            # fixture still to be played, so this one names nobody at all.
            {**fixture_document(ERASED_OID, UNBOOKED_SPIEL_OID, 4), "schiedsrichter": None, "ergebnis": None},
        ]
    )


def on_the_old_league(body: Any, url: str) -> Any:
    """`mutates_schema=True`: the seed moves the name index, which the next caller must not inherit."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, mutates_schema=True) as (_, database):
            await _seed(database)

            return await body(database)

    return on_the_seed_loop(_run())


async def stored(database: AsyncDatabase) -> tuple[dict[Any, Any], dict[Any, Any]]:
    referees = {row["_id"]: row async for row in database[Collection.SCHIEDSRICHTER].find()}
    fixtures = {row["_id"]: row async for row in database[Collection.SPIELE].find()}

    return referees, fixtures


def test_a_value_the_driver_cannot_parse_is_reduced_to_its_step_and_its_class():
    """Kills building the client outside the handled region, where the driver's error quotes what it parsed.

    A connection string carries a password, and the dropped `__cause__` keeps it out of a traceback.
    """

    # A scheme the driver does not serve, carrying no credential: this case asserts that the value
    # never reaches the output, so it must not put a real one there.
    unparseable = "ftp://example.test"

    with pytest.raises(MIGRATION.MigrationFailed) as refused:
        on_the_seed_loop(MIGRATION._step("reading MONGODB_URI", MIGRATION._connected(unparseable)))

    assert (refused.value.step, refused.value.reason) == ("reading MONGODB_URI", "InvalidURI")
    assert refused.value.__cause__ is None, "the driver's own error is still reachable through the chain"
    assert unparseable not in str(refused.value)


def test_the_run_builds_its_client_where_that_mapping_reaches_it(monkeypatch, capsys):
    """The case above proves the mapping EXISTS; this proves the run goes through it.

    Driven over the environment, which is the script's own interface.
    """

    unparseable = "ftp://example.test"
    monkeypatch.setenv("MONGODB_URI", unparseable)
    monkeypatch.setenv("DB_BASE_NAME", DATABASE_NAME)

    answered = on_the_seed_loop(MIGRATION._run(check=True))
    printed = capsys.readouterr()

    assert answered == 2
    assert "reading MONGODB_URI" in printed.out
    assert unparseable not in printed.out + printed.err, "the refusal carried the value it was handed"


@pytest.mark.db
def test_the_check_mode_counts_what_is_there_and_writes_nothing(mongo_replica_set_url: str):
    """Run from the new checkout while the old image still serves, so what it reports is the size of what follows."""

    async def body(database: AsyncDatabase) -> Any:
        report = await MIGRATION.migrate(database, check=True)

        return report, await stored(database)

    report, (referees, fixtures) = on_the_old_league(body, mongo_replica_set_url)

    assert (report.erased, report.stale_stamps, report.ghost_stood) == (2, 3, False)
    assert sorted(referees) == sorted([ERASED_OID, SECOND_ERASED_OID, LIVE_OID]), "the check mode wrote to the collection"
    assert fixtures[ERASED_SPIEL_OID]["schiedsrichter"]["schiedsrichter_id"] == ERASED_OID


@pytest.mark.db
def test_the_apply_moves_every_erased_row_onto_the_ghost(mongo_replica_set_url: str):
    """The whole of what the migration is for: the rows go, their fixtures name the ghost, and the referee still serving is untouched."""

    async def body(database: AsyncDatabase) -> Any:
        report = await MIGRATION.migrate(database, check=False)

        return report, await stored(database)

    report, (referees, fixtures) = on_the_old_league(body, mongo_replica_set_url)

    assert sorted(referees) == sorted([GHOST_SCHIEDSRICHTER_ID, LIVE_OID])
    assert referees[GHOST_SCHIEDSRICHTER_ID]["inactive_since"] == GHOST_INACTIVE_SINCE
    assert fixtures[ERASED_SPIEL_OID]["schiedsrichter"] == REPOINTED_BOOKING
    assert fixtures[SECOND_ERASED_SPIEL_OID]["schiedsrichter"] == REPOINTED_BOOKING
    # The control: a migration ignoring its filter would hand the serving referee's fixture away too.
    assert fixtures[LIVE_SPIEL_OID]["schiedsrichter"]["schiedsrichter_id"] == LIVE_OID
    # A fixture the superseded erasure unbooked stays unbooked: this run repoints a reference and
    # never creates one, so the match still reads as needing a referee.
    assert fixtures[UNBOOKED_SPIEL_OID]["schiedsrichter"] is None
    assert (report.repointed, report.erased) == (2, 2)


@pytest.mark.db
def test_the_superseded_stamp_is_cleared_from_the_rows_that_survive(mongo_replica_set_url: str):
    """Every surviving row and not the erased ones alone: the `$unset` is keyed on the field rather than on the ids above it."""

    async def body(database: AsyncDatabase) -> Any:
        await MIGRATION.migrate(database, check=False)

        return await stored(database)

    referees, _ = on_the_old_league(body, mongo_replica_set_url)

    assert ANONYMISIERT_AM not in referees[LIVE_OID]
    assert ANONYMISIERT_AM not in referees[GHOST_SCHIEDSRICHTER_ID]


@pytest.mark.db
def test_a_second_run_changes_nothing(mongo_replica_set_url: str):
    """Kills a run that is not re-runnable: a deploy is repeated after a failure, and the second pass must not write a second ghost or throw."""

    async def body(database: AsyncDatabase) -> Any:
        await MIGRATION.migrate(database, check=False)
        after_one = await stored(database)
        second = await MIGRATION.migrate(database, check=False)

        return after_one, second, await stored(database)

    after_one, second, after_two = on_the_old_league(body, mongo_replica_set_url)

    assert after_one == after_two
    # `index_dropped` false on the second pass, not true: from 8.1 the server answers `ok` for a drop
    # of a name it does not hold, so a report taken from that answer would claim one every run.
    assert (second.erased, second.repointed, second.ghost_stood, second.index_dropped) == (0, 0, True, False)


@pytest.mark.db
def test_the_widened_index_is_dropped_so_the_next_boot_can_build_it(mongo_replica_set_url: str):
    """`create_index` refuses a name already held at different options, so a live partial index left standing is a boot that never serves."""

    async def body(database: AsyncDatabase) -> Any:
        before = NAME_INDEX.name in await database[Collection.SCHIEDSRICHTER].index_information()
        report = await MIGRATION.migrate(database, check=False)

        return before, report, NAME_INDEX.name in await database[Collection.SCHIEDSRICHTER].index_information()

    before, report, after = on_the_old_league(body, mongo_replica_set_url)

    assert before, "the old index was never built, so this case would pass over a drop that does nothing"
    assert (report.narrowed_index_stood, report.index_dropped, after) == (True, True, False)


@pytest.mark.db
def test_a_run_against_an_already_widened_index_leaves_it_standing(mongo_replica_set_url: str):
    """Kills a drop by NAME alone: a re-run after the new image has booted would take the shipped rule out.

    `name` would then be unique against nothing until somebody restarted the service, which nothing
    reports and no later run repairs.
    """

    async def body(database: AsyncDatabase) -> Any:
        schiedsrichter = database[Collection.SCHIEDSRICHTER]

        # The real sequence: the migration runs, the new image boots and builds the widened rule
        # over the one nameless row left -- the ghost -- and only then is the script run again.
        await MIGRATION.migrate(database, check=False)
        await schiedsrichter.create_index([("name", 1)], name=NAME_INDEX.name, unique=True)

        report = await MIGRATION.migrate(database, check=False)
        built = await schiedsrichter.index_information()

        return report, NAME_INDEX.name in built, built.get(NAME_INDEX.name, {}).get("partialFilterExpression")

    report, stands, narrowing = on_the_old_league(body, mongo_replica_set_url)

    assert (report.narrowed_index_stood, report.index_dropped) == (False, False)
    assert stands, "the widened rule the boot built was dropped by a run that had nothing to widen"
    assert narrowing is None


@pytest.mark.db
def test_the_check_mode_leaves_the_index_alone(mongo_replica_set_url: str):
    """The other half of `--check` writing nothing: it reports the narrowing and does not remove it."""

    async def body(database: AsyncDatabase) -> Any:
        report = await MIGRATION.migrate(database, check=True)
        built = await database[Collection.SCHIEDSRICHTER].index_information()

        return report, built.get(NAME_INDEX.name, {}).get("partialFilterExpression")

    report, narrowing = on_the_old_league(body, mongo_replica_set_url)

    assert (report.narrowed_index_stood, report.index_dropped) == (True, False)
    assert narrowing == {ANONYMISIERT_AM: None}


@pytest.mark.db
def test_a_refused_write_names_its_step_and_carries_no_driver_message(mongo_replica_set_url: str):
    """A retry after a boot already built the widened rule over a nameless row: the ghost's own write is then the duplicate.

    The dropped cause is the half `MigrationFailed` exists to keep out of a terminal.
    """

    async def body(database: AsyncDatabase) -> Any:
        schiedsrichter = database[Collection.SCHIEDSRICHTER]
        await schiedsrichter.delete_one({"_id": SECOND_ERASED_OID})
        await schiedsrichter.drop_index(NAME_INDEX.name)
        await schiedsrichter.create_index([("name", 1)], name=NAME_INDEX.name, unique=True)

        try:
            await MIGRATION.migrate(database, check=False)
        except MIGRATION.MigrationFailed as failure:
            return failure.step, failure.reason, failure.__cause__

        return None

    assert on_the_old_league(body, mongo_replica_set_url) == ("writing the ghost", "DuplicateKeyError", None)


@pytest.mark.db
def test_the_ghost_the_migration_writes_holds_the_name_rule_afterwards(mongo_replica_set_url: str):
    """The row the migration leaves has to satisfy the rule the next boot builds, or that boot fails on a duplicate null."""

    async def body(database: AsyncDatabase) -> Any:
        await MIGRATION.migrate(database, check=False)
        await database[Collection.SCHIEDSRICHTER].create_index([("name", 1)], name=NAME_INDEX.name, unique=True)

        try:
            await database[Collection.SCHIEDSRICHTER].insert_one({**referee_document(ObjectId(), name=None, erased_on=None), "_id": ObjectId()})
        except DuplicateKeyError:
            return "refused"
        return "accepted"

    assert on_the_old_league(body, mongo_replica_set_url) == "refused"
