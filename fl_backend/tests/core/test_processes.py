"""
TESTS · a process a test asks to stop (`tests/processes.py :: stopped`)

Invariants:
- A process that defers the signal, as uvicorn defers a SIGTERM until its lifespan's startup ends, is killed once its
  grace has passed, so a boot stuck in its startup ends inside the case holding it.
"""

import asyncio
import signal
import sys
from pathlib import Path

import pytest

from tests.processes import stopped

# A child that takes a SIGTERM and carries on, once it has said it is ready to.
_DEFERS_ITS_STOP = "import signal, time; signal.signal(signal.SIGTERM, lambda *_: None); print('ready', flush=True); time.sleep(600)"


@pytest.mark.skipif(sys.platform != "linux", reason="Windows' terminate is TerminateProcess, already a kill, so no grace is waited out")
async def test_a_process_deferring_its_stop_is_killed_once_its_grace_has_passed(tmp_path: Path):
    process = await asyncio.create_subprocess_exec(sys.executable, "-c", _DEFERS_ITS_STOP, cwd=tmp_path, stdout=asyncio.subprocess.PIPE)
    assert process.stdout is not None
    try:
        assert await process.stdout.readline() == b"ready\n"
    finally:
        await stopped(process, grace_s=0.5)

    # By name: Windows' `signal` module, which type-checks this file there, has no `SIGKILL`.
    assert process.returncode is not None and signal.Signals(-process.returncode).name == "SIGKILL", process.returncode
