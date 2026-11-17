"""
TESTS · a process a test starts, run to its exit or held running (`tests/processes.py`)

Invariants:
- A process past its bound is ended with every process it started, so a grandchild holding the pipe this run reads
  cannot hold the run past the bound.
- A process held running is ended the same way as its block leaves, once its grace has passed.
- A process that defers the signal, as uvicorn defers a SIGTERM until its lifespan's startup ends, is killed once its
  grace has passed, so a boot stuck in its startup ends inside the case holding it.
"""

import signal
import sys
from pathlib import Path

import pytest

from tests.processes import running, to_its_exit

# A child that starts a grandchild on the child's own stdout, the pipe this run reads, says it is ready, and hangs as
# its grandchild does. Twenty seconds rather than for ever: a regression costs a run that much, and leaves nothing.
_STARTS_ONE_THAT_HOLDS_ITS_PIPE = (
    "import subprocess, sys, time;"
    " subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(20)'], stdout=sys.stdout);"
    " print('ready', flush=True); time.sleep(20)"
)

# A child that takes a SIGTERM and carries on, once it has said it is ready to.
_DEFERS_ITS_STOP = "import signal, time; signal.signal(signal.SIGTERM, lambda *_: None); print('ready', flush=True); time.sleep(600)"


def test_a_process_past_its_bound_is_ended_with_every_process_it_started(tmp_path: Path):
    with pytest.raises(TimeoutError, match=r"ran past its 1 s bound and was ended with every process it started"):
        to_its_exit([sys.executable, "-c", _STARTS_ONE_THAT_HOLDS_ITS_PIPE], bound_s=1, cwd=tmp_path)


async def test_a_process_held_running_is_ended_with_every_process_it_started(tmp_path: Path):
    async with running([sys.executable, "-c", _STARTS_ONE_THAT_HOLDS_ITS_PIPE], cwd=tmp_path, grace_s=0.5) as process:
        assert process.stdout is not None
        # Stripped: Windows ends a printed line in a carriage return too.
        assert (await process.stdout.readline()).rstrip() == b"ready"


@pytest.mark.skipif(sys.platform != "linux", reason="Windows' terminate is TerminateProcess, already a kill, so no grace is waited out")
async def test_a_process_deferring_its_stop_is_killed_once_its_grace_has_passed(tmp_path: Path):
    async with running([sys.executable, "-c", _DEFERS_ITS_STOP], cwd=tmp_path, grace_s=0.5) as process:
        assert process.stdout is not None
        assert await process.stdout.readline() == b"ready\n"

    # By name: Windows' `signal` module, which type-checks this file there, has no `SIGKILL`.
    assert process.returncode is not None and signal.Signals(-process.returncode).name == "SIGKILL", process.returncode
