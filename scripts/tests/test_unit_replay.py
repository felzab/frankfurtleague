"""SCRIPTS · what a pooled run's parent makes of a unit that reached no verdict.

`scripts/verify.sh :: unit_replay`, `:: unit_verdict`, `:: adopt_finished` and `:: pool_wait` all
read a worker's handoff, and a status the pool could not report has to reach a caller as a crash
rather than as the byte `return` would mask it to or as a scope quietly missing from the table.
Each is lifted out of verify.sh and evaluated here, sourcing it being a whole gate run.
"""

from __future__ import annotations

import ast
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Final

SCRIPTS: Final = Path(__file__).resolve().parent.parent
LIB: Final = SCRIPTS / "_lib.sh"
VERIFY: Final = SCRIPTS / "verify.sh"

# Not a skip condition, for `test_exit_contract.py`'s reason: a machine with no bash cannot run the
# gate at all, so a contract silently skipped here is the failure this file exists to stop.
BASH: Final = shutil.which("bash")

# The step-level pair, which most cases below want. `adopt_finished` and `pool_wait` are asked for
# by name instead, the first sitting inside the block that runs only outside a worker.
STEP_READERS: Final[tuple[tuple[str, str], ...]] = (("unit_replay", ""), ("unit_verdict", ""))


def _lifted(name: str, indent: str = "") -> str:
    """One function out of verify.sh, by its opening and closing lines, dedented to the margin.

    Read rather than reimplemented: a copy would pass while the gate's own regressed. A rename
    matches nothing, which fails loudly rather than testing nothing.
    """
    lines = VERIFY.read_text(encoding="utf-8").splitlines()
    start = next((i for i, line in enumerate(lines) if line.startswith(f"{indent}{name}() {{")), -1)
    assert start >= 0, f"scripts/verify.sh no longer defines {name}"
    end = next((i for i in range(start + 1, len(lines)) if lines[i] == f"{indent}}}"), -1)
    assert end > start, f"scripts/verify.sh's {name} has no closing line"
    return "\n".join(line.removeprefix(indent) for line in lines[start : end + 1])


def _not_started() -> str:
    """`scripts/gate_pool.py :: NOT_STARTED`, read out of the source rather than spelled again.

    The manifest's word for a unit that never ran is the one value no exit code may collide with,
    so the coupling is asserted rather than remembered.
    """
    source = (SCRIPTS / "gate_pool.py").read_text(encoding="utf-8")
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.AnnAssign) and node.value is not None and getattr(node.target, "id", "") == "NOT_STARTED":
            return str(ast.literal_eval(node.value))
    raise AssertionError("scripts/gate_pool.py no longer declares NOT_STARTED")


def _parent(
    body: str,
    *,
    lifted: tuple[tuple[str, str], ...] = STEP_READERS,
    statuses: dict[str, str] | None = None,
    captured: dict[str, str] | None = None,
    manifest: str = "",
    units: str = "",
    jobs: int = 1,
) -> tuple[int, str]:
    """One parent-side fixture: `_lib.sh`, the readers asked for, and the pool state left on disk."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    env = {name: value for name, value in os.environ.items() if not name.startswith("FL_GATE_")}
    env.pop("GITHUB_ACTIONS", None)
    env.pop("VERBOSE", None)
    env["FL_GATE_COLOR"] = "0"
    env["NO_SPINNER"] = "1"
    with tempfile.TemporaryDirectory() as scratch:
        pool = Path(scratch) / "pool"
        pool.mkdir()
        # Bytes throughout, because a Windows text-mode write turns every newline into a carriage
        # return pair, and these are read back by `cat` and by a tab-splitting `read`.
        for unit, text in (captured or {}).items():
            (pool / f"{unit}.out").write_bytes(text.encode("utf-8"))
        if units:
            (pool / "units.tsv").write_bytes(units.encode("utf-8"))
        if manifest:
            (pool / "manifest.tsv").write_bytes(manifest.encode("utf-8"))
        rows = " ".join(f'[{unit}]="{status}"' for unit, status in (statuses or {}).items())
        fixture = Path(scratch) / "parent.sh"
        lines = (
            "#!/usr/bin/env bash",
            f'source "{LIB.as_posix()}"',
            f"STEP_JOBS={jobs}",
            f'POOL_DIR="{pool.as_posix()}"',
            f"declare -A UNIT_STATUS=({rows})",
            "declare -A UNIT_MS=()",
            *(_lifted(name, indent) for name, indent in lifted),
            body,
            "",
        )
        with fixture.open("w", encoding="utf-8", newline="") as handle:
            handle.write("\n".join(lines))
        done = subprocess.run(
            (BASH, fixture.as_posix()),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            check=False,
        )
    return done.returncode, done.stdout + done.stderr


REPLAY: Final = 'rc=0; unit_replay demo || rc=$?; printf "rc=%s\\n" "$rc"'


def test_with_no_pool_the_replay_is_the_check_itself() -> None:
    """One call site for both forms: `--serial` must take the path the gate has always taken."""
    code, output = _parent('do_demo() { printf "ran\\n"; return 7; }\n' + REPLAY, jobs=0)
    assert code == 0, output
    assert "ran" in output, output
    assert "rc=7" in output, output


def test_a_unit_the_manifest_never_answered_for_is_a_crash() -> None:
    code, output = _parent(REPLAY)
    assert "rc=3" in output, output
    assert "did not run to completion" in output, output


def test_a_unit_left_at_not_started_is_a_crash_rather_than_a_verdict() -> None:
    """No exit code may spell `NOT_STARTED`, so the manifest's own word has to fail the numeric test."""
    marker = _not_started()
    assert not marker.isdigit(), f"NOT_STARTED is {marker!r}, which an exit status could carry"
    code, output = _parent(REPLAY, statuses={"demo": marker})
    assert "rc=3" in output, output
    assert marker in output, output


def test_a_kill_is_classified_before_return_masks_it_to_a_byte() -> None:
    """2304 is what a killed worker reports on Windows, and the byte it masks to is a pass."""
    assert 2304 % 256 == 0
    code, output = _parent(REPLAY, statuses={"demo": "2304"})
    assert "rc=3" in output, output
    assert "a kill rather than a verdict" in output, output


def test_a_unit_that_passed_replays_its_own_output() -> None:
    code, output = _parent(REPLAY, statuses={"demo": "0"}, captured={"demo": "the check said this\n"})
    assert "the check said this" in output, output
    assert "rc=0" in output, output


VERDICT: Final = 'section demo\nunit_verdict demo "${LINENO}" "the remedy"'


def test_a_verdict_grades_every_status_the_pool_can_hand_it() -> None:
    """A status with no arm of its own reaches `on_error`, which floors it at the crash code."""
    wrong: list[str] = []
    for status, expected in (("0", 0), ("1", 1), ("130", 130), ("4", 4), ("2", 3), ("2304", 3)):
        code, output = _parent(VERDICT, statuses={"demo": status})
        if code != expected:
            wrong.append(f"a unit at status {status} graded {code}, and the contract gives it {expected}")
        if status == "1" and "the remedy" not in output:
            wrong.append("a failing unit printed no remedy")
    assert not wrong, "\n".join(wrong)


# --- the readers the parent runs once every scope has finished ---------------------------------------

ADOPT: Final[tuple[tuple[str, str], ...]] = (("adopt_finished", "  "),)
POOL: Final[tuple[tuple[str, str], ...]] = (("pool_wait", ""),)


def test_a_scope_that_reached_no_verdict_keeps_a_row_in_the_table() -> None:
    """Adopting nothing drops the scope out of the table and reports a section fewer than the run had.

    A killed worker is the case: its rows say nothing, so the row has to be rank 0 rather than
    absent, and `finish` turns that into a verdict.
    """
    code, output = _parent("adopt_finished ops\nfinish", lifted=ADOPT, statuses={"ops": "137"})
    assert "ops" in output, "the killed scope left no row at all: " + output
    assert code == 1, f"a scope that proved nothing exited {code}: {output}"
    assert "closed with no verdict" in output, output


def test_a_scope_the_pool_judged_is_adopted_from_its_own_rows() -> None:
    """Its twin: without it the case above would pass for an arm that ranks every scope 0."""
    body = 'adopt_rows() { adopt_section "$1" 2 10 0 0; }\nadopt_finished ops\nfinish'
    code, output = _parent(body, lifted=ADOPT, statuses={"ops": "0"})
    assert code == 0, f"a scope its own rows judged exited {code}: {output}"
    assert "Green" in output, output


def test_a_pool_that_left_no_manifest_is_a_crash_rather_than_a_bare_shell_complaint() -> None:
    """The redirect under it fails on its own, exiting 1 -- the code meaning "fix the change" -- silently.

    `POOL_PY` is `true`, so the pool answers 0 and writes nothing: a run that looked like it
    succeeded and left nothing to read.
    """
    code, output = _parent('POOL_PY=true\npool_wait 0 "the pool"', lifted=POOL, units="alpha\tscope\n")
    assert code == 3, f"a missing manifest exited {code}: {output}"
    assert "left no manifest" in output, output


def test_a_pool_that_left_a_manifest_is_read_from_it() -> None:
    """Its twin: a guard refusing every run would pass the case above and prove nothing."""
    body = 'POOL_PY=true\npool_wait 0 "the pool"\nprintf "alpha=%s\\n" "${UNIT_STATUS[alpha]}"'
    code, output = _parent(body, lifted=POOL, units="alpha\tscope\n", manifest="alpha\t0\t100\t250\n")
    assert code == 0, f"a complete manifest was refused: {output}"
    assert "alpha=0" in output, output


# --- the frontend scope's two phases, which the pool must never mix ---------------------------------

# `unit_replay` rides along so a writer routed through it by mistake reaches the crash path this
# file already knows, rather than an undefined-helper error that says nothing about the pool.
PHASES: Final[tuple[tuple[str, str], ...]] = (
    ("frontend_phases_disjoint", ""),
    ("run_writer", ""),
    ("unit_replay", ""),
)


def test_a_unit_named_in_both_frontend_phases_is_refused_before_anything_runs() -> None:
    """The phases are data so this can drive them: a comment saying the lists are disjoint enforces nothing."""
    wrong: list[str] = []
    for pool, writers, expected in (
        ("typecheck eslint audit", "typegen next_build", 0),
        ("typecheck eslint typegen", "typegen next_build", 3),
    ):
        body = f"FRONTEND_POOL=({pool})\nFRONTEND_WRITERS=({writers})\nfrontend_phases_disjoint\nprintf 'reached\\n'"
        code, output = _parent(body, lifted=PHASES)
        if code != expected:
            wrong.append(f"pool [{pool}] against writers [{writers}] exited {code}, and the contract gives it {expected}")
        if expected == 3 and "typegen" not in output:
            wrong.append("the refusal did not name the unit standing in both lists")
        if expected == 0 and "reached" not in output:
            wrong.append("disjoint lists stopped the run")
    assert not wrong, "\n".join(wrong)


def test_a_writer_runs_in_place_while_the_pool_is_open() -> None:
    """A writer of tsconfig.json never enters the pool, so with STEP_JOBS=1 and no status for it the body itself must run."""
    body = (
        'do_typegen() { printf "ran\\n"; return 7; }\n'
        "FRONTEND_POOL=(typecheck)\nFRONTEND_WRITERS=(typegen)\n"
        "rc=0; run_writer typegen || rc=$?\n"
        'printf "rc=%s STEP_JOBS=%s\\n" "$rc" "$STEP_JOBS"'
    )
    code, output = _parent(body, lifted=PHASES)
    # Asserted rather than assumed: on a machine whose probe zeroed the pool, both cases below would
    # pass through the serial arm without touching the property.
    assert "STEP_JOBS=1" in output, output
    assert output.count("ran") == 1, output
    assert "did not run to completion" not in output, output
    assert "rc=7" in output, output
    # Its twin: a unit the writers list does not name is refused, so the list decides and not the call.
    code, output = _parent(
        'do_eslint() { printf "ran\\n"; }\nFRONTEND_POOL=(eslint)\nFRONTEND_WRITERS=(typegen)\nrun_writer eslint',
        lifted=PHASES,
    )
    assert code == 3, f"an unlisted writer exited {code}: {output}"
    assert "ran" not in output, output
