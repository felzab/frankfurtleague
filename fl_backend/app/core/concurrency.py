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
    """`asyncio.gather`'s answer, but a first failure cancels the rest and is raised as itself.

    A plain gather leaves the rest running past the caller's answer, and drops their later failures unreported.
    """

    try:
        async with asyncio.TaskGroup() as group:
            tasks = [group.create_task(coroutine) for coroutine in coroutines]
    except ExceptionGroup as failed:
        first, *beside = failed.exceptions
    else:
        return tuple(task.result() for task in tasks)

    # Never grouped: the handlers map a failure by its class, and an outage fails every read at once,
    # which a group would answer as a crash rather than the database's. Any others stay its cause.
    raise first from (ExceptionGroup("failed beside it", beside) if beside else None)
