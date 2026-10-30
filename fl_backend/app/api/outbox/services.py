"""
API · the Postausgang: every mail the league owes, one row per recipient, written in the transaction of the write owing it

The transactional outbox, its rows drained by polling: the write and its mail commit or fail together, and a drain the
frontend runs hands each row out under a lease of its own, so two drains never hold one row and a drain that dies leaves
its rows to the next once the lease lapses. Delivery is at least once; the provider's idempotency key per hand-out is
what keeps a repeated send of one hand-out from being a second mail in the inbox.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Final

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.outbox.schemas import (
    FLOutboxArt,
    FLOutboxData,
    FLOutboxDeliveryState,
    FLOutboxLink,
    FLOutboxReference,
    FLOutboxResultArt,
    FLOutboxRowState,
)
from app.core.crud import patch_many_in_db, post_many_to_db

# The rows one claim hands out.
SEITE: Final = 10

# How long one claim holds its rows: past a page at its worst, so a drain still sending is never overtaken. The frontend's
# drain runs under no deadline but each call's own bound, so the worst is the claim's answer, then each of `SEITE` sends
# and its report, at `fl_frontend/src/core/api.ts :: FETCH_TIMEOUT_MS` a call and `fl_frontend/src/core/mail.ts ::
# MAIL_TIMEOUT_MS` a send: (1 + 2 x 10) x 15 s, 315 s (`tests/api/test_postausgang_lease.py`). A drain a stopping
# container cuts leaves its rows to the next once this lapses.
LEASE_DURATION: Final = timedelta(minutes=10)

# How long a send that failed waits before a drain may hand it out again: a provider refusing for its own reasons (its
# daily quota, a moment's outage) is not asked again by every drain the next writes start.
REPETITION_AFTER: Final = timedelta(minutes=1)

# How old a mail may grow unsent before it is given up, the one bound on its retries: past the provider's daily quota
# resetting once, so a busy day delays a mail rather than losing it. A sign-in mail's bound is its secret's lapse.
ZUSTELLFRIST: Final = timedelta(days=2)

# A finished row's retention, matching the provider's own, so the delivery state lives as long as the message it is about.
RETENTION: Final = timedelta(days=30)

# The sign-in library's kinds, each tried once: its own repair of a failed code is a fresh one.
SIGN_IN_ARTEN: Final[frozenset[FLOutboxArt]] = frozenset({"sign_in_code", "passkey_hinzugefuegt", "passkey_erased", "account_erasure"})

# The one kind of mail a ban does not stop: the ban's own notice.
UNGESPERRT: Final[frozenset[FLOutboxArt]] = frozenset({"sperre"})

# The final state each reported outcome settles a row in; a send to be tried again ends there only where it may not be.
FINAL_STATE: Final[Mapping[FLOutboxResultArt, FLOutboxRowState]] = {
    "sent": "sent",
    "held": "held",
    "abandon": "abandoned",
    "retry": "abandoned",
}

# Each delivery state, and the states a row may hold for an event to move it there: never back from a later one, the
# provider sending events in any order.
FOLGT_AUF: Final[Mapping[FLOutboxDeliveryState, tuple[FLOutboxDeliveryState | None, ...]]] = {
    "delayed": (None,),
    "delivered": (None, "delayed"),
    "undeliverable": (None, "delayed"),
    "suppressed": (None, "delayed"),
    "complaint": (None, "delayed", "delivered"),
}


@dataclass(frozen=True)
class OwedMail:
    """One mail a league write owes one recipient.

    `data` is the kind's member of `app/api/outbox/schemas.py :: FLOutboxData`, whose `art` is the row's.
    `key` is the mail's identity: the same on a replay of the write, so the replay finds the row its first run
    wrote and owes nothing twice, and distinct for every recipient and every mail the write owes. `link` mints a link at
    the hand-out on the record `reference` names.
    """

    key: str
    an: str
    data: FLOutboxData
    reference: FLOutboxReference | None = None
    link: FLOutboxLink | None = None


async def enqueue_mails(
    *,
    outbox_collection: AsyncCollection,
    session: AsyncClientSession,
    mails: Sequence[OwedMail],
    now: datetime,
) -> None:
    """Owe every mail one write owes, inside its transaction, in two commands however many: one read of the keys, one insert.

    A key already stored is a replay's, and owes nothing again. The keys must be distinct. A mail whose link supersedes
    the record's earlier ones drops every other open mail about its record and seat that would supersede them too, one
    command more: handed out after it, such a mail would replace its link with an older one.
    """

    if not mails:
        return
    if len({mail.key for mail in mails}) != len(mails):
        raise ValueError("every mail one write owes carries a key of its own")

    # A first run committed before this snapshot is found; one committed after it makes the insert a write conflict the
    # caller's `with_transaction` retries, which then finds it.
    stored = await outbox_collection.find({"key": {"$in": [mail.key for mail in mails]}}, {"key": 1, "_id": 0}, session=session).to_list(
        length=None
    )
    owed = {row["key"] for row in stored}
    new = [mail for mail in mails if mail.key not in owed]
    if not new:
        return

    await post_many_to_db(
        collection=outbox_collection, documents=[row_of(mail, now=now, secret=None, valid_until=None) for mail in new], session=session
    )

    # Equality on the three keys of `outbox_reference` for each record and seat (`app/core/constraints.py :: SUPPORT_INDEXES`).
    replaced = [
        {"reference.collection": str(mail.reference.collection), "reference.id": mail.reference.id, "reference.seat": mail.reference.seat}
        for mail in new
        if mail.reference is not None and mail.link is not None and mail.link.replaced
    ]
    if replaced:
        await patch_many_in_db(
            collection=outbox_collection,
            db_filter={"$or": replaced, "state": "open", "link.replaced": True, "key": {"$nin": [mail.key for mail in new]}},
            update=final_update("dropped", now=now),
            session=session,
        )


def row_of(mail: OwedMail, *, now: datetime, secret: str | None, valid_until: datetime | None) -> dict[str, Any]:
    """One owed mail's row as `outbox` stores it. `secret` lapses with `valid_until`, the row's deadline and its deletion both."""

    if secret is not None and valid_until is None:
        raise ValueError("a secret is held until it lapses, and this one names no lapse")
    if mail.link is not None and mail.reference is None:
        raise ValueError("a link is minted on the record a mail is about, and this mail names none")

    frist = valid_until if valid_until is not None else now + ZUSTELLFRIST
    reference = mail.reference

    return {
        "key": mail.key,
        "art": mail.data.art,
        "an": mail.an,
        # JSON, so an instant keeps its offset and reads back as the aware value its member requires.
        "data": mail.data.model_dump(mode="json"),
        "secret": secret,
        # Spelled field by field: the id type dumps as its hex string, which no stored id equals.
        "reference": None if reference is None else {"collection": str(reference.collection), "id": reference.id, "seat": reference.seat},
        "link": None if mail.link is None else mail.link.model_dump(),
        "state": "open",
        "recorded_at": now,
        "frist": frist,
        # A secret goes with its lapse; any other row at the latest a retention after its deadline, which its final
        # state brings forward (`final_update`).
        "erase_at": frist if secret is not None else frist + RETENTION,
        "lease": None,
        "leased_until": None,
        "attempts": 0,
        "message_id": None,
        "grund": None,
        "delivery": None,
    }


def final_update(state: FLOutboxRowState, *, now: datetime, message_id: str | None = None) -> Mapping[str, Any]:
    """A row's final state: the claim released, the data and any secret removed, deleted a retention from now.

    `$min`, so a sign-in row keeps its own lapse, which is sooner, and an ordinary row's retention dates from this state.
    """

    return {
        "$set": {"state": state, "message_id": message_id, "lease": None, "leased_until": None},
        "$unset": {"data": "", "secret": ""},
        "$min": {"erase_at": now + RETENTION},
    }


def retry_update(*, now: datetime) -> Mapping[str, Any]:
    """A failed send handed back: no claim holds it, and no drain takes it before the wait has passed."""

    return {"$set": {"lease": None, "leased_until": now + REPETITION_AFTER}}
