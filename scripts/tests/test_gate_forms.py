"""SCRIPTS · the two run forms the help block documents, entered rather than read.

The `--verbose` form streams each tool's own output where a captured run replays it, and `--serial`
drops the scope pool as well as the step pool -- the form `docs/ops/spec.md` §1.6 measures a pooled
run against. Every case drives the real gate over a throwaway tree whose only tools are stubs, so a
two-scope run costs a second rather than minutes.

Invariants:
  The fixture tree stays committed-clean: the scope check reads its own diff before a scope opens.
"""

from __future__ import annotations

import difflib
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Final

from conftest import base_env, configure, copy_scripts, git, new_root, run_shell, write_shell

# Not a skip condition, for `scripts/tests/test_exit_contract.py :: BASH`'s reason.
BASH: Final = shutil.which("bash")

# `--frontend` alone selects two scopes -- it implies `--format` -- and every tool either scope runs
# is `pnpm`, so one stub covers both and no daemon, virtualenv or node_modules is involved.
FLAGS: Final = "--frontend"

# `audit:prod` alone answers 1: the frontend scope grades that as an advisory, so the run stays
# green while `quietly` prints the capture -- which puts a replayed tool's output in both forms.
STUB_PNPM: Final = """#!/usr/bin/env bash
set -u
printf 'worker=%s step=%s\\n' "${FL_GATE_WORKER:-}" "${FL_GATE_STEP:-}" > "${FL_STUB_LOG}/${1//:/-}-$$-${RANDOM}"
if [[ "${1:-}" == "audit:prod" ]]; then
  printf '%s\\n' "an advisory the stub reports"
  exit 1
fi
printf '%s\\n' "the stub ran ${1:-}"
exit 0
"""

STUB_PYTHON: Final = """#!/usr/bin/env bash
exec "{interpreter}" "$@"
"""

# What a tool that PASSED wrote. `quietly` prints it on the streaming arm and discards it on the
# other, so its presence is the whole of what `--verbose` changes on a green run.
PASSING_TOOL: Final = "the stub ran format:check"

# A tool the gate itself ran, rather than one a pool started as its own process.
IN_THE_PARENT: Final = "worker= step="

# A duration comes from `scripts/lib/_lib.sh :: fmt_ms` at three sites -- a step's suffix, the
# table's cell, the closing elapsed -- and no two runs agree on one. Its padding goes with it: the
# cell is right-aligned.
DURATION: Final = re.compile(r" +(?:\d+\.\d+s|\d+m \d{2}s|\d+s)")


@dataclass(frozen=True)
class Fixture:
    """A committed copy of `scripts/`, with the stubs that stand in for its tools."""

    verify: Path
    stubs: Path
    started: Path


@cache
def _fixture() -> Fixture:
    root = new_root("fl-gate-forms-")
    copy_scripts(root / "scripts")
    # `do_prettier` and every frontend body `cd` here before running their tool.
    (root / "fl_frontend").mkdir()
    configure(root, hooks=str(root / "hooks-none"))
    git(root, "add", "-A")
    git(root, "commit", "-m", "the gate, with nothing under it")

    stubs = new_root("fl-gate-stubs-")
    # The fixture has no virtualenv and no guaranteed `python3`: with no interpreter at the
    # checkers' floor the pooled form falls back to the serial path, and the two stop differing.
    interpreter = STUB_PYTHON.format(interpreter=Path(sys.executable).as_posix())
    for name, text in (("pnpm", STUB_PNPM), ("python3", interpreter)):
        # The execute bit is what puts a stub ahead of the real tool on PATH.
        os.chmod(write_shell(stubs / name, text), 0o755)
    return Fixture(verify=root / "scripts" / "gate" / "verify.sh", stubs=stubs, started=stubs / "started")


@cache
def _run(*flags: str) -> tuple[subprocess.CompletedProcess[str], tuple[str, ...]]:
    """One gate run over the fixture, its streams beside one row per tool the run started.

    Cached on its flags: the cases below read three runs between them and each costs a second.
    """
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    fixture = _fixture()
    if fixture.started.exists():
        shutil.rmtree(fixture.started)
    fixture.started.mkdir(parents=True)
    environment = base_env()
    # Past `base_env`: `CI` forces the scope pool off, and that pool is what two cases here compare.
    environment.pop("CI", None)
    environment["PATH"] = str(fixture.stubs) + os.pathsep + environment["PATH"]
    environment["FL_STUB_LOG"] = str(fixture.started)
    # Keeps the tree committed-clean: the scope check reads its diff, and a `__pycache__` an import
    # leaves under `scripts/` is a change asking for a scope this run does not name.
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    done = run_shell(BASH, fixture.verify, *flags, env=environment)
    # One file per invocation, never one appended log: the pooled form runs its tools concurrently,
    # and an interleaved append loses exactly the row that tells the two forms apart.
    return done, tuple(sorted(path.read_text(encoding="utf-8").strip() for path in fixture.started.iterdir()))


def _masked(capture: str) -> str:
    """One capture with the gate's own timing chrome gone.

    Nothing a stub prints is duration-shaped, so the pattern reaches the chrome and nothing else.
    """
    return DURATION.sub(" <elapsed>", capture)


def test_the_streaming_form_shows_a_passing_tools_own_output_where_the_captured_form_drops_it() -> None:
    """`scripts/lib/_lib.sh :: quietly` has two arms, and `--verbose` is the only route into one."""
    streamed, _ = _run(FLAGS, "--verbose")
    captured, _ = _run(FLAGS, "--serial")
    assert streamed.returncode == 0, streamed.stdout + streamed.stderr
    assert PASSING_TOOL in streamed.stdout, f"--verbose printed nothing a passing tool wrote:\n{streamed.stdout}"
    assert PASSING_TOOL not in captured.stdout, "a captured run printed a passing tool's output, so the forms do not differ"


def test_the_multi_scope_serial_form_runs_every_tool_in_the_gates_own_process() -> None:
    """`--serial` drops the scope pool as well as the step pool, which one scope cannot show."""
    done, started = _run(FLAGS, "--serial")
    assert done.returncode == 0, done.stdout + done.stderr
    assert started, "no tool ran at all, so nothing here says where they ran"
    assert set(started) == {IN_THE_PARENT}, f"a serial run started a unit as its own process: {sorted(set(started))}"


def test_the_pooled_run_replays_what_the_serial_run_printed_byte_for_byte() -> None:
    """`docs/ops/spec.md` §1.6's oracle, measured: a green run's two forms, compared per stream."""
    pooled, started = _run(FLAGS)
    serial, _ = _run(FLAGS, "--serial")
    assert pooled.returncode == 0, pooled.stdout + pooled.stderr
    assert serial.returncode == 0, serial.stdout + serial.stderr
    assert any(row.startswith("worker=1") for row in started), "no pool ran, so this compared one form with itself"
    for stream, one, two in (("stdout", pooled.stdout, serial.stdout), ("stderr", pooled.stderr, serial.stderr)):
        drift = "\n".join(difflib.unified_diff(_masked(one).splitlines(), _masked(two).splitlines(), "pooled", "serial"))
        assert not drift, f"the two forms' {stream} differ:\n{drift}"
