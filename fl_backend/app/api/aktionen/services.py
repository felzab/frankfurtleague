from collections.abc import Collection, Iterable, Mapping
from typing import Any

from app.api.aktionen.schemas import FLAktorAdapter, FLAktorMitAdresse
from app.api.sperrliste.services import withheld_actor
from app.core.crud import build_sort
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import parse_object_id


def akteur_adressen(rows: Iterable[Mapping[str, Any]]) -> list[str]:
    """Every address an actor of these stored rows is named by, folded as the ban list is asked."""

    return [
        sign_in_identifier(actor.email) for row in rows if isinstance(actor := FLAktorAdapter.validate_python(row["actor"]), FLAktorMitAdresse)
    ]


def mit_vorenthaltenem_akteur(row: Mapping[str, Any], gesperrt: Collection[str]) -> dict[str, Any]:
    """A stored row with its actor as both reads serve it (`docs/backend/spec.md :: I452`).

    The stored image is left as recorded: it is what a restore of the write starts from.
    """

    actor = FLAktorAdapter.validate_python(row["actor"])
    if not isinstance(actor, FLAktorMitAdresse):
        return dict(row)

    email = withheld_actor(actor.email, gesperrt)

    return {**row, "actor": {**actor.model_dump(), "email": email, "email_gesperrt": email is None}}


def document_id_term(value: str | None) -> dict[str, Any] | None:
    """One document's history — `aktionen_target`'s first purpose.

    Compiled rather than dumped: a row stores the id as its collection does — an `ObjectId`
    everywhere but `saisons`, whose `_id` is the season string — and text matches no `ObjectId`.
    """

    if value is None:
        return None

    compiled = parse_object_id(value)

    return {"document_id": value if compiled is None else compiled}


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
