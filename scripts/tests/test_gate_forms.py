"""SCRIPTS · the two run forms the help block documents, entered rather than read.

The `--verbose` form streams each tool's own output where a captured run replays it, and `--serial`
drops the scope pool as well as the step pool -- the form `docs/ops/spec.md` §1.6 measures a pooled
run against. Every case drives the real gate over a throwaway tree whose only tools are stubs, so a
two-scope run costs a second rather than minutes.

Invariants:
  A green run replays a tool's own output: `audit:prod`'s advisory is what puts it in both forms.
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

from conftest import BASH, base_env, copy_scripts, new_root, run_shell, write_shell
from test_gate_prerequisites import PAST_THE_GUARD

# `--frontend` alone selects three scopes -- it implies `--format` and `--frontend-units` -- and
# every tool those scopes run is `pnpm`, so one stub covers them and no daemon, virtualenv or
# node_modules is involved.
FLAGS: Final = "--frontend"

# `audit:prod` alone answers 1, which the frontend scope grades as an advisory; `FL_STUB_FAIL`
# names the one subcommand answering a failure no scope grades away.
STUB_PNPM: Final = """#!/usr/bin/env bash
set -u
printf 'worker=%s step=%s\\n' "${FL_GATE_WORKER:-}" "${FL_GATE_STEP:-}" > "${FL_STUB_LOG}/${1//:/-}-$$-${RANDOM}"
if [[ -n "${FL_STUB_FAIL:-}" && "${1:-}" == "${FL_STUB_FAIL}" ]]; then
  printf '%s\\n' "the stub failed ${1}"
  exit 1
fi
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

# The first `python3` on PATH, answering a version under the checkers' floor, so no pool can start.
STUB_BELOW_FLOOR: Final = """#!/usr/bin/env bash
printf 'Python 3.9.13\\n'
"""

# What a tool that PASSED wrote. `quietly` prints it on the streaming arm and discards it on the
# other, so its presence is the whole of what `--verbose` changes on a green run.
PASSING_TOOL: Final = "the stub ran format:check"

# A tool the gate itself ran, rather than one a pool started as its own process.
IN_THE_PARENT: Final = "worker= step="

# The last unit of the last scope `--frontend` selects, so both forms run everything either would.
# One failing earlier stops the serial form where the pooled one carried on, a difference
# `docs/ops/spec.md` §1.6 allows rather than a drift.
FAILING_TOOL: Final = "build"
WHAT_IT_WROTE: Final = "the stub failed build"

# A duration comes from `scripts/lib/_lib.sh :: fmt_ms` at three sites -- a step's suffix, the
# table's cell, the closing elapsed -- and no two runs agree on one. Its padding goes with it: the
# cell is right-aligned.
DURATION: Final = re.compile(r" +(?:\d+\.\d+s|\d+m \d{2}s|\d+s)")


@dataclass(frozen=True)
class Fixture:
    """A copy of `scripts/`, with the stubs that stand in for its tools."""

    verify: Path
    stubs: Path
    started: Path
    below_floor: Path


@cache
def _fixture() -> Fixture:
    root = new_root("fl-gate-forms-")
    copy_scripts(root / "scripts")
    # `do_prettier` and every frontend body `cd` here before running their tool.
    (root / "fl_frontend").mkdir()
    # Empty: the gate's preflight refuses a frontend scope without it, and the stub reads nothing
    # from it.
    (root / "fl_frontend" / "node_modules").mkdir()

    stubs = new_root("fl-gate-stubs-")
    # The fixture has no virtualenv and no guaranteed `python3`: with no interpreter at the
    # checkers' floor the pooled form falls back to the serial path, and the two stop differing.
    interpreter = STUB_PYTHON.format(interpreter=Path(sys.executable).as_posix())
    for name, text in (("pnpm", STUB_PNPM), ("python3", interpreter)):
        # The execute bit is what puts a stub ahead of the real tool on PATH.
        os.chmod(write_shell(stubs / name, text), 0o755)
    below_floor = stubs / "below-floor"
    below_floor.mkdir()
    os.chmod(write_shell(below_floor / "python3", STUB_BELOW_FLOOR), 0o755)
    return Fixture(verify=root / "scripts" / "gate" / "verify.sh", stubs=stubs, started=stubs / "started", below_floor=below_floor)


@cache
def _run(*flags: str, fails: str = "", ci: bool = False, below_floor: bool = False) -> tuple[subprocess.CompletedProcess[str], tuple[str, ...]]:
    """One gate run over the fixture, its streams beside one row per tool the run started.

    Cached on every argument: the cases below share their runs, and each costs a second.
    """
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    fixture = _fixture()
    if fixture.started.exists():
        shutil.rmtree(fixture.started)
    fixture.started.mkdir(parents=True)
    environment = base_env()
    # Decided here, never inherited: a parent shell exporting `CI` would give both arms of
    # `test_a_developer_shell_exporting_ci_runs_the_local_gate` the same value, and it could not fail.
    environment.pop("CI", None)
    if ci:
        environment["CI"] = "1"
    environment["PATH"] = str(fixture.stubs) + os.pathsep + environment["PATH"]
    if below_floor:
        environment["PATH"] = str(fixture.below_floor) + os.pathsep + environment["PATH"]
    environment["FL_STUB_LOG"] = str(fixture.started)
    environment["FL_STUB_FAIL"] = fails
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


def test_the_two_forms_read_alike_on_the_failure_path_too() -> None:
    """A green comparison exercises `quietly`'s discarding arm alone.

    Failing, the forms reconcile a replayed capture against their ledger rows, which is where a
    pooled run can drift from the serial one and no green run would say so.
    """
    streamed, _ = _run(FLAGS, "--verbose", fails=FAILING_TOOL)
    pooled, started = _run(FLAGS, fails=FAILING_TOOL)
    serial, _ = _run(FLAGS, "--serial", fails=FAILING_TOOL)
    for form, done in (("verbose", streamed), ("pooled", pooled), ("serial", serial)):
        # 1, not 2: a tool that ran and answered is a finding about the tree, and a form answering
        # anything else here is comparing runs that failed for different reasons.
        assert done.returncode == 1, f"the {form} form answered {done.returncode}:\n{done.stdout}{done.stderr}"
        assert WHAT_IT_WROTE in done.stdout + done.stderr, f"the {form} form dropped the failing tool's own output"
    assert any(row.startswith("worker=1") for row in started), "no pool ran, so this compared one form with itself"
    for stream, one, two in (("stdout", pooled.stdout, serial.stdout), ("stderr", pooled.stderr, serial.stderr)):
        drift = "\n".join(difflib.unified_diff(_masked(one).splitlines(), _masked(two).splitlines(), "pooled", "serial"))
        assert not drift, f"the two forms' {stream} differ on the failure path:\n{drift}"


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


def test_a_developer_shell_exporting_ci_runs_the_local_gate() -> None:
    """Only `GITHUB_ACTIONS` names a runner, and many developer shells export `CI`.

    A gate keyed on `CI` drops the implied scopes and the pool locally and still ends green.
    """
    bare, bare_started = _run(FLAGS)
    exported, exported_started = _run(FLAGS, ci=True)
    assert bare.returncode == 0, bare.stdout + bare.stderr
    assert exported.returncode == 0, exported.stdout + exported.stderr
    # The diff below compares the whole announcement; this is its premise, that there is one.
    assert any(PAST_THE_GUARD in line for line in bare.stdout.splitlines()), (
        f"the bare run announced no scopes, so nothing here compares them:\n{bare.stdout}"
    )
    assert any(row.startswith("worker=1") for row in bare_started), "the bare run started no pool to compare"
    assert any(row.startswith("worker=1") for row in exported_started), "exporting CI turned the scope pool off"
    for stream, one, two in (("stdout", bare.stdout, exported.stdout), ("stderr", bare.stderr, exported.stderr)):
        drift = "\n".join(difflib.unified_diff(_masked(one).splitlines(), _masked(two).splitlines(), "bare", "CI=1"))
        assert not drift, f"exporting CI changed the run's {stream}:\n{drift}"


# What the gate prints where a pool it would start has no interpreter at the checkers' floor.
FALLBACK_NOTICE: Final = "no python at the checkers' floor"


def test_a_run_no_pool_serves_says_nothing_of_the_pool_fallback() -> None:
    """A scope running one body loses nothing to the fallback, and a notice there reads as a run slowed down."""
    alone, _ = _run("--format", below_floor=True)
    assert alone.returncode == 0, alone.stdout + alone.stderr
    assert FALLBACK_NOTICE not in alone.stdout, alone.stdout


def test_a_run_a_pool_serves_names_the_pool_fallback() -> None:
    """The contrast the case above needs: two scopes open the scope pool, so the fallback costs their sum."""
    pair, _ = _run("--format", "--frontend-units", below_floor=True)
    assert pair.returncode == 0, pair.stdout + pair.stderr
    assert FALLBACK_NOTICE in pair.stdout, pair.stdout


# `start_steps --<scope>` in a section, and the condition naming the scopes that pool.
STARTS_STEPS_RE: Final = re.compile(r"^\s*start_steps --([a-z-]+)", re.MULTILINE)
POOLED_SCOPES_RE: Final = re.compile(r"^if \(\( ! \(([^)]*)\) \)\); then STEP_JOBS=0; fi$", re.MULTILINE)


def test_the_scopes_named_as_pooling_are_the_ones_that_start_steps() -> None:
    """A scope added to the pool and not to the list runs its checks one at a time, and nothing says so."""
    gate = (Path(__file__).resolve().parent.parent / "gate" / "verify.sh").read_text(encoding="utf-8")
    listed = POOLED_SCOPES_RE.search(gate)
    assert listed is not None, "verify.sh no longer names the scopes that pool in one condition"
    named = {name.strip().removeprefix("RUN_").lower().replace("_", "-") for name in listed[1].split("||")}
    assert named == set(STARTS_STEPS_RE.findall(gate)), (named, sorted(set(STARTS_STEPS_RE.findall(gate))))
