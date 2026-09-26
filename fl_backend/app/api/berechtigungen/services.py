"""
API · the grants' refusals and the reconciliation's comparison, apart from the handles they are asked of

Each refusal takes what its caller read inside its own transaction, so a retry after a conflict
judges the list afresh (`docs/backend/spec.md :: I53`).
"""

from collections.abc import Mapping, Sequence
from datetime import datetime
from http import HTTPStatus
from typing import Any, Final

from app.api.berechtigungen.schemas import FLBerechtigungAenderungArt, FLBerechtigungAnkuendigung, FLBerechtigungEintrag
from app.core.exceptions import WriteRefusal

BERECHTIGUNG_VORHANDEN = "REQ-BERECHTIGUNG-001"

# No route writes an `owner` row, so no route removes one either: the tier exists to be out of the
# reach of an administrator's session (`docs/backend/spec.md` §1.1).
BERECHTIGUNG_INHABER = "REQ-BERECHTIGUNG-002"

BERECHTIGUNG_GESPERRT = "REQ-BERECHTIGUNG-003"

BERECHTIGUNG_MINDESTZAHL = "REQ-BERECHTIGUNG-004"

# An `owner` grant counts among the two, being a row no route can remove: a floor one `owner` alone
# met would leave nobody to act while that one person is unreachable.
MINDESTZAHL: Final = 2

OWNER: Final = "owner"


def find_vorhanden_refusal(*, adresse: str, grants: Sequence[Mapping[str, Any]]) -> WriteRefusal | None:
    """`REQ-BERECHTIGUNG-001`: the address already holds a grant, of either tier.

    Asked before the index, which would answer the same insert `DB-COMMON-002` with no reason a
    person could act on.
    """

    if all(grant.get("adresse") != adresse for grant in grants):
        return None

    return WriteRefusal(
        error_code=BERECHTIGUNG_VORHANDEN,
        status=HTTPStatus.CONFLICT,
        message="this email address already holds access to the administration",
    )


def find_gesperrt_refusal(*, gesperrt: bool) -> WriteRefusal | None:
    """`REQ-BERECHTIGUNG-003`: the address is on the ban list, which another administrator decided.

    The target's state, so 409: lifting the ban is what changes it.
    """

    if not gesperrt:
        return None

    return WriteRefusal(
        error_code=BERECHTIGUNG_GESPERRT,
        status=HTTPStatus.CONFLICT,
        message="this email address is on the ban list; lift the ban before granting it access to the administration",
    )


def find_inhaber_refusal(*, grant: Mapping[str, Any]) -> WriteRefusal | None:
    """`REQ-BERECHTIGUNG-002`: an `owner` row is changed in the database directly and never here."""

    if grant.get("verwaltung") != OWNER:
        return None

    return WriteRefusal(
        error_code=BERECHTIGUNG_INHABER,
        status=HTTPStatus.CONFLICT,
        message="an owner's access is not changed through the application",
    )


def find_mindestzahl_refusal(*, remaining: int) -> WriteRefusal | None:
    """`REQ-BERECHTIGUNG-004`: a revoke leaves at least `MINDESTZAHL` grants standing, any `owner` grant among them.

    Judged on what would remain rather than on who asks, so an administrator stepping down meets it
    exactly as one revoking a colleague does.
    """

    if remaining >= MINDESTZAHL:
        return None

    return WriteRefusal(
        error_code=BERECHTIGUNG_MINDESTZAHL,
        status=HTTPStatus.CONFLICT,
        message=f"the administration keeps at least {MINDESTZAHL} people with access; grant another before revoking this one",
    )


def eintrag_of(row: Mapping[str, Any]) -> FLBerechtigungEintrag:
    return FLBerechtigungEintrag(adresse=str(row["adresse"]), verwaltung=row["verwaltung"])


def compare(
    *, grants: Sequence[Mapping[str, Any]], announced: Sequence[Mapping[str, Any]]
) -> list[tuple[Any, FLBerechtigungAenderungArt, FLBerechtigungEintrag | None, FLBerechtigungEintrag | None]]:
    """Every grant whose state differs from what was announced, in id order.

    Keyed on the grant's id, never its address: a revoke and a re-grant of one address would
    otherwise cancel out unannounced.
    """

    jetzt = {row["_id"]: eintrag_of(row) for row in grants}
    vorher = {row["_id"]: eintrag_of(row) for row in announced}

    changes: list[tuple[Any, FLBerechtigungAenderungArt, FLBerechtigungEintrag | None, FLBerechtigungEintrag | None]] = []
    for berechtigung_id in sorted(jetzt.keys() | vorher.keys()):
        now, before = jetzt.get(berechtigung_id), vorher.get(berechtigung_id)
        if before is None:
            changes.append((berechtigung_id, "erteilt", now, None))
        elif now is None:
            changes.append((berechtigung_id, "entzogen", None, before))
        elif now != before:
            changes.append((berechtigung_id, "geaendert", now, before))

    return changes


def compose_announced(*, ankuendigungen: Sequence[FLBerechtigungAnkuendigung], now: datetime) -> list[dict[str, Any]]:
    """The announced rows a stamp inserts: one per entry announcing a grant that stands, keyed on the grant's own id.

    A removal inserts nothing, the stamp's delete having taken its row.
    """

    return [
        {"_id": ankuendigung.berechtigung_id, **ankuendigung.jetzt.model_dump(), "angekuendigt_am": now}
        for ankuendigung in ankuendigungen
        if ankuendigung.jetzt is not None
    ]
