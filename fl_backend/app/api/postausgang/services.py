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

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.postausgang.schemas import (
    FLPostausgangArt,
    FLPostausgangBezug,
    FLPostausgangDaten,
    FLPostausgangErgebnisArt,
    FLPostausgangLink,
    FLPostausgangStand,
    FLPostausgangZustellStand,
)
from app.core.crud import post_many_to_db, post_one_to_db

# How long one claim holds its rows: past the page's sends at the frontend's per-send bound, so a drain still sending is
# never overtaken.
BEANSPRUCHUNG_DAUER: Final = timedelta(minutes=5)

# The rows one claim hands out.
SEITE: Final = 10

# How long a send that failed waits before a drain may hand it out again: a provider refusing for its own reasons (its
# daily quota, a moment's outage) is not asked again by every drain the next writes start.
WIEDERHOLUNG_NACH: Final = timedelta(minutes=1)

# How old a mail may grow unsent before it is given up, the one bound on its retries: past the provider's daily quota
# resetting once, so a busy day delays a mail rather than losing it. A sign-in mail's bound is its secret's lapse.
ZUSTELLFRIST: Final = timedelta(days=2)

# A finished row's retention, matching the provider's own, so the delivery state lives as long as the message it is about.
NACHLAUF: Final = timedelta(days=30)

# The sign-in library's kinds, each tried once: its own repair of a failed code is a fresh one.
ANMELDE_ARTEN: Final[frozenset[FLPostausgangArt]] = frozenset({"anmeldecode", "passkey_hinzugefuegt", "passkey_geloescht", "konto_loeschung"})

# The one kind of mail a ban does not stop: the ban's own notice.
UNGESPERRT: Final[frozenset[FLPostausgangArt]] = frozenset({"sperre"})

# The final state each reported outcome settles a row in; a send to be tried again ends there only where it may not be.
ENDSTAND: Final[Mapping[FLPostausgangErgebnisArt, FLPostausgangStand]] = {
    "gesendet": "gesendet",
    "zurueckgehalten": "zurueckgehalten",
    "aufgeben": "aufgegeben",
    "wiederholen": "aufgegeben",
}

# What a reader of a seat's delivery takes as the mail not having arrived: refused by the provider's suppression list,
# bounced for good, or marked as spam -- or never sent at all.
UNZUSTELLBAR: Final[frozenset[FLPostausgangZustellStand]] = frozenset({"unzustellbar", "unterdrueckt", "beschwerde"})

# Each delivery state, and the states a row may hold for an event to move it there: never back from a later one, the
# provider sending events in any order.
FOLGT_AUF: Final[Mapping[FLPostausgangZustellStand, tuple[FLPostausgangZustellStand | None, ...]]] = {
    "verzoegert": (None,),
    "zugestellt": (None, "verzoegert"),
    "unzustellbar": (None, "verzoegert"),
    "unterdrueckt": (None, "verzoegert"),
    "beschwerde": (None, "verzoegert", "zugestellt"),
}


async def enqueue_mail(
    *,
    postausgang_collection: AsyncCollection,
    session: AsyncClientSession,
    schluessel: str,
    an: str,
    daten: FLPostausgangDaten,
    now: datetime,
    bezug: FLPostausgangBezug | None = None,
    link: FLPostausgangLink | None = None,
    geheim: str | None = None,
    gueltig_bis: datetime | None = None,
) -> ObjectId:
    """Owe one mail to one recipient, inside the transaction of the write owing it, and answer the row's id.

    `daten` is the kind's member of `app/api/postausgang/schemas.py :: FLPostausgangDaten`, whose `art` is the row's.
    `schluessel` is the mail's identity: the same on a replay of the write, so the replay finds the row its first run
    wrote and owes nothing twice, and distinct for every recipient and every mail the write owes. `link` mints a link at
    the hand-out on the record `bezug` names. `geheim` lapses with `gueltig_bis`, the row's deadline and its deletion both.
    """

    if geheim is not None and gueltig_bis is None:
        raise ValueError("a secret is held until it lapses, and this one names no lapse")

    # A first run committed before this snapshot is found; one committed after it makes the insert a write conflict the
    # caller's `with_transaction` retries, which then finds it.
    stored = await postausgang_collection.find_one({"schluessel": schluessel}, {"_id": 1}, session=session)
    if stored is not None:
        return stored["_id"]

    created = await post_one_to_db(
        collection=postausgang_collection,
        document=row_of(
            OwedMail(schluessel=schluessel, an=an, daten=daten, bezug=bezug, link=link), now=now, geheim=geheim, gueltig_bis=gueltig_bis
        ),
        session=session,
    )

    return created.inserted_id


@dataclass(frozen=True)
class OwedMail:
    """One mail a league write owes one recipient, as `enqueue_mail` names its parts."""

    schluessel: str
    an: str
    daten: FLPostausgangDaten
    bezug: FLPostausgangBezug | None = None
    link: FLPostausgangLink | None = None


async def enqueue_mails(
    *,
    postausgang_collection: AsyncCollection,
    session: AsyncClientSession,
    mails: Sequence[OwedMail],
    now: datetime,
) -> None:
    """`enqueue_mail` for every mail one write owes, in two commands however many: one read of the keys, one insert.

    For a write owing a mail per row of a page, whose cost per row its share is sized by. The keys must be distinct.
    """

    if not mails:
        return
    if len({mail.schluessel for mail in mails}) != len(mails):
        raise ValueError("every mail one write owes carries a key of its own")

    stored = await postausgang_collection.find(
        {"schluessel": {"$in": [mail.schluessel for mail in mails]}}, {"schluessel": 1, "_id": 0}, session=session
    ).to_list(length=None)
    owed = {row["schluessel"] for row in stored}
    rows = [row_of(mail, now=now, geheim=None, gueltig_bis=None) for mail in mails if mail.schluessel not in owed]
    if rows:
        await post_many_to_db(collection=postausgang_collection, documents=rows, session=session)


def row_of(mail: OwedMail, *, now: datetime, geheim: str | None, gueltig_bis: datetime | None) -> dict[str, Any]:
    """One owed mail's row as `postausgang` stores it. `geheim` lapses with `gueltig_bis`, the row's deadline and its deletion both."""

    if geheim is not None and gueltig_bis is None:
        raise ValueError("a secret is held until it lapses, and this one names no lapse")
    if mail.link is not None and mail.bezug is None:
        raise ValueError("a link is minted on the record a mail is about, and this mail names none")

    frist = gueltig_bis if gueltig_bis is not None else now + ZUSTELLFRIST
    bezug = mail.bezug

    return {
        "schluessel": mail.schluessel,
        "art": mail.daten.art,
        "an": mail.an,
        # JSON, so an instant keeps its offset and reads back as the aware value its member requires.
        "daten": mail.daten.model_dump(mode="json"),
        "geheim": geheim,
        # Spelled field by field: the id type dumps as its hex string, which no stored id equals.
        "bezug": None if bezug is None else {"sammlung": str(bezug.sammlung), "id": bezug.id, "sitz": bezug.sitz},
        "link": None if mail.link is None else mail.link.model_dump(),
        "stand": "offen",
        "erfasst_am": now,
        "frist": frist,
        # A secret goes with its lapse; any other row at the latest a retention after its deadline, which its final
        # state brings forward (`final_update`).
        "loeschen_am": frist if geheim is not None else frist + NACHLAUF,
        "beanspruchung": None,
        "beansprucht_bis": None,
        "versuche": 0,
        "nachricht_id": None,
        "zustellung": None,
    }


def final_update(stand: FLPostausgangStand, *, now: datetime, nachricht_id: str | None = None) -> Mapping[str, Any]:
    """A row's final state: the claim released, the data and any secret removed, deleted a retention from now.

    `$min`, so a sign-in row keeps its own lapse, which is sooner, and an ordinary row's retention dates from this state.
    """

    return {
        "$set": {"stand": stand, "nachricht_id": nachricht_id, "beanspruchung": None, "beansprucht_bis": None},
        "$unset": {"daten": "", "geheim": ""},
        "$min": {"loeschen_am": now + NACHLAUF},
    }


def retry_update(*, now: datetime) -> Mapping[str, Any]:
    """A failed send handed back: no claim holds it, and no drain takes it before the wait has passed."""

    return {"$set": {"beanspruchung": None, "beansprucht_bis": now + WIEDERHOLUNG_NACH}}


def unzustellbar(row: Mapping[str, Any]) -> bool:
    """Whether a row's mail did not arrive, the judgement a seat's delivery state is read by."""

    zustellung = row.get("zustellung")

    return row.get("stand") == "aufgegeben" or (isinstance(zustellung, Mapping) and zustellung.get("stand") in UNZUSTELLBAR)
