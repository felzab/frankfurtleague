"""
API · one address's pending change, as its own record keyed by the address: the record's shape, its steps, its filters and its refusals

Pure: no read and no write. A change belongs to an address, never to one of the records the address holds, so whose
records it moves is read from the address when it takes effect (`app/api/address_change/crud.py :: read_the_holdings`).

Invariants:
- Every instant is stored as a BSON date and compared as one; a filter on one always carries `$type: "date"`, so a null
  never compares.
- Every read of a live change carries `LIVE_TERMS`, the filter `uniq_address_change_adresse` indexes.
"""

import unicodedata
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from typing import Any, Final, Literal, get_args

from app.core.clock import german_day
from app.core.codes import Code
from app.core.exceptions import WriteRefusal
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import ADDRESS_CHANGE_VALID_HOURS, ADDRESS_CHANGE_WAITING_PERIOD_DAYS, APPROVAL_DAYS
from app.shared.schemas.literals import FLAddressChangeEndArt, FLAddressChangeWaitsOn, FLAddressChangeWay, FLApprovalDenied

ADDRESS_CHANGE_WAYS: Final[tuple[str, ...]] = get_args(FLAddressChangeWay.__value__)

# What the address on file's link shows, one state per step the change waits on, and `release_expired` once the person's own
# change's question to it lapsed: the page never offers a confirmation the press refuses `link_expired`.
FLAddressChangePreviousState = Literal["release_open", "release_expired", "open", "approval", "waiting_period"]

# What the new mailbox's link shows while the change stands. `approval_expired` is a confirmed change's lapsed
# approval week, never `expired`: that is the link's own deadline, and a confirmed link takes no second answer.
FLAddressChangeNewState = Literal["valid", "expired", "barred", "not_confirmable", "confirmed", "approval_expired"]

ADDRESS_CHANGE_END_KINDS: Final[tuple[str, ...]] = get_args(FLAddressChangeEndArt.__value__)

# The tier of the grant a change moves ranked, and so who may approve it: `owner` another owner alone.
_RANK: Final[Mapping[str, int]] = {"administration": 0, "owner": 1}

# The one filter every read of a live change carries: `uniq_address_change_adresse` indexes these rows alone.
LIVE_TERMS: Final[Mapping[str, Any]] = {"ended": {"$type": "null"}}

# A `$lookup` joining on the address carries these beside its key, for `build_address_filter`'s reason.
LIVE_KEYED_TERMS: Final[Mapping[str, Any]] = {"adresse": {"$type": "string"}, **LIVE_TERMS}


def as_utc(moment: Any) -> datetime | None:
    """A stored instant marked as the UTC it is, the driver reading one back with no offset; `None` for anything else."""

    if not isinstance(moment, datetime):
        return None

    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


def valid_until_from(now: datetime) -> datetime:
    """When a link mailed at `now` lapses: the new mailbox's, or the address on file's question on the person's own change."""

    return now.astimezone(UTC) + timedelta(hours=ADDRESS_CHANGE_VALID_HOURS)


def effective_from_confirmed(confirmed_at: datetime) -> datetime:
    return confirmed_at.astimezone(UTC) + timedelta(days=ADDRESS_CHANGE_WAITING_PERIOD_DAYS)


def compose_approval(*, admin_tier: str, started_by: str, now: datetime) -> dict[str, Any]:
    """The approval a change moving a grant waits on: the tier it moves, who started it, when, and the end of its week."""

    return {
        "admin_tier": admin_tier,
        # Its approver held their grant since then (`app/api/berechtigungen/services.py :: haelt_seit`).
        "asked_at": now.astimezone(UTC),
        "until": now.astimezone(UTC) + timedelta(days=APPROVAL_DAYS),
        # Folded, as `granted_by` stores an administrator: the one compared with the approver.
        "started_by": started_by,
        "approved_at": None,
        "approved_by": None,
    }


def compose_record(
    *,
    adresse: str,
    email: str,
    way: FLAddressChangeWay,
    grund: str | None,
    approval: Mapping[str, Any] | None,
    now: datetime,
) -> dict[str, Any]:
    """The WHOLE record a start inserts, never reused, so a journal line's id names one change.

    Both links' arrays empty: each mail's hand-out mints its link into them (`app/api/outbox/system_router.py :: post_handout`).
    """

    return {
        "adresse": adresse,
        "email": email,
        "way": way,
        "token_hashes": [],
        "stop": {"token_hashes": []},
        "sent_at": german_day(now),
        "valid_until": valid_until_from(now),
        "released_at": None,
        "grund": grund,
        "confirmed_at": None,
        "effective_from": None,
        "approval": None if approval is None else dict(approval),
        "ended": None,
    }


def compose_link_update(*, now: datetime, released: bool) -> dict[str, Any]:
    """A fresh deadline for the new mailbox's link, at the address on file's confirmation or a re-send; its own link stays.

    The link itself is minted as its mail is handed out, replacing the one before (`owe_the_link_in_session`).
    """

    set_fields: dict[str, Any] = {"valid_until": valid_until_from(now), "sent_at": german_day(now)}
    if released:
        set_fields["released_at"] = now.astimezone(UTC)

    return {"$set": set_fields}


def compose_confirmation_update(*, record: Mapping[str, Any], now: datetime) -> dict[str, Any]:
    """The new mailbox confirmed a change not taking effect now: its deadline goes, and a waiting time may start.

    The token's hash stays, so the link answers what became of the change while its record is kept.
    """

    set_fields: dict[str, Any] = {"valid_until": None, "confirmed_at": now.astimezone(UTC)}
    if record.get("way") == "waiting_period":
        set_fields["effective_from"] = effective_from_confirmed(now)

    return {"$set": set_fields}


def compose_approved_update(*, actor: str, now: datetime) -> dict[str, Any]:
    return {"$set": {"approval.approved_at": now.astimezone(UTC), "approval.approved_by": actor}}


def build_owed_carry_filter(adressen: list[str]) -> dict[str, Any]:
    """The ended changes still owing to carry a sign-in account off one of these folded addresses.

    No index serves it: a carry is owed from an effect until the frontend reports it done, seconds as a rule.
    """

    return {"move.old": {"$in": adressen}}


def compose_approval_withdrawn_update() -> dict[str, Any]:
    """An approval that does not stand, taken off: its request's instant and deadline stay, so a new approval is judged as the first."""

    return {"$set": {"approval.approved_at": None, "approval.approved_by": None}}


def compose_end_update(*, art: FLAddressChangeEndArt, now: datetime) -> dict[str, Any]:
    """An ended change's tombstone: its addresses, its reason and its approval go; its hashes stay.

    The hashes let each link answer how the change ended until the TTL removes the record.
    """

    return {
        "$set": {
            "adresse": None,
            "email": None,
            "grund": None,
            "approval": None,
            "ended": {"art": art, "at": now.astimezone(UTC)},
        }
    }


def build_live_filter(address_change_id: Any, terms: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """One live change by its id, matching `terms`. The filter is the judgement: an ended or unknown one is the miss."""

    return {"_id": address_change_id, **LIVE_TERMS, **(terms or {})}


def build_address_filter(adresse: str) -> dict[str, Any]:
    """The live change of one folded address, which `uniq_address_change_adresse` answers by equality.

    The key's type stated beside its value: the planner reads an equality as no subset of the index's `$type` term.
    """

    return {"adresse": {"$eq": adresse, "$type": "string"}, **LIVE_TERMS}


def build_addresses_filter(adressen: list[str]) -> dict[str, Any]:
    """The live changes of these folded addresses, for `build_address_filter`'s reason."""

    return {"adresse": {"$in": adressen, "$type": "string"}, **LIVE_TERMS}


def build_awaiting_approval_filter(adressen: list[str], *, now: datetime) -> dict[str, Any]:
    """The live changes of these folded addresses awaiting their grant's approval, no step lapsed: what the administrators page offers.

    A lapsed one is refused `link_expired`, so the reload that refusal asks for must not offer it.
    """

    return {
        **build_addresses_filter(adressen),
        "approval.approved_at": {"$type": "null"},
        # `is_expired`'s judgement, negated: one lapse rule for the press, the pass and this list.
        "$nor": build_lapsed_terms(now)["$or"],
    }


def build_resendable_terms() -> dict[str, Any]:
    """A change waiting on the new mailbox: the person's own awaiting its address on file, or one confirmed, has no link to re-send."""

    return {"$nor": [{"way": "account", "released_at": None}], "confirmed_at": None}


def asks_the_address_on_file(record: Mapping[str, Any]) -> bool:
    """Whether the person's own change waits on its address on file's confirmation, its first step: the new mailbox is owed nothing yet."""

    return record.get("way") == "account" and record.get("released_at") is None


def build_either_link_filter(token_hash: str) -> dict[str, Any]:
    """The change either of whose links a token is, each clause answered by its own index (`app/core/constraints.py`)."""

    return {"$or": [{"token_hashes": token_hash}, {"stop.token_hashes": token_hash}]}


def side_of(record: Mapping[str, Any], token_hash: str) -> Literal["new", "previous"]:
    """Which link of `record` a token is, read with its `token_hashes`: the new mailbox's, or the one the address on file was mailed."""

    return "new" if token_hash in record.get("token_hashes", ()) else "previous"


def build_previous_link_terms(stop_hash: str) -> dict[str, Any]:
    """The person's own change while it waits on the link the address on file was mailed: answered once, it takes no second."""

    return {"stop.token_hashes": stop_hash, "way": "account", "released_at": None, **LIVE_TERMS}


def build_open_link_terms(token_hash: str) -> dict[str, Any]:
    """The new mailbox's link while the change waits on it: confirmed once, it takes no second answer."""

    return {"token_hashes": token_hash, "confirmed_at": None}


def build_lapsed_terms(now: datetime) -> dict[str, Any]:
    """A live change whose waiting step lapsed at or before `now`: either link's question, or its grant's approval."""

    return {
        **LIVE_TERMS,
        "$or": [
            {"valid_until": {"$type": "date", "$lte": now}},
            {"approval.until": {"$type": "date", "$lte": now}, "approval.approved_at": {"$type": "null"}},
        ],
    }


def build_due_terms(now: datetime) -> dict[str, Any]:
    """A confirmed change with no waiting time left at `now`, an owed approval judged at the effect rather than here.

    A grant ended since the confirmation, by any route, leaves nothing to approve.
    """

    return {
        **LIVE_TERMS,
        "confirmed_at": {"$type": "date"},
        "$or": [{"effective_from": {"$type": "null"}}, {"effective_from": {"$type": "date", "$lte": now}}],
    }


# Where a `$lookup` of the address's grant row lands, the unique index serving it (`uniq_grant_adresse`).
HELD: Final = "_berechtigung"


def build_parked_terms(now: datetime) -> dict[str, Any]:
    """A confirmed change whose approval is owed while its address still holds a grant: waiting, neither due nor lapsed.

    Read over a page `HELD` was joined onto; a lapse of the approval's week is no parking.
    """

    return {
        "confirmed_at": {"$type": "date"},
        "approval.approved_at": {"$type": "null"},
        "approval.until": {"$type": "date", "$gt": now},
        f"{HELD}.0": {"$exists": True},
    }


def is_expired(record: Mapping[str, Any], *, now: datetime) -> bool:
    """Whether the step a live change waits on has lapsed, judged as `build_lapsed_terms` removes it."""

    valid_until = as_utc(record.get("valid_until"))
    if valid_until is not None and valid_until <= now:
        return True

    approval = record.get("approval")
    if not isinstance(approval, Mapping) or approval.get("approved_at") is not None:
        return False
    until = as_utc(approval.get("until"))

    return until is not None and until <= now


def approval_open(record: Mapping[str, Any]) -> bool:
    """Whether the change asks another administrator's approval it has not been given."""

    approval = record.get("approval")

    return isinstance(approval, Mapping) and approval.get("approved_at") is None


def is_due(record: Mapping[str, Any], *, now: datetime) -> bool:
    """Whether a confirmed change has no waiting time left: none was asked, or it ended at or before `now`."""

    effective_from = as_utc(record.get("effective_from"))

    return record.get("confirmed_at") is not None and (effective_from is None or effective_from <= now)


def waits_on(record: Mapping[str, Any]) -> FLAddressChangeWaitsOn:
    if record.get("confirmed_at") is not None:
        # A confirmed change with no waiting time stands only while its grant's approval is owed.
        return "waiting_period" if record.get("effective_from") is not None else "approval"

    return "previous_address" if asks_the_address_on_file(record) else "new_address"


_PREVIOUS: Final[Mapping[FLAddressChangeWaitsOn, FLAddressChangePreviousState]] = {
    "previous_address": "release_open",
    "new_address": "open",
    "approval": "approval",
    "waiting_period": "waiting_period",
}


def previous_state(record: Mapping[str, Any], *, now: datetime) -> FLAddressChangePreviousState:
    """What the address on file's link shows: the step the change waits on, and never whether it could be confirmed.

    `release_expired` where it waits on this link's own answer past its deadline, as the new mailbox's link ranks its lapse; every
    other step's stop is refused nothing, so it shows the step whatever lapsed.
    """

    waits = waits_on(record)
    if waits == "previous_address" and is_expired(record, now=now):
        return "release_expired"

    return _PREVIOUS[waits]


def new_state(record: Mapping[str, Any], *, now: datetime, barred: bool, not_confirmable: bool) -> FLAddressChangeNewState:
    """What the new mailbox's link shows, in the order the confirmation judges, so a refused press names what a reload shows.

    The unconfirmable causes read alike here; the press's own codes part them, merged only at the edge.
    """

    if record.get("confirmed_at") is not None:
        # Never `confirmed` once its approval week lapsed: the pass ends it unapproved, which the page must not deny.
        return "approval_expired" if is_expired(record, now=now) else "confirmed"

    if barred:
        return "barred"

    if is_expired(record, now=now):
        return "expired"

    return "not_confirmable" if not_confirmable else "valid"


def covers(approval: Any, admin_tier: Any) -> bool:
    """Whether a change's approval covers moving a grant of `admin_tier`: asked for that tier or a higher one."""

    return isinstance(approval, Mapping) and _RANK.get(str(approval.get("admin_tier")), -1) >= _RANK.get(str(admin_tier), 2)


def _shown_label(label: str) -> str:
    """One domain label as its reader knows it: decoded from punycode where it decodes, as stored where it does not."""

    if not label.startswith("xn--"):
        return label
    try:
        decoded = label.removeprefix("xn--").encode("ascii").decode("punycode")
    except UnicodeError:
        return label

    # Punycode decodes nonsense into control characters rather than refusing it.
    return label if any(unicodedata.category(character)[0] == "C" for character in decoded) else decoded


def masked_address(email: str) -> str:
    """The pending address a league-started change shows its address on file.

    Three bullets whatever the length; the last label alone, needing no public-suffix list; decoded first, so an
    internationalised domain shows its own letter.
    """

    # Folded and decoded, never judged by the address rule, whose tables move without us: a stored value it came to
    # refuse would answer the account page a 500 (`app/shared/schemas/kontakt.py :: FLKontaktPayload`).
    local, _, domain = sign_in_identifier(email).rpartition("@")
    labels = [_shown_label(label) for label in domain.split(".")]
    shortened = f"{labels[0][:1]}•••" + (f".{labels[-1]}" if len(labels) > 1 else "")

    return f"{local[:1]}•••@{shortened}"


def find_unknown_refusal(*, found: bool) -> WriteRefusal | None:
    """`link_invalid`: the link matches no change, live or kept, and so answers nothing about one."""

    if found:
        return None

    return WriteRefusal(error_code=Code.LINK_INVALID, status=HTTPStatus.NOT_FOUND)


def find_ended_refusal(*, open: bool) -> WriteRefusal | None:
    """`address_change_ended`: the change this link or id names has ended, or this link was answered already."""

    if open:
        return None

    return WriteRefusal(
        error_code=Code.ADDRESS_CHANGE_ENDED,
        status=HTTPStatus.CONFLICT,
    )


def find_expired_refusal(*, expired: bool) -> WriteRefusal | None:
    """`link_expired`: the step the change waits on lapsed -- either link's question, or its grant's approval."""

    if not expired:
        return None

    return WriteRefusal(
        error_code=Code.LINK_EXPIRED,
        status=HTTPStatus.GONE,
    )


def find_confirmation_barred_refusal(*, barred: bool) -> WriteRefusal | None:
    """`link_barred`: the ban list holds the address the link was mailed to, however long ago it was minted."""

    if not barred:
        return None

    return WriteRefusal(
        error_code=Code.LINK_BARRED,
        status=HTTPStatus.FORBIDDEN,
    )


def find_replaced_barred_refusal(*, barred: bool) -> WriteRefusal | None:
    """`address_change_replaced_barred`: the ban list holds the address the change replaces, so moving would carry the ban's person off it."""

    if not barred:
        return None

    return WriteRefusal(
        error_code=Code.ADDRESS_CHANGE_REPLACED_BARRED,
        status=HTTPStatus.CONFLICT,
    )


def find_taken_refusal(*, taken: bool) -> WriteRefusal | None:
    """`address_change_taken`: another pupil signs in on the new address, and one address is one pupil (`uniq_spieler_email`)."""

    if not taken:
        return None

    return WriteRefusal(
        error_code=Code.ADDRESS_CHANGE_TAKEN,
        status=HTTPStatus.CONFLICT,
    )


def find_unchanged_refusal(*, adresse: str, folded: str) -> WriteRefusal | None:
    """`address_change_unchanged`: the typed address signs in as the one on file, so it would ask a mailbox already proved.

    `folded` is the typed address's sign-in identifier, which the caller folds; `adresse` is one already.
    """

    if folded != adresse:
        return None

    # Naming neither address: the message reaches the refusal's log line.
    return WriteRefusal(
        error_code=Code.ADDRESS_CHANGE_UNCHANGED,
        status=HTTPStatus.CONFLICT,
    )


def find_barred_refusal(*, barred: bool) -> WriteRefusal | None:
    """`address_change_barred`: no link an administrator mints goes to an address the ban list holds. Worded for them."""

    if not barred:
        return None

    return WriteRefusal(
        error_code=Code.ADDRESS_CHANGE_BARRED,
        status=HTTPStatus.CONFLICT,
    )


def find_nothing_refusal(*, empty: bool) -> WriteRefusal | None:
    """`address_change_nothing`: the address holds nothing a change moves, so there is nothing to change."""

    if not empty:
        return None

    return WriteRefusal(
        error_code=Code.ADDRESS_CHANGE_NOTHING,
        status=HTTPStatus.CONFLICT,
    )


def find_no_approver_refusal(*, approver: int) -> WriteRefusal | None:
    """`address_change_no_approver`: a change moving a grant waits on an approver nobody could be.

    Neither the changed address nor the change's starter approves, and an owner's grant is approved by another owner alone:
    the last owner makes another first.
    """

    if approver > 0:
        return None

    return WriteRefusal(
        error_code=Code.ADDRESS_CHANGE_NO_APPROVER,
        status=HTTPStatus.CONFLICT,
    )


def find_no_approval_open_refusal(*, open: bool) -> WriteRefusal | None:
    """`address_change_no_approval_open`: the change asks no approval, or was given it already."""

    if open:
        return None

    return WriteRefusal(
        error_code=Code.ADDRESS_CHANGE_NO_APPROVAL_OPEN,
        status=HTTPStatus.CONFLICT,
    )


def find_approval_denied_refusal(*, denied: FLApprovalDenied | None) -> WriteRefusal | None:
    """Why this approver may not approve the change, or `None`.

    `address_change_approval_denied` for the changed address or the starter, `address_change_approval_owner` for an owner's grant
    without an owner's power, `address_change_approval_younger` for an approver whose grant, or owner's tier, took effect after the
    change's start.
    """

    if denied is None:
        return None

    if denied == "younger":
        return WriteRefusal(
            error_code=Code.ADDRESS_CHANGE_APPROVAL_YOUNGER,
            status=HTTPStatus.FORBIDDEN,
        )

    if denied == "owner":
        return WriteRefusal(
            error_code=Code.ADDRESS_CHANGE_APPROVAL_OWNER,
            status=HTTPStatus.FORBIDDEN,
        )

    return WriteRefusal(
        error_code=Code.ADDRESS_CHANGE_APPROVAL_DENIED,
        status=HTTPStatus.FORBIDDEN,
    )


def find_not_covered_refusal(*, covered: bool) -> WriteRefusal | None:
    """`address_change_not_covered`: the address came to hold a grant, or a higher tier, than the change's approval was asked for.

    Moving it would hand access over unapproved, and leaving it would keep it at an address its person has left.
    """

    if covered:
        return None

    return WriteRefusal(
        error_code=Code.ADDRESS_CHANGE_NOT_COVERED,
        status=HTTPStatus.CONFLICT,
    )


def find_occupied_refusal(*, occupied: bool) -> WriteRefusal | None:
    """`address_change_occupied`: an entry names the new address, and moving the person onto it would join two people's.

    Never judged at the person's own start, which would tell its holder which addresses hold entries.
    """

    if not occupied:
        return None

    return WriteRefusal(
        error_code=Code.ADDRESS_CHANGE_OCCUPIED,
        status=HTTPStatus.CONFLICT,
    )


def find_new_granted_refusal(*, granted: bool) -> WriteRefusal | None:
    """`address_change_new_granted`: the new address holds a grant already, and one address holds one grant."""

    if not granted:
        return None

    return WriteRefusal(
        error_code=Code.ADDRESS_CHANGE_NEW_GRANTED,
        status=HTTPStatus.CONFLICT,
    )
