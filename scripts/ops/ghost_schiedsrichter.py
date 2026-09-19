"""
SCRIPTS · move the referees an older erasure anonymised in place onto the ghost

Run once, against the database the new image is about to serve, BEFORE that image boots. Two things
make the order that way round: the validator standing when this runs is the OLD image's, which
REQUIRES the stamp these writes remove, so the new one is attached first; and the boot applies
`uniq_schiedsrichter_name` widened, which `create_index` refuses while the narrowed index of that
name stands, so the drop below is what lets the new backend start at all.

Re-runnable: every step is keyed on a state the previous run leaves behind, so a run that dies
partway is repaired by running it again rather than by repairing rows by hand. Counts are printed
and never a name: the rows this reaches belong to people who asked to be forgotten.

Invariants:
  Reads its settings through `app/core/config.py :: get_config`, and prints no value of any of them.
  --check writes nothing, as `app/core/constraints.py`'s does.
See:
  fl_backend/app/core/sentinels.py
  docs/ops/runbooks.md
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections.abc import Awaitable
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

# The backend package, which holds the one declaration of the ghost. Two candidates because this
# runs both ways: from a checkout, where `fl_backend` sits beside `scripts`, and inside the backend
# image, whose WORKDIR already holds it (`fl_backend/Dockerfile`).
for candidate in (Path(__file__).resolve().parents[2] / "fl_backend", Path.cwd()):
    if (candidate / "app" / "core" / "sentinels.py").is_file():
        sys.path.insert(0, str(candidate))
        break

from app.api.schiedsrichter.services import (  # noqa: E402 -- the insert above is what resolves it
    build_assignment_filter,
    build_ghost_repoint,
    build_ghost_schiedsrichter,
)
from app.core.collections import Collection  # noqa: E402
from app.core.constraints import COLLECTION_VALIDATORS, apply_validator  # noqa: E402
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID  # noqa: E402

# The stamp the superseded erasure wrote. Named here rather than imported: the model that declared
# it is gone, and this script is the last reader of the field.
ANONYMISIERT_AM = "anonymisiert_am"

# Widened by this change, so the live one has to go before the boot rebuilds it
# (`fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`).
WIDENED_INDEX = "uniq_schiedsrichter_name"

INDEX_NOT_FOUND = 27


class MigrationFailed(Exception):
    """The step that refused and the CLASS of what refused it, never the driver's own message.

    For `app/core/db.py :: DatabaseUnreachableError`'s reason: pymongo quotes what it parsed and
    refused, and `from None` keeps that out of a traceback too.
    """

    def __init__(self, step: str, reason: str) -> None:
        super().__init__(f"the migration stopped at {step}: {reason}")
        self.step = step
        self.reason = reason


async def _step[T](step: str, work: Awaitable[T]) -> T:
    """One step of the migration, its failure reduced to the step's name and the exception's class."""

    try:
        return await work
    except Exception as failure:
        raise MigrationFailed(step, type(failure).__name__) from None


@dataclass(frozen=True)
class MigrationReport:
    """Counts alone. A field naming a row would put the people this reaches back into a terminal."""

    erased: int
    stale_stamps: int
    ghost_stood: bool
    #: Whether the NARROWED index stands, which is the only one this drops.
    narrowed_index_stood: bool
    repointed: int = 0
    cleared: int = 0
    index_dropped: bool = False


async def _configured() -> Any:
    """Read through `get_config` and never the environment.

    The documented deploy route MOUNTS the settings file and sets no variable at all
    (`docs/ops/runbooks.md` §2), so a reader of the environment refuses every run made that way.
    """

    # Imported here, not at module scope, as `app/core/constraints.py :: _run` does: that module
    # refuses on import without a complete configuration.
    from app.core.config import EnvironmentValidationError, get_config  # noqa: PLC0415

    try:
        return get_config()
    except EnvironmentValidationError as incomplete:
        # Its message is `app/core/config.py :: _failing_names`' answer -- the failing variables'
        # own names, and no value of any of them.
        raise MigrationFailed("reading the configuration", str(incomplete)) from None


async def _connected(uri: str) -> AsyncMongoClient:
    """The client, built where a parse failure is caught: `AsyncMongoClient.__init__` parses the URI."""

    return AsyncMongoClient(host=uri)


async def _narrowed_index_stands(database: AsyncDatabase) -> bool:
    """Whether the name index stands at its OLD options.

    Read rather than assumed: a re-run after the boot meets the WIDENED index under the same name,
    and dropping that leaves `name` unique against nothing until a restart.
    """

    built = await database[Collection.SCHIEDSRICHTER].index_information()

    return built.get(WIDENED_INDEX, {}).get("partialFilterExpression") is not None


async def _erased_ids(database: AsyncDatabase) -> list[Any]:
    """Every referee an older erasure nulled in place, by id alone."""

    return [row["_id"] async for row in database[Collection.SCHIEDSRICHTER].find({ANONYMISIERT_AM: {"$ne": None}}, {"_id": 1})]


async def _found(database: AsyncDatabase) -> MigrationReport:
    """What stands before anything is written, which is also all `--check` reports."""

    schiedsrichter = database[Collection.SCHIEDSRICHTER]

    return MigrationReport(
        erased=len(await _erased_ids(database)),
        stale_stamps=await schiedsrichter.count_documents({ANONYMISIERT_AM: {"$exists": True}}),
        ghost_stood=await schiedsrichter.find_one({"_id": GHOST_SCHIEDSRICHTER_ID}, {"_id": 1}) is not None,
        narrowed_index_stood=await _narrowed_index_stands(database),
    )


async def migrate(database: AsyncDatabase, *, check: bool) -> MigrationReport:
    """Move every in-place-anonymised referee onto the ghost, then widen the name rule.

    Each step is keyed on a state the previous run leaves, so a run that dies partway is repaired by
    running it again. `check` writes nothing.
    """

    schiedsrichter = database[Collection.SCHIEDSRICHTER]
    spiele = database[Collection.SPIELE]

    found = await _step("reading what is there", _found(database))

    if check:
        return found

    # FIRST, and through the boot's own command: the validator standing here is the old image's,
    # which REQUIRES the stamp every write below removes, at `validationAction: error`. Idempotent,
    # and what the boot would do anyway.
    await _step(
        "attaching the new validator",
        apply_validator(database, Collection.SCHIEDSRICHTER, COLLECTION_VALIDATORS[Collection.SCHIEDSRICHTER]),
    )

    if not found.ghost_stood:
        # `$setOnInsert` rather than an insert: two runs racing would otherwise be a duplicate key,
        # and the `_id` is left out of it, being the filter's own.
        document = {key: value for key, value in build_ghost_schiedsrichter().items() if key != "_id"}
        await _step("writing the ghost", schiedsrichter.update_one({"_id": GHOST_SCHIEDSRICHTER_ID}, {"$setOnInsert": document}, upsert=True))

    # Repointed BEFORE the row goes, and per referee: a run that dies between the two leaves a row
    # whose fixtures are already moved, which the next run finds and deletes.
    repointed = 0
    for schiedsrichter_id in await _step("listing the rows to move", _erased_ids(database)):
        result = await _step("repointing the fixtures", spiele.update_many(build_assignment_filter(schiedsrichter_id), build_ghost_repoint()))
        repointed += result.modified_count
        await _step("deleting the referee", schiedsrichter.delete_one({"_id": schiedsrichter_id}))

    # Last of the three writes: while it stands, the rows above are still held to one name each.
    cleared = await _step(
        "clearing the superseded stamp",
        schiedsrichter.update_many({ANONYMISIERT_AM: {"$exists": True}}, {"$unset": {ANONYMISIERT_AM: ""}}),
    )

    dropped = False
    if found.narrowed_index_stood:
        try:
            await schiedsrichter.drop_index(WIDENED_INDEX)
            dropped = True
        except OperationFailure as failure:
            if failure.code != INDEX_NOT_FOUND:
                raise MigrationFailed("dropping the narrowed index", type(failure).__name__) from None

    return replace(found, repointed=repointed, cleared=cleared.modified_count, index_dropped=dropped)


def _index_line(report: MigrationReport) -> str:
    """What became of the name index, in the operator's own terms."""

    if report.index_dropped:
        return "dropped; the next boot rebuilds it over every row"

    return "left standing, being already widened or already gone"


async def _run(check: bool) -> int:
    client: AsyncMongoClient | None = None

    try:
        config = await _configured()

        # Constructed inside the handled region: the driver parses the URI here rather than at the
        # first command, so a value the settings accepted and the parser refuses would otherwise
        # leave as the driver's own traceback, quoting what it read.
        client = await _step("reading MONGODB_URI", _connected(config.mongodb_uri.get_secret_value()))
        report = await migrate(client[config.db_base_name], check=check)

        print(f"  referees anonymised in place, to be moved onto the ghost: {report.erased}")
        print(f"  rows still carrying the superseded stamp: {report.stale_stamps}")
        print(f"  ghost row present: {'yes' if report.ghost_stood else 'no'}")
        print(f"  {WIDENED_INDEX} narrowed: {'yes' if report.narrowed_index_stood else 'no'}")

        if check:
            print("\n  Nothing was written.\n")
            return 0

        print(f"\n  fixtures repointed at the ghost: {report.repointed}")
        print(f"  referee rows deleted: {report.erased}")
        print(f"  stamps cleared: {report.cleared}")
        print(f"  {WIDENED_INDEX}: {_index_line(report)}")
        print("\n  Done. The new image may boot.\n")

        return 0

    except MigrationFailed as refusal:
        print(f"\n  {refusal}\n")
        return 2

    finally:
        if client is not None:
            await client.close()


def _main() -> int:
    parser = argparse.ArgumentParser(
        prog="python scripts/ops/ghost_schiedsrichter.py",
        description="Move every in-place-anonymised referee onto the ghost and widen the name index.",
    )
    parser.add_argument("--check", action="store_true", help="report what is there; writes nothing")
    parser.add_argument("--apply", action="store_true", help="repoint the fixtures, delete the rows, drop the index")
    arguments = parser.parse_args()

    if arguments.check == arguments.apply:
        parser.error("pass exactly one of --check or --apply")

    return asyncio.run(_run(check=arguments.check))


if __name__ == "__main__":
    raise SystemExit(_main())
