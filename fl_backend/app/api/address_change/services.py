"""
API · one address's pending change, as its own record keyed by the address: the record's shape, its steps, its filters and its refusals

Pure: no read and no write. A change belongs to an address, never to one of the records the address holds, so whose
records it moves is read from the address when it takes effect (`app/api/address_change/crud.py :: read_the_holdings`).

Invariants:
- Every instant is stored as a BSON date and compared as one; a filter on one always carries `$type: "date"`, so a null
  never compares.
- Every read of a live change carries `LIVE_TERMS`, the filter `uniq_address_change_address` indexes.
"""

import math
import unicodedata
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from typing import Any, Final, Literal, get_args

from app.core.clock import german_day
from app.core.codes import Code
from app.core.exceptions import APIError, WriteRefusal
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import ADDRESS_CHANGE_VALID_HOURS, ADDRESS_CHANGE_WAITING_PERIOD_DAYS, GRANT_WAIT_HOURS, OWNER_WAIT_DAYS
from app.shared.schemas.custom import as_utc
from app.shared.schemas.literals import FLAddressChangeEndKind, FLAddressChangeWaitsOn, FLAddressChangeWay

ADDRESS_CHANGE_WAYS: Final[tuple[str, ...]] = get_args(FLAddressChangeWay.__value__)

# What the address on file's link shows, one state per step the change waits on, and `release_expired` once the person's own
# change's question to it lapsed: the page never offers a confirmation the press refuses `link_expired`.
FLAddressChangePreviousState = Literal["release_open", "release_expired", "open", "waiting_period"]

# What the new mailbox's link shows while the change stands.
FLAddressChangeNewState = Literal["valid", "expired", "not_confirmable", "confirmed"]

ADDRESS_CHANGE_END_KINDS: Final[tuple[str, ...]] = get_args(FLAddressChangeEndKind.__value__)

# The one filter every read of a live change carries: `uniq_address_change_address` indexes these rows alone.
LIVE_TERMS: Final[Mapping[str, Any]] = {"ended": {"$type": "null"}}

# A `$lookup` joining on the address carries these beside its key, for `build_address_filter`'s reason.
LIVE_KEYED_TERMS: Final[Mapping[str, Any]] = {"address": {"$type": "string"}, **LIVE_TERMS}


def stored_instant(moment: Any) -> datetime | None:
    """A field a stage of the change may leave empty, as `as_utc` marks it; `None` for anything else."""

    return as_utc(moment) if isinstance(moment, datetime) else None


def valid_until_from(now: datetime) -> datetime:
    """When a link mailed at `now` lapses: the new mailbox's, or the address on file's question on the person's own change."""

    return now.astimezone(UTC) + timedelta(hours=ADDRESS_CHANGE_VALID_HOURS)


def wait_after_confirmation(*, way: FLAddressChangeWay, admin_tier: str | None) -> timedelta | None:
    """How long a change waits from the new mailbox's confirmation, `None` where it takes effect at that press.

    The lost-mailbox way and the owner's grant longest, nobody having proved the old mailbox or being able to take the role back; any
    other grant a day, so every holder can read of it. `admin_tier` as the row stores it, a row still waiting included.
    """

    if way == "waiting_period":
        return timedelta(days=ADDRESS_CHANGE_WAITING_PERIOD_DAYS)
    if admin_tier == "owner":
        return timedelta(days=OWNER_WAIT_DAYS)

    return None if admin_tier is None else timedelta(hours=GRANT_WAIT_HOURS)


def compose_record(
    *,
    address: str,
    email: str,
    way: FLAddressChangeWay,
    change_reason: str | None,
    now: datetime,
) -> dict[str, Any]:
    """The WHOLE record a start inserts.

    Both links' arrays empty: each mail's hand-out mints its link into them (`app/api/outbox/system_router.py :: post_handout`).
    """

    return {
        "address": address,
        "email": email,
        "way": way,
        "token_hashes": [],
        "stop": {"token_hashes": []},
        "sent_at": german_day(now),
        "valid_until": valid_until_from(now),
        "released_at": None,
        "change_reason": change_reason,
        "confirmed_at": None,
        "effective_from": None,
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


def compose_confirmation_update(*, wait: timedelta, now: datetime) -> dict[str, Any]:
    """The new mailbox confirmed a change that waits: its deadline goes, and the wait runs from here.

    The token's hash stays, so the link answers what became of the change while its record is kept.
    """

    confirmed_at = now.astimezone(UTC)

    return {"$set": {"valid_until": None, "confirmed_at": confirmed_at, "effective_from": confirmed_at + wait}}


def build_owed_carry_filter(addresses: list[str]) -> dict[str, Any]:
    """The ended changes still owing to carry a sign-in account off one of these folded addresses.

    No index serves it: a carry is owed from an effect until the frontend reports it done, seconds as a rule.
    """

    return {"move.old": {"$in": addresses}}


def compose_end_update(*, kind: FLAddressChangeEndKind, now: datetime) -> dict[str, Any]:
    """An ended change's tombstone: its addresses and its reason go; its hashes stay.

    The hashes let each link answer how the change ended until the TTL removes the record.
    """

    return {
        "$set": {
            "address": None,
            "email": None,
            "change_reason": None,
            "ended": {"kind": kind, "at": now.astimezone(UTC)},
        }
    }


def build_live_filter(address_change_id: Any, terms: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """One live change by its id, matching `terms`. The filter is the judgement: an ended or unknown one is the miss."""

    return {"_id": address_change_id, **LIVE_TERMS, **(terms or {})}


def build_address_filter(address: str) -> dict[str, Any]:
    """The live change of one folded address, which `uniq_address_change_address` answers by equality.

    The key's type stated beside its value: the planner reads an equality as no subset of the index's `$type` term.
    """

    return {"address": {"$eq": address, "$type": "string"}, **LIVE_TERMS}


def build_addresses_filter(addresses: list[str]) -> dict[str, Any]:
    """The live changes of these folded addresses, for `build_address_filter`'s reason."""

    return {"address": {"$in": addresses, "$type": "string"}, **LIVE_TERMS}


def build_incoming_filter(*, email: str, holders: list[str]) -> dict[str, Any]:
    """A live change of one of these folded addresses, moving it to `email`."""

    return {**build_addresses_filter(holders), "email": email}


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
    """A live change whose link's question lapsed at or before `now`; a confirmed change holds no deadline."""

    return {**LIVE_TERMS, "valid_until": {"$type": "date", "$lte": now}}


def build_due_terms(now: datetime) -> dict[str, Any]:
    """A confirmed change whose wait ended at or before `now`: only a confirmation sets `effective_from`."""

    return {**LIVE_TERMS, "effective_from": {"$type": "date", "$lte": now}}


def is_expired(record: Mapping[str, Any], *, now: datetime) -> bool:
    """Whether the link's question a live change waits on has lapsed, judged as `build_lapsed_terms` removes it."""

    valid_until = stored_instant(record.get("valid_until"))

    return valid_until is not None and valid_until <= now


def waits_on(record: Mapping[str, Any]) -> FLAddressChangeWaitsOn:
    if record.get("confirmed_at") is not None:
        return "waiting_period"

    return "previous_address" if asks_the_address_on_file(record) else "new_address"


_PREVIOUS: Final[Mapping[FLAddressChangeWaitsOn, FLAddressChangePreviousState]] = {
    "previous_address": "release_open",
    "new_address": "open",
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


def previous_side_email(record: Mapping[str, Any], *, state: FLAddressChangePreviousState) -> str | None:
    """The new address the address on file's link names, whole on the person's own change, which that address confirms.

    Masked on an administrator's start: it may be a pretext, and whoever holds the old mailbox learns the new one.
    """

    if state == "release_expired":
        return None

    return str(record["email"]) if record["way"] == "account" else masked_address(str(record["email"]))


def new_state(record: Mapping[str, Any], *, now: datetime, not_confirmable: bool) -> FLAddressChangeNewState:
    """What the new mailbox's link shows, in the order the confirmation judges, so a refused press names what a reload shows.

    The unconfirmable causes read alike here; the press's own codes part them, merged only at the edge.
    """

    if record.get("confirmed_at") is not None:
        return "confirmed"

    if is_expired(record, now=now):
        return "expired"

    return "not_confirmable" if not_confirmable else "valid"


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


def find_ended_refusal(*, is_open: bool) -> WriteRefusal | None:
    """`address_change_ended`: the change this link or id names has ended, or this link was answered already."""

    if is_open:
        return None

    return WriteRefusal(
        error_code=Code.ADDRESS_CHANGE_ENDED,
        status=HTTPStatus.CONFLICT,
    )


def find_expired_refusal(*, expired: bool) -> WriteRefusal | None:
    """`link_expired`: the step the change waits on lapsed: either link's question."""

    if not expired:
        return None

    return WriteRefusal(
        error_code=Code.LINK_EXPIRED,
        status=HTTPStatus.GONE,
    )


def find_taken_refusal(*, taken: bool) -> WriteRefusal | None:
    """`address_change_taken`: another pupil signs in on the new address, and one address is one pupil (`uniq_spieler_email`)."""

    if not taken:
        return None

    return WriteRefusal(
        error_code=Code.ADDRESS_CHANGE_TAKEN,
        status=HTTPStatus.CONFLICT,
    )


# One mail every thirty seconds for a person's start, held here rather than at the edge: a server action posts its
# start from any page, so no location nginx meters by its path bounds it.
ADDRESS_CHANGE_RESTART_SECONDS: Final = 30


def find_restart_refusal(*, live_valid_until: Any, now: datetime) -> APIError | None:
    """`address_change_started_recently`, a 429 naming the seconds left in `Retry-After`: the live change owed a mail too lately.

    Read off the live change's `valid_until`, which every mail it owes sets `ADDRESS_CHANGE_VALID_HOURS` ahead, so the
    start is held to one mail per interval whichever press owed the last, and nothing beside the record is stored.
    """

    valid_until = stored_instant(live_valid_until)
    if valid_until is None:
        return None

    owed_at = valid_until - timedelta(hours=ADDRESS_CHANGE_VALID_HOURS)
    left = ADDRESS_CHANGE_RESTART_SECONDS - (now - owed_at).total_seconds()
    if left <= 0:
        return None

    return APIError(HTTPStatus.TOO_MANY_REQUESTS, Code.ADDRESS_CHANGE_STARTED_RECENTLY, headers={"Retry-After": str(math.ceil(left))})


def find_unchanged_refusal(*, address: str, folded: str) -> WriteRefusal | None:
    """`address_change_unchanged`: the typed address signs in as the one on file, so it would ask a mailbox already proved.

    `folded` is the typed address's sign-in identifier, which the caller folds; `address` is one already.
    """

    if folded != address:
        return None

    # Naming neither address: the message reaches the refusal's log line.
    return WriteRefusal(
        error_code=Code.ADDRESS_CHANGE_UNCHANGED,
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


def find_new_taken_refusal(*, taken: bool) -> WriteRefusal | None:
    """`address_change_new_taken`: a re-send's new address has come to be another pupil's or to hold an entry, on a page with no box to mark."""

    if not taken:
        return None

    return WriteRefusal(
        error_code=Code.ADDRESS_CHANGE_NEW_TAKEN,
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
