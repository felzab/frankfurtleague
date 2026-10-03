import asyncio

import pytest

from app.core.concurrency import gather_cancelling


class _Read:
    """One stand-in read: it answers or raises after `turns` turns of the loop, recording a cancellation."""

    def __init__(self, turns: int, *, answer: object = None, raises: BaseException | None = None) -> None:
        self.turns = turns
        self.answer = answer
        self.raises = raises
        self.cancelled = False

    async def run(self) -> object:
        try:
            for _ in range(self.turns):
                await asyncio.sleep(0)
        except asyncio.CancelledError:
            self.cancelled = True
            raise
        if self.raises is not None:
            raise self.raises
        return self.answer


class TestGatherCancelling:
    def test_answers_each_read_in_the_order_it_was_handed(self):
        slow, fast = _Read(3, answer="slow"), _Read(1, answer="fast")

        assert asyncio.run(gather_cancelling(slow.run(), fast.run())) == ("slow", "fast")

    def test_a_failed_read_cancels_the_one_still_running_and_is_raised_as_itself(self):
        failing, running = _Read(1, raises=ConnectionError("the grant read failed")), _Read(50)

        # Read inside the loop: `asyncio.run` cancels every task still pending once it returns.
        async def cancelled_by_the_answer() -> bool:
            with pytest.raises(ConnectionError, match="the grant read failed"):
                await gather_cancelling(failing.run(), running.run())
            return running.cancelled

        assert asyncio.run(cancelled_by_the_answer()), "the read still running when the first failed ran on past the caller's answer"

    def test_two_reads_failing_before_the_cancellation_raise_the_first_naming_the_other_by_class(self):
        """An outage fails every read in one turn: grouped, the handlers would answer it as a crash rather than the database's."""

        first, second = ConnectionError("one"), TimeoutError("two")

        with pytest.raises(ConnectionError) as raised:
            asyncio.run(gather_cancelling(_Read(1, raises=first).run(), _Read(1, raises=second).run(), _Read(50).run()))

        assert raised.value is first
        assert raised.value.__notes__ == ["Failed beside it: TimeoutError"], "the second failure went unreported"

    def test_the_failure_raised_keeps_the_chain_its_read_gave_it(self):
        own_cause = OSError("the socket closed")

        async def failing() -> None:
            await asyncio.sleep(0)
            raise ConnectionError("the read failed") from own_cause

        with pytest.raises(ConnectionError) as raised:
            asyncio.run(gather_cancelling(failing(), _Read(50).run()))

        assert raised.value.__cause__ is own_cause

    def test_the_caller_s_cancellation_cancels_every_read(self):
        reads = (_Read(50), _Read(50))

        async def cancelled_caller() -> None:
            caller = asyncio.create_task(gather_cancelling(reads[0].run(), reads[1].run()))
            await asyncio.sleep(0)
            caller.cancel()
            with pytest.raises(asyncio.CancelledError):
                await caller

        asyncio.run(cancelled_caller())

        assert [read.cancelled for read in reads] == [True, True]
