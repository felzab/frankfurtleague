"""
TESTS · what a failed run does to the others it was started beside (`app/core/concurrency.py :: concurrently`)

Invariants:
- A run that raises stops every other run before the call returns, so no read outlives the request that sent it.
- The exception escapes as itself, never inside an `ExceptionGroup`, so the handler chosen by its type answers it: a
  404 raised in a run answers as a 404.
- Where several raise in one step, a crash outranks a refusal whichever finished first, so a request answers a defect
  as one; of a kind, the first is raised, and every other crash is logged, so a second crash is still found.
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


async def test_of_a_refusal_and_a_crash_in_one_step_the_crash_escapes_though_it_finished_second():
    crash = KeyError("crashed")
    finished: list[str] = []

    async def refused() -> None:
        await asyncio.sleep(0)
        finished.append("refused")
        raise DocumentNotFoundError()

    async def crashed() -> None:
        await asyncio.sleep(0)
        finished.append("crashed")
        raise crash

    with pytest.raises(KeyError) as raised:
        await concurrently(refused(), crashed())

    assert (raised.value, finished) == (crash, ["refused", "crashed"])


async def test_a_crash_discarded_beside_the_one_raised_is_logged_and_a_refusal_is_not(caplog: pytest.LogCaptureFixture):
    crash = KeyError("crashed")

    async def refused() -> None:
        await asyncio.sleep(0)
        raise DocumentNotFoundError()

    async def crashed() -> None:
        await asyncio.sleep(0)
        raise crash

    async def crashed_too() -> None:
        await asyncio.sleep(0)
        raise ValueError("crashed too")

    with caplog.at_level(logging.ERROR, logger=fl_logger.name), pytest.raises(KeyError) as raised:
        await concurrently(refused(), crashed(), crashed_too())

    assert raised.value is crash
    [record] = caplog.records
    assert (record.getMessage(), getattr(record, "error_code", None)) == ("concurrency.failure_discarded", Code.UNHANDLED_CRASH)
    assert str(getattr(record, "diagnosis", "")).startswith("ValueError in crashed_too at "), record.__dict__
