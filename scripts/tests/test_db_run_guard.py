"""SCRIPTS · the claim that keeps a second db-tier run from starting beside the first.

`scripts/gate/verify.sh :: claim_db_run` and `:: take_db_run` decide, before `pytest -m db` opens a
container, whether this process is the only db tier on the machine -- the failure two of them
report, and why the answer owed is a refusal at 2 rather than a wait, are `docs/ops/spec.md` §1.6's.
Both are lifted out of verify.sh and driven against a claim directory under `tmp_path`, sourcing the
gate being a whole gate run. `scripts/gate/verify.sh :: gate_exit` is lifted with them for the
other half of the contract:
the run that took the claim is the run that gives it back, and a run refused for someone else's
claim gives back nothing.
"""

from __future__ import annotations

import re
import shutil
import tempfile
from pathlib import Path
from typing import Final

from conftest import base_env, lift_function, run_shell, write_shell

SCRIPTS: Final = Path(__file__).resolve().parent.parent
REPO_ROOT: Final = SCRIPTS.parent
LIB: Final = SCRIPTS / "lib" / "_lib.sh"
VERIFY: Final = SCRIPTS / "gate" / "verify.sh"

# Not a skip condition, for `scripts/tests/test_exit_contract.py :: BASH`'s reason: a machine with no
# bash cannot run the gate at all, so a contract silently skipped here is the failure this file
# exists to stop.
BASH: Final = shutil.which("bash")

CLAIM: Final[tuple[str, ...]] = ("take_db_run", "claim_db_run")
RECLAIM: Final[tuple[str, ...]] = (*CLAIM, "gate_exit")

# Reported one per line, so a case reads the state the shell held rather than a formatted sentence.
REPORT: Final = 'printf "marker=%s\\n" "$DB_RUN_MARKER"\nprintf "pid=%s\\n" "$$"\nprintf "held=%s\\n" "$(cat "${DB_RUN_DIR}/pid")"'

# A claim already standing, taken by a pid this shell knows is alive because it is its own.
HELD_BY_A_LIVE_PID: Final = 'mkdir -p "$DB_RUN_DIR"\nprintf "%s\\n" "$$" > "${DB_RUN_DIR}/pid"'

# A claim standing in the name of a pid this shell knows is gone, having started and reaped it.
ABANDONED: Final = "\n".join(
    (
        "sleep 0 &",
        "gone=$!",
        'wait "$gone" || true',
        'mkdir -p "$DB_RUN_DIR"',
        'printf "%s\\n" "$gone" > "${DB_RUN_DIR}/pid"',
    )
)


def _run(body: str, marker: Path, *, lifted: tuple[str, ...] = CLAIM, trap: bool = False) -> tuple[int, str]:
    """One fixture shell: `_lib.sh`, the lifted claim, and the two variables it reads."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    with tempfile.TemporaryDirectory() as scratch:
        fixture = Path(scratch) / "parent.sh"
        lines = [
            "#!/usr/bin/env bash",
            f'source "{LIB.as_posix()}"',
            f'DB_RUN_DIR="{marker.as_posix()}"',
            'DB_RUN_MARKER=""',
            "POOL_DIRS=()",
            'STEP_UNIT=""',
            "cleanup() { :; }",
            # `scripts/gate/verify.sh :: step_worker` is one line and `lift_function` reads a
            # function by its closing line, so this one is written out rather than lifted.
            'step_worker() { [[ -n "$STEP_UNIT" ]]; }',
            *(lift_function(VERIFY, name) for name in lifted),
        ]
        if trap:
            lines.append("trap gate_exit EXIT")
        lines += [body, ""]
        done = run_shell(BASH, write_shell(fixture, "\n".join(lines)), env=base_env())
    return done.returncode, done.stdout + done.stderr


def _reported(output: str) -> dict[str, str]:
    """Every `key=value` line a fixture printed, read out of the gate's own output around them."""
    # Matched whole: every line the gate writes carries a marker and an indent, so a partial match
    # would read a value out of the gate's own prose as though a case had reported it.
    matched = (re.fullmatch(r"([a-z]+)=(.*)", line) for line in output.splitlines())
    return {found.group(1): found.group(2) for found in matched if found is not None}


def test_the_first_claim_takes_the_directory_and_records_its_own_pid(tmp_path: Path) -> None:
    marker = tmp_path / "db-run"
    rc, out = _run(f"claim_db_run\n{REPORT}", marker)
    assert rc == 0, out
    state = _reported(out)
    assert state["marker"] == marker.as_posix(), out
    # The pid is what the next run's staleness question is asked about, so it is the claim's whole
    # content and an unrecorded one would make every later claim read as abandoned.
    assert state["held"] == state["pid"], out


def test_a_second_claim_refuses_at_two_while_the_holder_is_alive(tmp_path: Path) -> None:
    """The whole subject: a refusal naming the holder, never a wait and never a finding.

    Exit 2 rather than 1 is `.claude/CLAUDE.md` §7 **exit codes** — the tier did not run, so
    nothing here is a verdict on the change.
    """
    marker = tmp_path / "db-run"
    rc, out = _run(f"{HELD_BY_A_LIVE_PID}\nclaim_db_run\n{REPORT}", marker)
    assert rc == 2, out
    assert marker.as_posix() in out, out
    assert "rm -rf" in out, out
    # Untouched: the refused run must hand the holder back exactly what it found.
    assert (marker / "pid").read_text(encoding="utf-8").strip().isdigit(), out


def test_a_claim_over_a_directory_holding_no_pid_refuses_rather_than_reclaiming(tmp_path: Path) -> None:
    """A claim between its own mkdir and its write looks identical to an abandoned one.

    Reading it as abandoned would let a second run delete a claim seconds old, which is the
    collision this guard exists to refuse.
    """
    marker = tmp_path / "db-run"
    rc, out = _run('mkdir -p "$DB_RUN_DIR"\nclaim_db_run', marker)
    assert rc == 2, out
    assert marker.is_dir()


def test_a_claim_left_by_a_dead_pid_is_reported_and_taken_over(tmp_path: Path) -> None:
    marker = tmp_path / "db-run"
    rc, out = _run(f"{ABANDONED}\nclaim_db_run\n{REPORT}", marker)
    assert rc == 0, out
    assert "was left behind by pid" in out, out
    state = _reported(out)
    assert state["marker"] == marker.as_posix(), out
    assert state["held"] == state["pid"], out


def test_a_second_run_clearing_the_same_abandoned_claim_refuses_rather_than_joining(tmp_path: Path) -> None:
    """Two runs reading one dead pid: a takeover deleting and re-creating would let both through.

    `rm -rf` on a path already gone succeeds, so the loser would take the claim the winner holds.
    """
    marker = tmp_path / "db-run"
    other = marker.with_name(marker.name + ".other")
    # `warn` is the seam: the takeover announces itself there, between the staleness verdict and
    # the rename, which is the window the run further along moves the claim aside in.
    hook = f'warn() {{ mv "$DB_RUN_DIR" "{other.as_posix()}"; }}'
    rc, out = _run(f"{ABANDONED}\n{hook}\nclaim_db_run", marker, lifted=RECLAIM, trap=True)
    assert rc == 2, out
    assert not marker.exists(), out
    # The winner's claim, untouched: the loser reclaims nothing, having taken nothing.
    assert (other / "pid").is_file(), out


def test_a_claim_whose_pid_write_fails_is_given_back_rather_than_left_standing(tmp_path: Path) -> None:
    """A claim whose pid never lands is one no later run may take: an unreadable pid reads as held.

    The marker is therefore set between the `mkdir` and the write rather than after both.
    """
    marker = tmp_path / "db-run"
    # A directory where the pid file goes, so the write inside `take_db_run` cannot land.
    hook = 'mkdir() { command mkdir "$@" && command mkdir "$1/pid"; }'
    rc, out = _run(f"{hook}\nclaim_db_run", marker, lifted=RECLAIM, trap=True)
    assert rc == 2, out
    assert "could not write a pid" in out, out
    assert not marker.exists(), out


def test_the_run_that_took_the_claim_gives_it_back_on_exit(tmp_path: Path) -> None:
    marker = tmp_path / "db-run"
    rc, out = _run("claim_db_run", marker, lifted=RECLAIM, trap=True)
    assert rc == 0, out
    assert not marker.exists(), out


def test_a_refused_run_leaves_the_claim_it_could_not_take_standing(tmp_path: Path) -> None:
    """The reclaim keys on what this run took, never on the directory being there.

    A refused run reclaiming by name would free the machine for a third run while the tier it
    refused for is still going.
    """
    marker = tmp_path / "db-run"
    rc, out = _run(f"{HELD_BY_A_LIVE_PID}\nclaim_db_run", marker, lifted=RECLAIM, trap=True)
    assert rc == 2, out
    assert (marker / "pid").is_file(), out


def test_the_claim_directory_sits_outside_every_checkout() -> None:
    """One machine's claim: the daemon and the reaper two db tiers collide over are the host's.

    A path under the repository would be one claim per checkout, which refuses nothing between two
    clones on one machine.
    """
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    source = VERIFY.read_text(encoding="utf-8")
    found = re.search(r'^DB_RUN_DIR="(?P<value>[^"]+)"$', source, re.MULTILINE)
    assert found is not None, "scripts/gate/verify.sh must declare DB_RUN_DIR as one quoted value"
    declared = found.group("value")
    # The name as well as the directory: a claim keyed on the checkout's path is per checkout
    # wherever it is written.
    assert "REPO_ROOT" not in declared, declared
    with tempfile.TemporaryDirectory() as scratch:
        # Resolved by a shell and not by Python: the declaration is a shell expansion, and Git Bash
        # spells the answer in a path space of its own.
        probe = Path(scratch) / "outside.sh"
        lines = (
            "#!/usr/bin/env bash",
            "set -u",
            f'repo="$(cd "{REPO_ROOT.as_posix()}" && pwd)"',
            f'claim="{declared}"',
            'mkdir -p "$(dirname "$claim")"',
            'parent="$(cd "$(dirname "$claim")" && pwd)"',
            'case "${parent}/" in "${repo}"/*) printf "where=inside\\n" ;; *) printf "where=outside\\n" ;; esac',
            "",
        )
        done = run_shell(BASH, write_shell(probe, "\n".join(lines)), env=base_env())
    assert done.returncode == 0, done.stdout + done.stderr
    assert _reported(done.stdout)["where"] == "outside", done.stdout + done.stderr
