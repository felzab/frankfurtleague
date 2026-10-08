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

from app.api.berechtigungen.schemas import FLBerechtigungAenderungArt, FLBerechtigungStand, as_utc
from app.api.sperrliste.services import withheld_actor
from app.core.exceptions import WriteRefusal
from app.shared.folding import is_stored_identifier, sign_in_identifier

BERECHTIGUNG_VORHANDEN = "REQ-BERECHTIGUNG-001"

# No route removes an `owner` row: an owner is demoted by another owner, or steps down, before a
# revoke reaches the row, so the tier stays out of an administrator's reach (`docs/backend/spec.md :: I436`).
BERECHTIGUNG_INHABER = "REQ-BERECHTIGUNG-002"

BERECHTIGUNG_GESPERRT = "REQ-BERECHTIGUNG-003"

BERECHTIGUNG_MINDESTZAHL = "REQ-BERECHTIGUNG-004"

# 403 and not 409: the refusal is about who asks, and granting the asker `owner` is what lifts it.
BERECHTIGUNG_NUR_INHABER = "REQ-BERECHTIGUNG-005"

# 409: the grants' state, and promoting another owner first is what lifts it.
BERECHTIGUNG_LETZTER_INHABER = "REQ-BERECHTIGUNG-007"

# An `owner` grant counts among the two, being a row no route can remove: a floor one `owner` alone
# met would leave nobody to act while that one person is unreachable.
MINDESTZAHL: Final = 2

OWNER: Final = "owner"

# How long a pass holds the rows it claimed. Longer than a pass mails for, so a second pass never
# takes rows the first is still sending; short enough that a pass that died is replaced within two.
BEANSPRUCHUNG_DAUER: Final = timedelta(minutes=10)

# The claims that hand a notice out before the next gives it up: at the lease above, four hours
# of passes none of which stamped it. Counted on the row, so a restart resets nothing
# (`docs/backend/spec.md :: I480`).
VERSUCHE_HOECHSTENS: Final = 24


def lebendige_adresse(row: Mapping[str, Any]) -> str | None:
    """The address a stored grant admits, or `None` for a dead row, which every reader skips (`docs/backend/spec.md :: I453`).

    Every reader takes this one reading: two readers disagreeing is one mailbox holding two rows.
    """

    adresse = row.get("adresse")

    return adresse if is_stored_identifier(adresse) else None


def berechtigt_seit(row: Mapping[str, Any], angekuendigt: Mapping[str, Any] | None) -> datetime | None:
    """When a stored grant took effect, the one reading the subject lookup and the actor check share.

    Two readings would let the frontend's guard and this side judge one session against two instants
    (`docs/backend/spec.md :: I525`).
    """

    seit = as_utc(row.get("gefunden_am") or row["erteilt_am"])
    if angekuendigt is None:
        # Seen before and its record gone since: made live from a dead spelling, repointed past the pass
        # that erased its record, or put back whole. Every date it carries, its id's included, is from
        # before that edit (`docs/backend/spec.md :: I529`).
        if row.get("gesehen_am") is not None:
            return None

        # A paste nothing has seen, whose typed date can lie before it: never earlier than the id the
        # Playground generated as it inserted the row, so its holder's first sign-in still admits.
        return max(seit, row["_id"].generation_time)

    # An address changed in place before the comparison found it: nothing dates the change, and the
    # dates the row carries are the address before's.
    return seit if angekuendigt.get("adresse") == row.get("adresse") else None


def inhaber_seit(row: Mapping[str, Any], angekuendigt: Mapping[str, Any] | None) -> datetime | None:
    """When a stored grant's `owner` tier took effect, or `None` where no session holds an owner's power through it.

    A session older than it keeps administering and holds none of an owner's (`docs/backend/spec.md :: I534`).
    """

    seit = berechtigt_seit(row, angekuendigt)
    if seit is None or row.get("verwaltung") != OWNER:
        return None

    # Promoted in the database and not yet found: nothing dates the edit, so no session holds the tier
    # until the comparison stamps `ernannt_am`. A demotion needs no find, taking the power at once.
    if angekuendigt is not None and angekuendigt.get("verwaltung") != OWNER:
        return None

    ernannt_am = row.get("ernannt_am")

    return seit if ernannt_am is None else max(seit, as_utc(ernannt_am))


def signed_in_since(auth_time: int, seit: datetime) -> bool:
    """Whether a sign-in at `auth_time` is no older than `seit`, for a grant's date and an owner's alike.

    Judged to the second `auth_time` is floored to, so nothing the frontend's guard admits is refused
    here (`docs/backend/spec.md :: I526`).
    """

    return auth_time >= int(seit.timestamp())


def gefunden(
    changes: Sequence[tuple[Any, FLBerechtigungAenderungArt, FLBerechtigungStand | None, FLBerechtigungStand | None]],
) -> list[Any]:
    """The grant ids a comparison found granted anew, an address changed in place among them, each of which is stamped `gefunden_am`."""

    return [berechtigung_id for berechtigung_id, art, _, _ in changes if art == "erteilt"]


def ernannt(
    changes: Sequence[tuple[Any, FLBerechtigungAenderungArt, FLBerechtigungStand | None, FLBerechtigungStand | None]],
) -> list[Any]:
    """The grant ids a comparison found promoted to `owner` in place, each of which is stamped `ernannt_am`."""

    return [
        berechtigung_id for berechtigung_id, art, jetzt, _ in changes if art == "geaendert" and jetzt is not None and jetzt.verwaltung == OWNER
    ]


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


def find_nur_inhaber_refusal(
    *, akteur: str, auth_time: int, grants: Sequence[Mapping[str, Any]], announced: Sequence[Mapping[str, Any]]
) -> WriteRefusal | None:
    """`REQ-BERECHTIGUNG-005`: only an `owner`, signed in since becoming one, revokes or changes a tier.

    Judged inside the transaction, so one administrator cannot strip the others down to the floor and
    then shelter behind it, nor make themselves an owner.
    """

    row = next((grant for grant in lebendige(grants) if grant["adresse"] == akteur), None)
    record = None if row is None else next((entry for entry in announced if entry["_id"] == row["_id"]), None)
    seit = None if row is None else inhaber_seit(row, record)
    if seit is not None and signed_in_since(auth_time, seit):
        return None

    return WriteRefusal(
        error_code=BERECHTIGUNG_NUR_INHABER,
        status=HTTPStatus.FORBIDDEN,
        message="only an owner, signed in since becoming one, revokes access to the administration or changes its tier",
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
    """`REQ-BERECHTIGUNG-002`: an `owner` row is revoked by no route; it is demoted first."""

    if grant.get("verwaltung") != OWNER:
        return None

    return WriteRefusal(
        error_code=BERECHTIGUNG_INHABER,
        status=HTTPStatus.CONFLICT,
        message="an owner's access is not revoked; make them an administrator first",
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


def find_letzter_inhaber_refusal(*, remaining_owners: int) -> WriteRefusal | None:
    """`REQ-BERECHTIGUNG-007`: a demotion leaves at least one live, unbarred `owner` (`docs/backend/spec.md :: I479`).

    Counted as the floor of two is: a dead or barred `owner` row admits nobody, so it could demote
    nobody back and grant nothing.
    """

    if remaining_owners >= 1:
        return None

    return WriteRefusal(
        error_code=BERECHTIGUNG_LETZTER_INHABER,
        status=HTTPStatus.CONFLICT,
        message="the administration keeps at least one owner; make another person an owner first",
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
        # Read as one tier change, a repointed address would name its new holder alone and hide whose
        # access ended (`docs/backend/spec.md :: I464`).
        elif now.adresse != before.adresse:
            changes.append((berechtigung_id, "entzogen", None, before))
            changes.append((berechtigung_id, "erteilt", now, None))
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
    """One outbox row, every barred address in it withheld as it is written; `geaendert_von` null is a change found in the database.

    The actor stored folded, the spelling a later ban matches pending rows by (`docs/backend/spec.md :: I462`).
    """

    rows = (withheld(jetzt, gesperrt), withheld(vorher, gesperrt))
    actor = None if geaendert_von is None else sign_in_identifier(geaendert_von)
    stored_actor = withheld_actor(actor, gesperrt)
    withholds = any(stand is not None and stand.adresse is None for stand in rows) or stored_actor != actor

    return {
        "berechtigung_id": berechtigung_id,
        "art": art,
        "urheber": "datenbank" if geaendert_von is None else "anwendung",
        "jetzt": None if rows[0] is None else rows[0].model_dump(),
        "vorher": None if rows[1] is None else rows[1].model_dump(),
        "geaendert_von": stored_actor,
        "geaendert_am": None if geaendert_von is None else now,
        "vorenthalten": "gesperrt" if withholds else None,
        "erfasst_am": now,
        "beansprucht_bis": None,
        "beanspruchung": None,
        "versuche": 0,
    }


def compose_announced(*, berechtigung_id: ObjectId, stand: FLBerechtigungStand, now: datetime) -> dict[str, Any]:
    return {"_id": berechtigung_id, "adresse": stand.adresse, "verwaltung": stand.verwaltung, "angekuendigt_am": now}
