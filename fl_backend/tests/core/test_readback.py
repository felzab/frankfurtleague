"""
CORE · the read-back's exit contract: 0 clean, 1 a document to correct, 2 could not judge, 3 crashed

The scripts that run `python -m app.readback` after a seed or a migration tell the operator to correct a document on a 1,
and read a 1 as the read-back's own only beside its closing line: Compose and Python answer their own failures 1 too.
Each case runs it in a process of its own, over an environment holding nothing of this machine's but the one name
Windows' sockets need.
"""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from app.readback import CLOSING_LINE, UNJUDGED
from tests.processes import to_its_exit

BACKEND_ROOT = Path(__file__).resolve().parents[2]
LIBRARY = BACKEND_ROOT.parent / "scripts" / "lib" / "_lib.sh"

# An interpreter's start and the read-back's imports take a few seconds; this is far past them, so only a read-back
# that hangs reaches it.
READ_BACK_BOUND_S = 60.0


def _read_back(environment: dict[str, str]) -> subprocess.CompletedProcess[str]:
    # Windows' sockets cannot load their providers without it, so `asyncio` fails at its import (WinError 10106).
    system = {"SYSTEMROOT": os.environ["SYSTEMROOT"]} if "SYSTEMROOT" in os.environ else {}

    return to_its_exit(
        [sys.executable, "-m", "app.readback"],
        bound_s=READ_BACK_BOUND_S,
        cwd=BACKEND_ROOT,
        env={**system, **environment},
    )


def test_settings_that_cannot_load_are_a_refusal(tmp_path: Path):
    """Settings that cannot be built are a configuration it could not load: nothing was judged, before any database is asked."""

    ran = _read_back({"SECRETS_DIR": str(tmp_path)})

    assert ran.returncode == UNJUDGED, ran.stdout + ran.stderr
    # One line, the settings' own refusal as the backend's boot logs it, naming the files missing from the empty directory.
    assert re.fullmatch(r"The settings could not be loaded: [^\n]*Invalid secret files: [^\n]+\n", ran.stdout), ran.stdout


def _class_of(status: int, output: str) -> str:
    """The class the scripts' library gives the read-back's `status` beside `output`, read by bash itself.

    Bash matches the pattern as a POSIX extended expression, which Python's `re` reads otherwise: `\\d` matches a digit
    there and a `d` here.
    """
    bash = shutil.which("bash")
    assert bash is not None, "no bash on PATH, which every script under scripts/ needs"
    read = 'source "$1"; class=0; exit_class readback "$2" "$3" || class=$?; printf "%s" "$class"'
    ran = to_its_exit([bash, "-c", read, "bash", LIBRARY.as_posix(), str(status), output], bound_s=READ_BACK_BOUND_S, cwd=BACKEND_ROOT)
    assert ran.returncode == 0, ran.stdout + ran.stderr
    return ran.stdout


def test_the_closing_line_is_the_one_the_scripts_read_a_refusal_by():
    """A wording the scripts' pattern stops matching turns every document to correct into a crash."""

    assert _class_of(1, CLOSING_LINE.format(read=12, refused=3) + "\n") == "1", CLOSING_LINE
    # A 1 beside a clean count is Compose's or Python's own.
    assert _class_of(1, CLOSING_LINE.format(read=12, refused=0) + "\n") == "3", CLOSING_LINE
