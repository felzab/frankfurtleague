"""
CORE · the read-back's exit contract: 0 clean, 1 a document to correct, 2 could not judge, 3 crashed

Each case runs it in a process of its own, over an environment holding nothing of this machine's but the one name
Windows' sockets need.
"""

import re
import subprocess
import sys
from pathlib import Path

from app.readback import UNJUDGED
from tests.boot import BACKEND_ROOT, environment

# An interpreter's start and the read-back's imports take a few seconds; this is far past them, so only a read-back
# that hangs reaches it.
READ_BACK_BOUND_S = 60.0


def test_settings_that_cannot_load_are_a_refusal(tmp_path: Path):
    """Settings that cannot be built are a configuration it could not load: nothing was judged, before any database is asked."""

    ran = subprocess.run(
        [sys.executable, "-m", "app.readback"],
        cwd=BACKEND_ROOT,
        env=environment(tmp_path, {}),
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=READ_BACK_BOUND_S,
        check=False,
    )

    assert ran.returncode == UNJUDGED, ran.stdout + ran.stderr
    # One line, the settings' own refusal as the backend's boot logs it, naming the files missing from the empty directory.
    assert re.fullmatch(r"The settings could not be loaded: [^\n]*Invalid secret files: [^\n]+\n", ran.stdout), ran.stdout
