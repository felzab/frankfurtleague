"""
TESTS · what a failed run does to the others it was started beside (`app/core/concurrency.py :: concurrently`)

Invariants:
- A run that raises stops every other run before the call returns, so no read outlives the request that sent it.
- The exception escapes as itself, never inside an `ExceptionGroup`, so the handler chosen by its type answers it: a
  404 raised in a run answers as a 404.
- Where two raise in one step, the first to finish failing is the one raised, and every other is logged, a refusal
  excepted, so a crash raised beside a refusal is still found.
"""

import asyncio
import logging

import pytest

from app.core.codes import Code
from app.core.concurrency import concurrently
from app.core.exceptions import DocumentNotFoundError
from app.core.logging import fl_logger


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


async def test_of_two_failures_in_one_step_the_first_escapes():
    refusal = DocumentNotFoundError()

    async def refused() -> None:
        await asyncio.sleep(0)
        raise refusal

    async def crashed() -> None:
        await asyncio.sleep(0)
        raise KeyError("crashed")

    with pytest.raises(DocumentNotFoundError) as raised:
        await concurrently(refused(), crashed())

    assert raised.value is refusal


async def test_a_failure_discarded_beside_the_one_raised_is_logged_unless_it_is_a_refusal(caplog: pytest.LogCaptureFixture):
    refusal = DocumentNotFoundError()

    async def refused() -> None:
        await asyncio.sleep(0)
        raise refusal

    async def crashed() -> None:
        await asyncio.sleep(0)
        raise KeyError("crashed")

    async def refused_too() -> None:
        await asyncio.sleep(0)
        raise DocumentNotFoundError()

    with caplog.at_level(logging.ERROR, logger=fl_logger.name), pytest.raises(DocumentNotFoundError) as raised:
        await concurrently(refused(), crashed(), refused_too())

    assert raised.value is refusal
    [record] = caplog.records
    assert (record.getMessage(), getattr(record, "error_code", None)) == ("concurrency.failure_discarded", Code.UNHANDLED_CRASH)
    assert str(getattr(record, "diagnosis", "")).startswith("KeyError in crashed at "), record.__dict__
