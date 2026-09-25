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

import pytest
from conftest import BASH, base_env, copy_scripts, new_root, run_shell, write, write_shell
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
if [[ -n "${FL_STUB_REFUSE:-}" && "${1:-}" == "${FL_STUB_REFUSE}" ]]; then
  printf '%s\\n' "[ERR_PNPM_VERIFY_DEPS_BEFORE_RUN] The lockfile does not satisfy project of id ."
  exit 1
fi
if [[ -n "${FL_STUB_QUOTE:-}" && "${1:-}" == "${FL_STUB_QUOTE}" ]]; then
  printf '%s\\n' "the stub ran ${1}" "a failing case expected [ERR_PNPM_VERIFY_DEPS_BEFORE_RUN] in its output"
  exit 1
fi
if [[ -n "${FL_STUB_CRASH:-}" && "${1:-}" == "${FL_STUB_CRASH}" ]]; then
  printf '%s\\n' "the stub crashed ${1}"
  exit 3
fi
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

STUB_CROSSINGS: Final = 'print("the stub held every arm to its read")\n'

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
    # Where the gate's `mktemp` puts a pool's captures, so a case can read one a run kept.
    scratch: Path


@cache
def _fixture() -> Fixture:
    root = new_root("fl-gate-forms-")
    copy_scripts(root / "scripts")
    # `do_prettier` and every frontend body `cd` here before running their tool.
    (root / "fl_frontend").mkdir()
    # Empty: the gate's preflight refuses a frontend scope without it, and the stub reads nothing
    # from it.
    (root / "fl_frontend" / "node_modules").mkdir()
    # The frontend scope runs the scope mapping's crossing cases out of a suite the copy leaves out,
    # over two packages the fixture does not hold.
    write(root, "scripts/tests/test_scope_decisions.py", STUB_CROSSINGS)

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
    scratch = stubs / "tmp"
    scratch.mkdir()
    return Fixture(
        verify=root / "scripts" / "gate" / "verify.sh", stubs=stubs, started=stubs / "started", below_floor=below_floor, scratch=scratch
    )


@cache
def _run(
    *flags: str, fails: str = "", refuses: str = "", crashes: str = "", quotes: str = "", ci: bool = False, below_floor: bool = False
) -> tuple[subprocess.CompletedProcess[str], tuple[str, ...]]:
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
    environment["FL_STUB_REFUSE"] = refuses
    environment["FL_STUB_CRASH"] = crashes
    environment["FL_STUB_QUOTE"] = quotes
    environment["TMPDIR"] = fixture.scratch.as_posix()
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


# What the one `annotate` checker says on a pass: its scanned population, which a captured run
# replays because `quietly` prints nothing of a passing tool.
POPULATION: Final = "scanned the stub's one document"

# The backend virtualenv's interpreter, answering the documentation scope: its version at the
# checkers' floor, the population for `check_docs.py`, and silence for every other checker.
STUB_VENV_PYTHON: Final = """#!/usr/bin/env bash
case "${{1:-}}" in
  --version) printf '%s\\n' "Python {major}.{minor}.0" ;;
  scripts/checks/check_docs.py) printf '%s\\n' "{population}" ;;
esac
exit 0
"""

# The virtualenv's currency check, which a fixture holding no lockfile would otherwise refuse.
STUB_UV: Final = """#!/usr/bin/env bash
exit 0
"""


def _venv_root(prefix: str, interpreter_text: str, **fields: str) -> tuple[Path, dict[str, str]]:
    """A copy of `scripts/` whose virtualenv interpreter is a stub, with `uv`'s currency check stubbed too."""
    root = new_root(prefix)
    copy_scripts(root / "scripts")
    # The POSIX spelling, which `scripts/lib/_lib.sh :: venv_python` also takes on Windows, where
    # a shebang script cannot stand in for a `.exe`.
    interpreter = root / "fl_backend" / ".venv" / "bin" / "python"
    interpreter.parent.mkdir(parents=True)
    version = sys.version_info
    os.chmod(write_shell(interpreter, interpreter_text.format(major=version.major, minor=version.minor, **fields)), 0o755)
    stubs = new_root(prefix + "stubs-")
    os.chmod(write_shell(stubs / "uv", STUB_UV), 0o755)
    environment = base_env()
    environment["PATH"] = str(stubs) + os.pathsep + environment["PATH"]
    return root, environment


def test_a_passing_annotate_checker_prints_its_population_once_under_verbose() -> None:
    """`quietly` streams the line under `--verbose`, and `run_checker`'s replay of it is guarded off there.

    Drop that guard and the line prints twice, which no other case here reads.
    """
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root, environment = _venv_root("fl-gate-annotate-", STUB_VENV_PYTHON, population=POPULATION)
    for flags, form in ((("--docs", "--verbose"), "streamed"), (("--docs", "--serial"), "captured")):
        done = run_shell(BASH, root / "scripts" / "gate" / "verify.sh", *flags, env=environment)
        assert done.returncode == 0, done.stdout + done.stderr
        # The captured form is the control: a count of 1 there is the replay this guard keeps off
        # the streamed form, so a stub that stopped printing fails here rather than passing both.
        assert (done.stdout + done.stderr).count(POPULATION) == 1, f"the {form} form:\n{done.stdout}{done.stderr}"


# The unit test runner's own subcommand: `do_unit_tests` runs `pnpm test` with the shard's patterns.
UNIT_TESTS: Final = "test"


# One subcommand per kind of call site passing `quietly --pnpm`: a direct step, a writer, a pooled
# unit's verdict and the audit's own replay. The audit's failure is an advisory, so its control is 0.
@pytest.mark.parametrize(
    ("scope", "subcommand", "failed"),
    [
        ("--format", "format:check", 1),
        ("--frontend-units", UNIT_TESTS, 1),
        ("--frontend", "typegen", 1),
        ("--frontend", "typecheck:only", 1),
        ("--frontend", "audit:prod", 0),
    ],
)
def test_pnpm_s_dependency_check_stopping_a_step_refuses_rather_than_failing(scope: str, subcommand: str, failed: int) -> None:
    """Exit 2: pnpm stopped the script before it ran, so the step judged nothing (`.claude/CLAUDE.md` §7 **exit codes**).

    The same subcommand failing on its own is the control: a runner refusing every stop passes nothing.
    """
    refused, _ = _run(scope, refuses=subcommand)
    output = refused.stdout + refused.stderr
    assert refused.returncode == 2, output
    assert "pnpm's dependency check stopped this step" in output and "cd fl_frontend && pnpm install" in output, output
    assert "finding(s) in this run" not in output, output
    control, _ = _run(scope, fails=subcommand)
    assert control.returncode == failed, control.stdout + control.stderr


def test_a_pnpm_script_that_ran_and_failed_quoting_the_refusal_code_is_a_failure() -> None:
    """Exit 1: the script started, so pnpm's check let it through, whatever its own output says after."""
    done, _ = _run("--frontend-units", quotes=UNIT_TESTS)
    output = done.stdout + done.stderr
    assert done.returncode == 1, output
    assert "pnpm's dependency check stopped this step" not in output, output


# A checker that is no pnpm script, failing with output that quotes the dependency check's code: a
# case asserting on a stub's refusal prints exactly that.
STUB_QUOTING_PYTHON: Final = """#!/usr/bin/env bash
case "${{1:-}}" in
  --version) printf '%s\\n' "Python {major}.{minor}.0" ;;
  scripts/checks/check_docs.py) printf '%s\\n' "a finding quoting [ERR_PNPM_VERIFY_DEPS_BEFORE_RUN]"; exit 1 ;;
esac
exit 0
"""


def test_a_failing_check_quoting_pnpm_s_refusal_code_is_a_failure() -> None:
    """Exit 1: only a step that started a pnpm script can have been stopped by pnpm's dependency check."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root, environment = _venv_root("fl-gate-quoting-", STUB_QUOTING_PYTHON)
    # Serial: the stub interpreter would also be handed the pool's driver, and runs nothing.
    done = run_shell(BASH, root / "scripts" / "gate" / "verify.sh", "--docs", "--serial", env=environment)
    output = done.stdout + done.stderr
    assert done.returncode == 1, output
    assert "pnpm's dependency check stopped this step" not in output, output


# The db scope under stubs: Docker answering its version, the interpreter passing pytest, and pnpm
# refusing `run`, the subcommand `do_frontend_db` starts `test:db` through.
STUB_DOCKER: Final = """#!/usr/bin/env bash
printf '%s\\n' "27.0.0"
exit 0
"""
STUB_DB_PYTHON: Final = """#!/usr/bin/env bash
case "${{1:-}}" in
  --version) printf '%s\\n' "Python {major}.{minor}.0" ;;
esac
exit 0
"""


def test_pnpm_s_dependency_check_stopping_the_db_tier_ends_the_run_once_as_a_refusal() -> None:
    """Exit 2, and no crash after it: a refusal ending a subshell alone left the gate to read its 2 as a crash."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root, environment = _venv_root("fl-gate-db-refusal-", STUB_DB_PYTHON)
    (root / "fl_frontend" / "node_modules").mkdir(parents=True)
    stubs = Path(environment["PATH"].split(os.pathsep)[0])
    for name, text in (("docker", STUB_DOCKER), ("pnpm", STUB_PNPM)):
        os.chmod(write_shell(stubs / name, text), 0o755)
    log = stubs / "started"
    log.mkdir()
    environment["FL_STUB_LOG"] = str(log)
    environment["FL_STUB_FAIL"] = ""
    environment["FL_STUB_REFUSE"] = "run"
    # The tier's claim under the fixture's own directory, never the machine's.
    environment["TMPDIR"] = str(root)
    done = run_shell(BASH, root / "scripts" / "gate" / "verify.sh", "--db", env=environment)
    output = done.stdout + done.stderr
    assert done.returncode == 2, output
    assert "pnpm's dependency check stopped this step" in output, output
    assert "Crashed" not in output, output


KEPT: Final = re.compile(r"kept for reading, as this crash left it: (\S+)")
# Read through bash, whose spelling of the path the gate prints: on Windows that is an MSYS path no
# Python call resolves. The directory is reclaimed once read, as the gate would have done.
READ_KEPT: Final = """#!/usr/bin/env bash
cat -- "$1/manifest.tsv" && rm -rf -- "$1"
"""


def test_a_crashed_run_keeps_its_pool_captures_and_names_each_one() -> None:
    """A crash's evidence is the pool's own record, so the exit that ends it must not delete it.

    A run ending on findings is the control: every other ending still reclaims its directories.
    """
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    reader = write_shell(_fixture().stubs / "read-kept.sh", READ_KEPT)
    crashed, _ = _run(FLAGS, crashes="typecheck:only")
    output = crashed.stdout + crashed.stderr
    manifests = [run_shell(BASH, reader, found) for found in KEPT.findall(output)]
    assert crashed.returncode == 3, output
    assert manifests, output
    for read in manifests:
        assert read.returncode == 0, f"a directory was named and not kept:\n{read.stderr}\n{output}"
    assert any("typecheck" in read.stdout for read in manifests), output
    failed, _ = _run(FLAGS, fails="typecheck:only")
    assert failed.returncode == 1, failed.stdout + failed.stderr
    assert not KEPT.search(failed.stdout + failed.stderr), failed.stdout + failed.stderr


CRASHED_ROW: Final = re.compile(r"^ +frontend +\S*crashed", re.MULTILINE)


def test_a_scope_crashing_past_an_earlier_failure_still_names_what_it_kept() -> None:
    """The run ends at the format scope's failure, and the frontend scope's crash is read after it.

    Its worker kept its pool directory; unnamed in the parent's output, that directory outlives the
    run with nobody told it exists.
    """
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    reader = write_shell(_fixture().stubs / "read-kept.sh", READ_KEPT)
    done, _ = _run(FLAGS, fails="format:check", crashes="typecheck:only")
    output = done.stdout + done.stderr
    manifests = [run_shell(BASH, reader, found) for found in KEPT.findall(output)]
    assert done.returncode == 1, output
    assert "the frontend scope crashed with status 3" in output, output
    assert any(read.returncode == 0 and "typecheck" in read.stdout for read in manifests), output
    # Its row says what it did, and costs no finding of its own: the format scope's is the one.
    assert CRASHED_ROW.search(done.stdout), output
    assert "closed with no verdict" not in output, output
    assert "1 finding(s) in this run" in output, output
