"""
TESTS · a process a test starts, run to its exit or held running, and ended with every process it started

`faulthandler_timeout` only dumps stacks, so a process left to hang holds its run until CI's `timeout-minutes`. Every
bound but the read after an end is the caller's, named where the reason for its size is written.

A bound that ends the direct child alone leaves the processes it started: on POSIX they run on, and on Windows the pipes
they hold keep both `subprocess.run`'s read after its kill and asyncio's `Process.wait()` waiting
(https://github.com/python/cpython/issues/81605). So every process starts in a tree of its own and is ended whole, as
`scripts/tests/conftest.py :: _whole_tree` ends one: the same design, copied because that package shares no module with
this one.
"""

import asyncio
import contextlib
import ctypes
import os
import signal
import subprocess
import sys
from collections.abc import AsyncIterator, Callable, Iterator, Mapping, Sequence
from pathlib import Path
from typing import Final

# How long a process's pipes get to close once its whole tree is ended. Each closes as its last holder dies, at once
# where every holder was in the tree; one still open names a holder started outside it.
READ_AFTER_ITS_END_S: Final = 2.0


@contextlib.contextmanager
def _whole_tree(pid: int) -> Iterator[Callable[[], None]]:
    """What ends the process `pid` and every process it started, for as long as the run is held.

    Each OS's documented way to end a tree. On Windows that is a job object, which takes in every process created inside
    it (https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects). On POSIX it is the process group the
    child leads, started with `process_group=0`, signalled whole.
    """
    if sys.platform == "win32":
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateJobObjectW.restype = wintypes.HANDLE
        kernel32.OpenProcess.restype = wintypes.HANDLE
        job = kernel32.CreateJobObjectW(None, None)
        if not job:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            # PROCESS_TERMINATE | PROCESS_SET_QUOTA, the rights AssignProcessToJobObject asks of the handle. A process
            # the child starts before the assignment stays outside the job: the window is the child's first
            # instructions, in which a virtual environment's launcher starts its interpreter, and the launcher's own job
            # ends that interpreter with it.
            handle = kernel32.OpenProcess(0x0001 | 0x0100, False, pid)
            if not handle:
                raise ctypes.WinError(ctypes.get_last_error())
            try:
                if not kernel32.AssignProcessToJobObject(job, handle):
                    raise ctypes.WinError(ctypes.get_last_error())
            finally:
                kernel32.CloseHandle(handle)

            def end() -> None:
                kernel32.TerminateJobObject(job, 1)

            yield end
        finally:
            kernel32.CloseHandle(job)
    else:

        def end() -> None:
            # A group whose every process has already exited is ended.
            with contextlib.suppress(ProcessLookupError):
                os.killpg(pid, signal.SIGKILL)

        yield end


def _named(command: Sequence[str]) -> str:
    return f"`{' '.join(command)}`"


def to_its_exit(
    command: Sequence[str],
    *,
    bound_s: float,
    cwd: Path,
    env: Mapping[str, str] | None = None,
    merged: bool = False,
) -> subprocess.CompletedProcess[str]:
    """`command` run to its exit, its output read as UTF-8, both streams in one where `merged`; ended whole past `bound_s`.

    `env` passes as given, and `None` passes this process's own. Past the bound this raises once the tree has ended and
    its pipes have closed, or once `READ_AFTER_ITS_END_S` has passed without, naming which.
    """

    # `process_group` is POSIX's alone, unused on Windows.
    with (
        subprocess.Popen(
            tuple(command),
            cwd=cwd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT if merged else subprocess.PIPE,
            encoding="utf-8",
            errors="replace",
            process_group=0,
        ) as process,
        _whole_tree(process.pid) as end,
    ):
        try:
            stdout, stderr = process.communicate(timeout=bound_s)
        except subprocess.TimeoutExpired:
            end()
            # Raised anew: the expiry's own message quotes no more than these, and its output is a hung run's.
            try:
                process.communicate(timeout=READ_AFTER_ITS_END_S)
            except subprocess.TimeoutExpired:
                raise TimeoutError(
                    f"{_named(command)} ran past its {bound_s:g} s bound, and its pipes stayed open {READ_AFTER_ITS_END_S:g} s"
                    " after every process it started was ended: a process outside its tree holds them"
                ) from None
            raise TimeoutError(f"{_named(command)} ran past its {bound_s:g} s bound and was ended with every process it started") from None

    return subprocess.CompletedProcess(process.args, process.returncode, stdout, stderr)


async def _exited_within(process: asyncio.subprocess.Process, within_s: float) -> bool:
    """Whether `process` exits and its pipes reach their end within `within_s`, what is left in them read and dropped.

    Read to their end rather than waited on: asyncio's `wait` answers at once once the exit is known, whoever still holds
    a pipe, and waits for the pipes only where it was asked before the exit.
    """

    try:
        async with asyncio.timeout(within_s):
            await process.communicate()
    except TimeoutError:
        return False

    return True


async def _stopped(command: Sequence[str], process: asyncio.subprocess.Process, end: Callable[[], None], grace_s: float) -> None:
    try:
        if process.returncode is None:
            # The ask, which on Windows is already a kill. A process that has just exited is no error.
            with contextlib.suppress(ProcessLookupError):
                process.terminate()
        if await _exited_within(process, grace_s):
            return
    except BaseException:
        # Cancelled while it stops, so no grace is left to wait out.
        end()
        raise

    end()
    if not await _exited_within(process, READ_AFTER_ITS_END_S):
        raise TimeoutError(
            f"{_named(command)} was stopped, and its pipes stayed open {READ_AFTER_ITS_END_S:g} s after every process it started"
            " was ended: a process outside its tree holds them"
        )


@contextlib.asynccontextmanager
async def running(
    command: Sequence[str],
    *,
    cwd: Path,
    grace_s: float,
    env: Mapping[str, str] | None = None,
    merged: bool = False,
) -> AsyncIterator[asyncio.subprocess.Process]:
    """`command` started and held running while the block runs, its streams piped, both in one where `merged`.

    As the block leaves, by any path a cancellation's included, the process is asked to stop, and once `grace_s` has
    passed it is ended with every process it started. The block's own bound is its caller's.
    """

    # `process_group` is POSIX's alone, unused on Windows.
    process = await asyncio.create_subprocess_exec(
        *command,
        cwd=cwd,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT if merged else asyncio.subprocess.PIPE,
        process_group=0,
    )
    with contextlib.ExitStack() as held:
        try:
            end = held.enter_context(_whole_tree(process.pid))
        except BaseException:
            # A tree never held, so the process is ended alone.
            process.kill()
            await process.wait()
            raise

        try:
            yield process
        finally:
            await _stopped(command, process, end, grace_s)
