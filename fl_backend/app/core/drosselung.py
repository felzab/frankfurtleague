"""
CORE · the daily ceiling on each signed-in person's writes, counted per kind of person and German day

A person's write route opts in by one declaration: `Depends(gedrosselt)` where every call counts, or
a `Drossel` parameter its handler calls on the calls that count, a consent grant and never its
withdrawal. The count is operational state rather than a domain write, so it reaches the driver
here, outside `app/core/crud.py`, the action log and the write's own transaction.

Invariants:
- No administrator's route declares either (`docs/backend/spec.md :: I615`).
"""

import math
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime, time, timedelta
from typing import Annotated, Final

from fastapi import Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection

from app.core.db import get_drosselung_collection
from app.core.dependencies import get_germany_now
from app.core.exceptions import DrosselungException
from app.core.logging import fl_logger
from app.core.recording import AktorFunktion, PersonActor, actor_var
from app.shared.schemas.bounds import (
    AKTEUR_PSEUDONYM_SHOWN,
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

# One counted write of the person the request is bound to, refused past their ceiling.
Drosseln = Callable[[], Awaitable[None]]


def tagesende(germany_now: datetime) -> datetime:
    """The German midnight ending `germany_now`'s day: the count's `ablauf`, and what `Retry-After` counts down to."""

    return datetime.combine(germany_now.date() + timedelta(days=1), time(), tzinfo=germany_now.tzinfo)


def sekunden_bis_tagesende(germany_now: datetime) -> int:
    # Through the timestamps: two datetimes sharing one `tzinfo` subtract as wall clocks, an hour
    # wrong on the days the clocks change.
    return math.ceil(tagesende(germany_now).timestamp() - germany_now.timestamp())


def get_drossel(
    drosselung_collection: Annotated[AsyncCollection, Depends(get_drosselung_collection)],
    germany_now: Annotated[datetime, Depends(get_germany_now)],
) -> Drosseln:
    """The count of one write against the bound person's ceiling, called where a write counts (`docs/backend/spec.md :: I614`)."""

    # Set once this request's write is admitted: `with_transaction` reruns a callback calling the count
    # after a transient error, and one write spends one unit however often its attempt is retried.
    zugelassen = False

    async def drosseln() -> None:
        nonlocal zugelassen
        if zugelassen:
            return

        actor = actor_var.get()
        # `fl_backend/tests/api/test_drosselung.py` holds every route reaching here to a person's binder.
        assert isinstance(actor, PersonActor), "only a signed-in person's write is counted"

        # Outside the write's transaction: a write refused after this spends its unit, and one person's
        # concurrent writes never conflict over their count.
        gezaehlt = await drosselung_collection.find_one_and_update(
            {"_id": f"{actor.funktion}:{actor.pseudonym}:{germany_now.date().isoformat()}"},
            {"$inc": {"n": 1}, "$setOnInsert": {"ablauf": tagesende(germany_now)}},
            projection={"_id": False, "n": True},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        # An upsert answering `AFTER` yields the row it raised, whether or not the row stood before.
        assert gezaehlt is not None
        ceiling = TAGESBUDGETS[actor.funktion]
        if gezaehlt["n"] <= ceiling:
            zugelassen = True
            return

        # The first refusal alone, so a person is named once a day however long they keep pressing;
        # by the prefix the log page shows, never an address.
        if gezaehlt["n"] == ceiling + 1:
            fl_logger.warning(
                f"A person reached their daily write ceiling: {actor.funktion} {actor.pseudonym[:AKTEUR_PSEUDONYM_SHOWN]}",
                extra={"error_code": DROSSELUNG_ERREICHT},
            )

        raise DrosselungException(error_code=DROSSELUNG_ERREICHT, retry_after_s=sekunden_bis_tagesende(germany_now))

    return drosseln


# A handler's parameter, for a route whose calls count only where the handler judges a write counts.
Drossel = Annotated[Drosseln, Depends(get_drossel)]


async def gedrosselt(drossel: Drossel) -> None:
    """Count every call of the route declaring it, before its handler runs."""

    await drossel()
