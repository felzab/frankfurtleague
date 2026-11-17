"""
TESTS · what a failed run does to the others it was started beside (`app/core/concurrency.py :: concurrently`)

Invariants:
- A run that raises stops every other run before the call returns, so no read outlives the request that sent it.
- The exception escapes as itself, never inside an `ExceptionGroup`, so the handler chosen by its type answers it: a
  404 raised in a run answers as a 404.
"""

import asyncio

import pytest

from app.core.concurrency import concurrently
from app.core.exceptions import DocumentNotFoundError


async def test_a_failure_stops_the_other_runs_and_escapes_as_itself():
    refusal = DocumentNotFoundError()
    stopped = asyncio.Event()

    async def refused() -> None:
        await asyncio.sleep(0)
        raise refusal

    async def unanswered() -> None:
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    with pytest.raises(DocumentNotFoundError) as raised:
        await concurrently(refused(), unanswered())

    assert raised.value is refusal
    assert stopped.is_set(), "the other run was still going when the failure escaped"
