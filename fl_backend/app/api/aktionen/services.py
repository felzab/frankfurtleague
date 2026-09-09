from typing import Any

from bson import ObjectId
from bson.errors import InvalidId

from app.core.crud import build_sort


def document_id_term(value: str | None) -> dict[str, Any] | None:
    """One document's history — `aktionen_target`'s first purpose.

    Compiled rather than dumped: a row stores the id as its collection does — an `ObjectId`
    everywhere but `saisons`, whose `_id` is the season string — and text matches no `ObjectId`.
    """

    if value is None:
        return None

    try:
        compiled = ObjectId(value)
    except InvalidId:
        return {"document_id": value}

    # `bytes.fromhex` skips ASCII whitespace and bson re-checks no length, so a 24-character value
    # holding two builds an eleven-byte id the driver zero-pads on the wire into a different
    # well-formed one. Folded, because bson lower-cases an upper-case id.
    if str(compiled).lower() != value.lower():
        return {"document_id": value}

    return {"document_id": compiled}


def build_aktionen_sort(*, order: str) -> list[tuple[str, int]]:
    """The log page's order. `at` is the only key: every other ordering over a log of writes is a report.

    Named rather than inline so the index test can assert on what the endpoint actually sends
    (`fl_backend/tests/core/test_constraints_execution.py`).
    """

    # `_id` breaks the tie in `order`'s OWN direction, so one transaction's rows read the way the log
    # does and the pair is `aktionen_queue`'s key or its exact inverse. Pinned descending,
    # `order=asc` would match neither and scan the whole log.
    direction = 1 if order == "asc" else -1

    return build_sort(sort_by="at", order=order, chain=(("_id", direction),))
