from typing import Any

import pytest
from bson import ObjectId

from app.api.aktionen.admin_router import get_aktionen
from app.api.aktionen.schemas import FLAktionenFilterParams, FLAktionenListResponse
from app.core.collections import Collection
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

# The whole module's reason for a server: the double in `tests/api/test_aktionen_read.py` answers
# cells of the shape the reader reads, so only MongoDB's own `$group` proves the pipeline's keys and
# its accumulator are the names `app/api/aktionen/admin_router.py :: _tally` takes them by.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_aktionen_tally_test")

# Fixed rather than generated, so a failure names the same rows every run.
TARGET_OID = ObjectId("6890a1b2c3d4e5f607930001")
SAISON_ID = "2026"
# One rename's rows across two collections, which is the shape a trace really gathers.
FANOUT_TRACE_ID = "0123456789abcdef0123456789abcdef"

# One area's rows newer than every other's, so a read bounded at the cap serves that area alone and
# every count below is a number no page carries.
PATCHED_TEAMS = LIST_LIMIT_DEFAULT
# The same area under the other operation: without a crossed pair either group key could be dropped,
# or the two swapped, and both maps would still add up.
CREATED_TEAMS = 3
CREATED_VENUES = 5


def log_row(index: int, *, collection: str, operation: str, at: str, document_id: Any, trace_id: str | None = None) -> dict[str, Any]:
    return {
        "_id": ObjectId(f"6890a1b2c3d4e5f607{index:06d}"),
        "at": at,
        "actor": {"kind": "admin_session", "email": "admin@example.invalid"},
        # Distinct per row unless a caller shares one, so a narrowing on a trace selects what it seeded.
        "trace_id": trace_id or f"{index:032x}",
        "request": {"method": "PATCH", "path": "/api/v0/teams/{team_id}"},
        "collection": collection,
        "operation": operation,
        "document_id": document_id,
        "db_filter": None,
        "before": {"name": "Lessing"},
        "modified_count": None,
        "redacted_at": None,
    }


def seeded_log() -> list[dict[str, Any]]:
    """Rebuilt per call: `insert_many` writes `_id` into every mapping it is handed."""

    patched = [
        log_row(
            index,
            collection="teams",
            operation="patch_one",
            at=f"2026-03-{(index % 28) + 1:02d}T09:30:00+00:00",
            document_id=ObjectId(f"6890a1b2c3d4e5f608{index:06d}"),
        )
        for index in range(PATCHED_TEAMS)
    ]
    created = [
        log_row(
            PATCHED_TEAMS + index,
            collection="teams",
            operation="insert",
            at="2025-03-15T09:30:00+00:00",
            document_id=TARGET_OID,
            trace_id=FANOUT_TRACE_ID,
        )
        for index in range(CREATED_TEAMS)
    ]
    venues = [
        log_row(
            PATCHED_TEAMS + CREATED_TEAMS + index,
            collection="spielorte",
            operation="insert",
            at="2025-03-14T09:30:00+00:00",
            document_id=ObjectId(f"6890a1b2c3d4e5f609{index:06d}"),
        )
        for index in range(CREATED_VENUES)
    ]
    # `saisons` is the one collection keyed on a string, and it rides the rename's trace: the compiled
    # term and the fan-out's own count are both read off this row.
    seasons = [
        log_row(
            PATCHED_TEAMS + CREATED_TEAMS + CREATED_VENUES,
            collection="saisons",
            operation="patch_one",
            at="2025-03-13T09:30:00+00:00",
            document_id=SAISON_ID,
            trace_id=FANOUT_TRACE_ID,
        )
    ]

    return patched + created + venues + seasons


# What the log holds, counted from the block sizes above rather than off the corpus: counting the
# seeded list itself would compare one reading of it against another.
EVERY_AREA = {"teams": PATCHED_TEAMS + CREATED_TEAMS, "spielorte": CREATED_VENUES, "saisons": 1}
EVERY_OPERATION = {"patch_one": PATCHED_TEAMS + 1, "insert": CREATED_TEAMS + CREATED_VENUES}


def answered(mongo_url: str, **filters: Any) -> FLAktionenListResponse:
    """The route's own answer over rows a real mongod holds, so the pipeline below it is the shipped one."""

    async def _run() -> FLAktionenListResponse:
        async with a_clean_database(mongo_url, DATABASE_NAME, constraints=True) as (_, database):
            await database[Collection.AKTIONEN].insert_many(seeded_log())

            return await get_aktionen(
                aktionen_collection=database[Collection.AKTIONEN],
                filters=FLAktionenFilterParams.model_validate(filters),
            )

    return on_the_seed_loop(_run())


def test_the_tally_counts_every_area_the_cut_page_never_carries(mongo_url: str):
    """Both maps in full and never a membership: a renamed group key leaves the reader taking a key that is not there.

    The one failure a double answering cells of its own shape can never have.
    """

    log = answered(mongo_url)

    # Non-vacuity: the answer has to be cut and one-area, or a count over the served rows agrees with
    # a count over the log by accident.
    assert len(log.aktionen) == LIST_LIMIT_DEFAULT
    assert log.vollstaendig is False
    assert {row.collection for row in log.aktionen} == {"teams"}
    assert {row.operation for row in log.aktionen} == {"patch_one"}

    assert log.anzahl_je_collection == EVERY_AREA
    assert log.anzahl_je_operation == EVERY_OPERATION


def test_an_areas_count_ignores_its_own_selection_and_keeps_the_other(mongo_url: str):
    """A dimension counted under its own selection offers the picked option and kills every other."""

    log = answered(mongo_url, collection="spielorte")

    assert [row.collection for row in log.aktionen] == ["spielorte"] * CREATED_VENUES
    assert log.vollstaendig is True
    assert log.anzahl_je_collection == EVERY_AREA
    assert log.anzahl_je_operation == {"insert": CREATED_VENUES}


def test_an_operation_selection_narrows_the_areas_it_leaves(mongo_url: str):
    """The crossed pair is what this reaches: `teams` counts its creations alone while its patches stay out."""

    log = answered(mongo_url, operation="insert")

    assert log.anzahl_je_collection == {"teams": CREATED_TEAMS, "spielorte": CREATED_VENUES}
    assert log.anzahl_je_operation == EVERY_OPERATION


def test_a_two_area_selection_reaches_the_read_as_one_term(mongo_url: str):
    """The `$in` against a real collection: the bar is multi-select, and a joined value is the request two picked options make."""

    log = answered(mongo_url, collection="spielorte,saisons")

    assert len(log.aktionen) == CREATED_VENUES + 1
    assert {row.collection for row in log.aktionen} == {"spielorte", "saisons"}
    assert log.anzahl_je_operation == {"insert": CREATED_VENUES, "patch_one": 1}


def test_a_trace_narrows_the_page_and_the_tally_alike(mongo_url: str):
    """`trace_id` is no facet, so it stays in the tally's own filter — and this trace spans both dimensions."""

    log = answered(mongo_url, trace_id=FANOUT_TRACE_ID)

    assert len(log.aktionen) == CREATED_TEAMS + 1
    assert log.anzahl_je_collection == {"teams": CREATED_TEAMS, "saisons": 1}
    assert log.anzahl_je_operation == {"insert": CREATED_TEAMS, "patch_one": 1}


def test_a_document_id_stored_as_an_objectid_selects_its_own_rows(mongo_url: str):
    """`document_id_term` compiles the text to an `ObjectId`, and a stored `ObjectId` matches no text at all."""

    log = answered(mongo_url, document_id=str(TARGET_OID))

    assert [row.document_id for row in log.aktionen] == [str(TARGET_OID)] * CREATED_TEAMS
    assert log.anzahl_je_collection == {"teams": CREATED_TEAMS}
    assert log.anzahl_je_operation == {"insert": CREATED_TEAMS}


def test_a_document_id_stored_as_a_season_string_selects_its_row(mongo_url: str):
    """The other half of the compiled term: `saisons` keys on its season string, which the `ObjectId` spelling would miss."""

    log = answered(mongo_url, document_id=SAISON_ID)

    assert [row.collection for row in log.aktionen] == ["saisons"]
    assert log.anzahl_je_collection == {"saisons": 1}
    assert log.anzahl_je_operation == {"patch_one": 1}
