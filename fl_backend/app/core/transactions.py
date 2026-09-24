from collections.abc import Awaitable, Callable

from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession


async def drain(
    *,
    db: AsyncMongoClient,
    # The caller's `session.with_transaction(<callback>)`, never the callback itself:
    # `tests/core/app_source.py :: _callbacks` reads a callback where `with_transaction` is handed
    # it, and would find none here.
    page_of: Callable[[AsyncClientSession], Awaitable[tuple[int, int, int]]],
    # The callback reads one row past it, or a full page reads as the last one.
    page: int,
) -> tuple[int, int]:
    """A full page is erased and read again: the population filling it is the one only the erasure shrinks (`docs/backend/spec.md :: I295`)."""

    erased_total, redacted_total = 0, 0
    while True:
        async with db.start_session() as session:
            read, erased, redacted = await page_of(session)
        erased_total += erased
        redacted_total += redacted
        if read <= page:
            return erased_total, redacted_total


def refuse_a_stalled_page(*, read: int, moved: int, page: int, clock: str, saison_id: str) -> None:
    """Raise where a full page moved nothing: the same rows come back for ever (`docs/backend/spec.md :: I295`).

    Beside `drain`, which takes the page the same way: each slice keeps its own `SWEEP_PAGE`.
    """

    if read > page and moved == 0:
        raise ValueError(
            f"season {saison_id} fills the {clock} clock's page of {page} with rows it takes none of, so no pass can make progress"
        )
