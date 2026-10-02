import asyncio
from collections.abc import Coroutine
from typing import Any, overload


@overload
async def gather_cancelling[A, B](first: Coroutine[Any, Any, A], second: Coroutine[Any, Any, B], /) -> tuple[A, B]: ...


@overload
async def gather_cancelling[A, B, C](
    first: Coroutine[Any, Any, A], second: Coroutine[Any, Any, B], third: Coroutine[Any, Any, C], /
) -> tuple[A, B, C]: ...


async def gather_cancelling(*coroutines: Coroutine[Any, Any, Any]) -> tuple[Any, ...]:
    """`asyncio.gather`'s answer, but a first failure cancels the rest.

    A plain gather leaves them running past the caller's answer, and drops their later failures unreported.
    """

    try:
        async with asyncio.TaskGroup() as group:
            tasks = [group.create_task(coroutine) for coroutine in coroutines]
    except ExceptionGroup as failed:
        # The handlers map a failure by its class, so one alone is raised unwrapped; two that landed
        # before the cancellation stay grouped, neither dropped.
        if len(failed.exceptions) != 1:
            raise
        first = failed.exceptions[0]
    else:
        return tuple(task.result() for task in tasks)

    # Outside the handler, so the group is not chained beneath it as its context.
    raise first
