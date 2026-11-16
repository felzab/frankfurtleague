"""
TESTS · a process a test starts, run to its exit or stopped, each under a bound its caller names

`faulthandler_timeout` only dumps stacks, so a process left to hang holds its run until CI's `timeout-minutes`. Every
bound here is the caller's, named where the reason for its size is written; none has a default.
"""

import asyncio
import subprocess
from collections.abc import Mapping, Sequence
from pathlib import Path


def to_its_exit(
    command: Sequence[str],
    *,
    bound_s: float,
    cwd: Path,
    env: Mapping[str, str] | None = None,
    merged: bool = False,
) -> subprocess.CompletedProcess[str]:
    """`command` run to its exit, its output read as UTF-8, both streams in one where `merged`; killed past `bound_s`.

    `subprocess.run` kills and reaps the child once its timeout passes, so a process that hangs is gone before this
    raises. `env` passes as given, and `None` passes this process's own.
    """

    try:
        return subprocess.run(
            command,
            cwd=cwd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT if merged else subprocess.PIPE,
            encoding="utf-8",
            errors="replace",
            timeout=bound_s,
            check=False,
        )
    except subprocess.TimeoutExpired:
        # Raised anew: the expiry's own message quotes no more than this one, and its output is a hung run's.
        raise TimeoutError(f"`{' '.join(command)}` ran past its {bound_s:g} s bound and was killed") from None


async def stopped(process: asyncio.subprocess.Process, *, grace_s: float) -> None:
    """`process` asked to stop, and killed once `grace_s` has passed; on Windows the ask is already a kill."""

    if process.returncode is None:
        process.terminate()
        try:
            async with asyncio.timeout(grace_s):
                await process.wait()
        except TimeoutError:
            process.kill()

    await process.wait()
