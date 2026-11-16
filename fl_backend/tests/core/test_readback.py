"""
CORE · the read-back's exit contract: 0 clean, 1 a document to correct, 2 could not judge, 3 crashed

The scripts that run `python -m app.readback` after a seed or a migration tell the operator to correct a document on a 1,
so a read-back that fails in itself answers 3, at its imports as in its run. Each case runs it in a process of its own,
over an environment holding nothing of this machine's but the one name Windows' sockets need.
"""

import os
import re
import subprocess
import sys
from pathlib import Path

from app.readback import CRASHED

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _read_back(environment: dict[str, str]) -> subprocess.CompletedProcess[str]:
    # Windows' sockets cannot load their providers without it, so `asyncio` fails at its import (WinError 10106).
    system = {"SYSTEMROOT": os.environ["SYSTEMROOT"]} if "SYSTEMROOT" in os.environ else {}

    return subprocess.run(
        [sys.executable, "-m", "app.readback"],
        cwd=BACKEND_ROOT,
        env={**system, **environment},
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
        check=False,
    )


def test_an_import_that_fails_answers_crashed(tmp_path: Path):
    # A package the read-back imports, shadowed by one that cannot be imported: an install broken under it.
    (tmp_path / "pydantic").mkdir()
    (tmp_path / "pydantic" / "__init__.py").write_bytes(b'raise ImportError("a broken install")\n')

    ran = _read_back({"PYTHONPATH": str(tmp_path)})

    assert (ran.returncode, ran.stdout.startswith("The read-back crashed (ImportError at ")) == (CRASHED, True), ran.stdout + ran.stderr


def test_a_run_that_fails_answers_crashed_and_names_no_value(tmp_path: Path):
    """Settings that cannot be built fail inside the run, before any database is asked, and their refusal can carry a value."""

    ran = _read_back({"SECRETS_DIR": str(tmp_path)})

    assert (ran.returncode, ran.stderr) == (CRASHED, ""), ran.stdout + ran.stderr
    # The whole output, one line naming the type and where it was raised: nothing the refusal said reaches it.
    assert re.fullmatch(r"The read-back crashed \(EnvironmentValidationError at \S+\.py:\d+\)\.\n", ran.stdout), ran.stdout
