"""Several awaitables run at once, none outliving the call that started them."""

import asyncio
from collections.abc import Coroutine
from typing import Any, overload

type Run[T] = Coroutine[Any, Any, T]


@overload
async def concurrently[A, B](a: Run[A], b: Run[B], /) -> tuple[A, B]: ...
@overload
async def concurrently[A, B, C](a: Run[A], b: Run[B], c: Run[C], /) -> tuple[A, B, C]: ...
@overload
async def concurrently[A, B, C, D](a: Run[A], b: Run[B], c: Run[C], d: Run[D], /) -> tuple[A, B, C, D]: ...
@overload
async def concurrently[A, B, C, D, E](a: Run[A], b: Run[B], c: Run[C], d: Run[D], e: Run[E], /) -> tuple[A, B, C, D, E]: ...
@overload
async def concurrently[A, B, C, D, E, F](a: Run[A], b: Run[B], c: Run[C], d: Run[D], e: Run[E], f: Run[F], /) -> tuple[A, B, C, D, E, F]: ...
@overload
async def concurrently[A, B, C, D, E, F, G](
    a: Run[A], b: Run[B], c: Run[C], d: Run[D], e: Run[E], f: Run[F], g: Run[G], /
) -> tuple[A, B, C, D, E, F, G]: ...
@overload
async def concurrently[A, B, C, D, E, F, G, H](
    a: Run[A], b: Run[B], c: Run[C], d: Run[D], e: Run[E], f: Run[F], g: Run[G], h: Run[H], /
) -> tuple[A, B, C, D, E, F, G, H]: ...
@overload
async def concurrently[T](*runs: Run[T]) -> tuple[T, ...]: ...
async def concurrently(*runs: Run[Any]) -> tuple[Any, ...]:
    """Every result in the order given, or one exception raised, as itself, once every other run has stopped.

    A task group, where `asyncio.gather` would leave the others running past a failure. The group's
    `ExceptionGroup` is unwrapped because a handler is chosen by the exception's own type, so a 404
    raised in a run answers as a 404. Where several raise in the step that sets off the cancellation, or
    as that cancellation unwinds them, the first is raised.
    """

    try:
        async with asyncio.TaskGroup() as group:
            tasks = [group.create_task(run) for run in runs]
    except BaseExceptionGroup as failed:
        failures = failed.exceptions
    else:
        return tuple(task.result() for task in tasks)

    # Raised outside the handler, which would otherwise overwrite the exception's own context with the group.
    raise failures[0]
