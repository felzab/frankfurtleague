"""
CORE · the daily ceiling on each signed-in person's writes, counted per kind of person and German day

A person's write route opts in by one declaration: `Depends(gedrosselt)` where every call counts, or
a `Drossel` parameter its handler calls on the calls that count, a consent grant and never its
withdrawal; an address change counts on a day of its own, `Depends(adresswechsel_gedrosselt)`. The
count is operational state rather than a domain write, so it reaches the driver here, outside
`app/core/crud.py`, the action log and the write's own transaction.

Invariants:
- No administrator's route declares any of them.
"""

import math
from collections.abc import Awaitable, Iterable, Mapping
from datetime import datetime, time, timedelta
from typing import Annotated, Any, Final, Literal, Protocol

from fastapi import Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.core.crud import literal_pattern
from app.core.dependencies import DrosselungCollection, get_germany_now
from app.core.exceptions import DrosselungException
from app.core.logging import fl_logger
from app.core.recording import AktorFunktion, PersonActor, actor_var
from app.shared.schemas.bounds import (
    AKTEUR_PSEUDONYM_SHOWN,
    DROSSELUNG_ADRESSWECHSEL_PRO_TAG,
    DROSSELUNG_KONTAKT_PRO_TAG,
    DROSSELUNG_SCHIEDSRICHTER_PRO_TAG,
    DROSSELUNG_SPIELER_PRO_TAG,
)

DROSSELUNG_ERREICHT = "REQ-DROSSELUNG-001"

# Keyed by the kind of person the route's binder fixed (`app/core/recording.py :: AktorFunktion`), so one
# mailbox holding a seat and a pupil record keeps a count for each.
TAGESBUDGETS: Final[Mapping[AktorFunktion, int]] = {
    "kontakt": DROSSELUNG_KONTAKT_PRO_TAG,
    "spieler": DROSSELUNG_SPIELER_PRO_TAG,
    "schiedsrichter": DROSSELUNG_SCHIEDSRICHTER_PRO_TAG,
}

# The address change's count, keyed apart from every kind's: whichever record carries a change, one person starts it.
ADRESSWECHSEL_ZAEHLER: Final = "adresswechsel"
Zaehler = AktorFunktion | Literal["adresswechsel"]

# Every count a person holds, which the erasure of the whole person removes.
ZAEHLER_BUDGETS: Final[Mapping[Zaehler, int]] = {**TAGESBUDGETS, ADRESSWECHSEL_ZAEHLER: DROSSELUNG_ADRESSWECHSEL_PRO_TAG}


class Drosseln(Protocol):
    """One counted write of the person the request is bound to, refused past their ceiling: on their Funktion's count, or on `zaehler`."""

    def __call__(self, zaehler: Zaehler | None = None) -> Awaitable[None]: ...


def tagesende(germany_now: datetime) -> datetime:
    """The German midnight ending `germany_now`'s day: the count's `ablauf`, and what `Retry-After` counts down to."""

    return datetime.combine(germany_now.date() + timedelta(days=1), time(), tzinfo=germany_now.tzinfo)


def sekunden_bis_tagesende(germany_now: datetime) -> int:
    # Through the timestamps: two datetimes sharing one `tzinfo` subtract as wall clocks, an hour
    # wrong on the days the clocks change.
    return math.ceil(tagesende(germany_now).timestamp() - germany_now.timestamp())


def _count_prefix(zaehler: Zaehler, pseudonym: str) -> str:
    """A count's key up to its day, spelled once for the count and for the erasure removing every day of it."""

    return f"{zaehler}:{pseudonym}:"


def get_drossel(
    drosselung_collection: DrosselungCollection,
    germany_now: Annotated[datetime, Depends(get_germany_now)],
) -> Drosseln:
    """The count of one write against the bound person's ceiling, called where a write counts."""

    # Set once this request's write is admitted: `with_transaction` reruns a callback calling the count
    # after a transient error, and one write spends one unit however often its attempt is retried.
    zugelassen = False

    async def drosseln(zaehler: Zaehler | None = None) -> None:
        nonlocal zugelassen
        if zugelassen:
            return

        actor = actor_var.get()
        # `fl_backend/tests/api/test_drosselung.py` holds every route reaching here to a person's binder.
        assert isinstance(actor, PersonActor), "only a signed-in person's write is counted"

        # Outside the write's transaction: a write refused after this spends its unit, and one person's
        # concurrent writes never conflict over their count.
        gezaehlt_auf: Zaehler = actor.funktion if zaehler is None else zaehler
        gezaehlt = await drosselung_collection.find_one_and_update(
            {"_id": f"{_count_prefix(gezaehlt_auf, actor.pseudonym)}{germany_now.date().isoformat()}"},
            {"$inc": {"n": 1}, "$setOnInsert": {"ablauf": tagesende(germany_now)}},
            projection={"_id": False, "n": True},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        # An upsert answering `AFTER` yields the row it raised, whether or not the row stood before.
        assert gezaehlt is not None
        ceiling = ZAEHLER_BUDGETS[gezaehlt_auf]
        if gezaehlt["n"] <= ceiling:
            zugelassen = True
            return

        # The first refusal alone, so a person is named once a day however long they keep pressing;
        # by the prefix the log page shows, never an address.
        if gezaehlt["n"] == ceiling + 1:
            fl_logger.warning(
                f"A person reached their daily write ceiling: {gezaehlt_auf} {actor.pseudonym[:AKTEUR_PSEUDONYM_SHOWN]}",
                extra={"error_code": DROSSELUNG_ERREICHT},
            )

        raise DrosselungException(error_code=DROSSELUNG_ERREICHT, retry_after_s=sekunden_bis_tagesende(germany_now))

    return drosseln


# A handler's parameter, for a route whose calls count only where the handler judges a write counts.
Drossel = Annotated[Drosseln, Depends(get_drossel)]


async def gedrosselt(drossel: Drossel) -> None:
    """Count every call of the route declaring it, before its handler runs."""

    await drossel()


async def adresswechsel_gedrosselt(drossel: Drossel) -> None:
    """`gedrosselt` on the address change's own count."""

    await drossel(ADRESSWECHSEL_ZAEHLER)


async def erase_counts_in_session(
    *,
    drosselung_collection: AsyncCollection,
    # The erased person's `app/core/security.py :: akteur_pseudonym`, the key every count of theirs carries.
    pseudonym: str,
    # REQUIRED: removed outside the erasure's transaction, the counts go even where the erasure rolls
    # back, handing a person who still stands a fresh day.
    session: AsyncClientSession,
    # A scope taking one kind of person names it: the counts of a kind whose record stands are that record's.
    funktionen: Iterable[Zaehler] = ZAEHLER_BUDGETS,
) -> int:
    """Remove every count this person holds of `funktionen`, every kind unless named, every day of each, answering how many."""

    erased = await drosselung_collection.delete_many(build_counts_filter(pseudonym, funktionen), session=session)

    return erased.deleted_count


async def carry_counts_in_session(*, drosselung_collection: AsyncCollection, alt: str, neu: str, session: AsyncClientSession) -> int:
    """Move every day's count the pseudonym `alt` holds onto `neu`, added to any `neu` holds, answering how many moved.

    An address change re-keys the person's pseudonym; left behind, every count would start afresh at each effect.
    """

    moved = await drosselung_collection.find(build_counts_filter(alt), session=session).to_list(length=None)
    for row in moved:
        await drosselung_collection.update_one(
            {"_id": str(row["_id"]).replace(f":{alt}:", f":{neu}:", 1)},
            {"$inc": {"n": row["n"]}, "$setOnInsert": {"ablauf": row["ablauf"]}},
            upsert=True,
            session=session,
        )
    if moved:
        await drosselung_collection.delete_many({"_id": {"$in": [row["_id"] for row in moved]}}, session=session)

    return len(moved)


def build_counts_filter(pseudonym: str, funktionen: Iterable[Zaehler] = ZAEHLER_BUDGETS) -> Mapping[str, Any]:
    """Every count `pseudonym` holds of `funktionen`, each day of each."""

    # By the key's prefix rather than today's and yesterday's keys: a day the TTL monitor has not yet
    # reached is still the person's pseudonym, however late the monitor runs.
    return {"$or": [{"_id": {"$regex": f"^{literal_pattern(_count_prefix(funktion, pseudonym))}"}} for funktion in funktionen]}
