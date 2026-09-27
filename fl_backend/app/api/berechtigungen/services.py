"""
API · the grants' refusals, the one reading of a stored row, and the outbox's rows, apart from the handles they are asked of

Each refusal takes what its caller read inside its own transaction, so a retry after a conflict
judges the list afresh (`docs/backend/spec.md :: I53`).
"""

from collections.abc import Collection, Mapping, Sequence
from datetime import datetime, timedelta
from http import HTTPStatus
from typing import Any, Final

from bson import ObjectId

from app.api.berechtigungen.schemas import FLBerechtigungAenderungArt, FLBerechtigungStand
from app.core.exceptions import WriteRefusal
from app.shared.folding import is_stored_identifier

BERECHTIGUNG_VORHANDEN = "REQ-BERECHTIGUNG-001"

# No route writes an `owner` row, so no route removes one either: the tier exists to be out of the
# reach of an administrator's session (`docs/backend/spec.md` §1.1).
BERECHTIGUNG_INHABER = "REQ-BERECHTIGUNG-002"

BERECHTIGUNG_GESPERRT = "REQ-BERECHTIGUNG-003"

BERECHTIGUNG_MINDESTZAHL = "REQ-BERECHTIGUNG-004"

# 403 and not 409: the refusal is about who asks, and granting the asker `owner` is what lifts it.
BERECHTIGUNG_NUR_INHABER = "REQ-BERECHTIGUNG-005"

BERECHTIGUNG_OHNE_ZUGANG = "REQ-BERECHTIGUNG-006"

# An `owner` grant counts among the two, being a row no route can remove: a floor one `owner` alone
# met would leave nobody to act while that one person is unreachable.
MINDESTZAHL: Final = 2

OWNER: Final = "owner"

# How long a pass holds the rows it claimed. Longer than a pass mails for, so a second pass never
# takes rows the first is still sending; short enough that a pass that died is replaced within two.
BEANSPRUCHUNG_DAUER: Final = timedelta(minutes=10)


def lebendige_adresse(row: Mapping[str, Any]) -> str | None:
    """The address a stored grant admits, or `None` for a dead row, which every reader skips (`docs/backend/spec.md :: I453`).

    Every reader takes this one reading: two readers disagreeing is one mailbox holding two rows.
    """

    adresse = row.get("adresse")

    return adresse if is_stored_identifier(adresse) else None


def lebendige(grants: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    return [grant for grant in grants if lebendige_adresse(grant) is not None]


def verwaltung_des(adresse: str, grants: Sequence[Mapping[str, Any]]) -> str | None:
    """The tier this folded address holds among the live grants, or `None`."""

    return next((str(grant["verwaltung"]) for grant in lebendige(grants) if grant["adresse"] == adresse), None)


def find_vorhanden_refusal(*, adresse: str, grants: Sequence[Mapping[str, Any]]) -> WriteRefusal | None:
    """`REQ-BERECHTIGUNG-001`: a live grant already holds the address, of either tier.

    A dead spelling of it admits nobody and blocks nothing, so the grant is made beside it.
    """

    if verwaltung_des(adresse, grants) is None:
        return None

    return WriteRefusal(
        error_code=BERECHTIGUNG_VORHANDEN,
        status=HTTPStatus.CONFLICT,
        message="this email address already holds access to the administration",
    )


def find_ohne_zugang_refusal(*, akteur: str, grants: Sequence[Mapping[str, Any]]) -> WriteRefusal | None:
    """`REQ-BERECHTIGUNG-006`: the acting administrator's own live grant is gone when the grant is judged.

    The actor check ran before this transaction, and a revoke committing between the two would leave
    the revoked administrator one grant to hand out.
    """

    if verwaltung_des(akteur, grants) is not None:
        return None

    return WriteRefusal(
        error_code=BERECHTIGUNG_OHNE_ZUGANG,
        status=HTTPStatus.FORBIDDEN,
        message="the administrator making this request holds no access to the administration now",
    )


def find_nur_inhaber_refusal(*, akteur: str, grants: Sequence[Mapping[str, Any]]) -> WriteRefusal | None:
    """`REQ-BERECHTIGUNG-005`: only an `owner` revokes, judged on the actor's own live grant inside the transaction.

    So one administrator cannot strip the others down to the floor and then shelter behind it.
    """

    if verwaltung_des(akteur, grants) == OWNER:
        return None

    return WriteRefusal(
        error_code=BERECHTIGUNG_NUR_INHABER,
        status=HTTPStatus.FORBIDDEN,
        message="only an owner revokes access to the administration",
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
    """`REQ-BERECHTIGUNG-004`: a revoke leaves at least `MINDESTZAHL` live, unbarred grants, any `owner` grant among them.

    Counted over the grants that admit somebody: a dead or barred row counted would let the floor
    hold while one person alone could still act.
    """

    if remaining >= MINDESTZAHL:
        return None

    return WriteRefusal(
        error_code=BERECHTIGUNG_MINDESTZAHL,
        status=HTTPStatus.CONFLICT,
        message=f"the administration keeps at least {MINDESTZAHL} people with access; grant another before revoking this one",
    )


def stand_of(row: Mapping[str, Any]) -> FLBerechtigungStand:
    return FLBerechtigungStand(adresse=str(row["adresse"]), verwaltung=row["verwaltung"])


def compare(
    *, grants: Sequence[Mapping[str, Any]], announced: Sequence[Mapping[str, Any]]
) -> list[tuple[Any, FLBerechtigungAenderungArt, FLBerechtigungStand | None, FLBerechtigungStand | None]]:
    """Every live grant whose state differs from the announced record, in id order; a dead row reads as no grant.

    Keyed on the grant's id, never its address, or a revoke and a re-grant cancel out unannounced.
    """

    jetzt = {row["_id"]: stand_of(row) for row in lebendige(grants)}
    vorher = {row["_id"]: stand_of(row) for row in announced}

    changes: list[tuple[Any, FLBerechtigungAenderungArt, FLBerechtigungStand | None, FLBerechtigungStand | None]] = []
    for berechtigung_id in sorted(jetzt.keys() | vorher.keys()):
        now, before = jetzt.get(berechtigung_id), vorher.get(berechtigung_id)
        if before is None:
            changes.append((berechtigung_id, "erteilt", now, None))
        elif now is None:
            changes.append((berechtigung_id, "entzogen", None, before))
        elif now != before:
            changes.append((berechtigung_id, "geaendert", now, before))

    return changes


def withheld(stand: FLBerechtigungStand | None, gesperrt: Collection[str]) -> FLBerechtigungStand | None:
    """`stand` with its address removed where that address is barred (`docs/backend/spec.md :: I452`)."""

    if stand is None or stand.adresse is None or stand.adresse not in gesperrt:
        return stand

    return stand.model_copy(update={"adresse": None})


def compose_postausgang(
    *,
    berechtigung_id: ObjectId,
    art: FLBerechtigungAenderungArt,
    jetzt: FLBerechtigungStand | None,
    vorher: FLBerechtigungStand | None,
    geaendert_von: str | None,
    now: datetime,
    gesperrt: Collection[str],
) -> dict[str, Any]:
    """One outbox row, its addresses withheld where barred as it is written. `geaendert_von` null is a change found in the database."""

    return {
        "berechtigung_id": berechtigung_id,
        "art": art,
        "jetzt": None if (stand := withheld(jetzt, gesperrt)) is None else stand.model_dump(),
        "vorher": None if (stand := withheld(vorher, gesperrt)) is None else stand.model_dump(),
        "geaendert_von": geaendert_von,
        "geaendert_am": None if geaendert_von is None else now,
        "erfasst_am": now,
        "beansprucht_bis": None,
        "beanspruchung": None,
    }


def compose_announced(*, berechtigung_id: ObjectId, stand: FLBerechtigungStand, now: datetime) -> dict[str, Any]:
    return {"_id": berechtigung_id, "adresse": stand.adresse, "verwaltung": stand.verwaltung, "angekuendigt_am": now}
