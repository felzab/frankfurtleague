"""SCRIPTS · the claim that keeps a second db-tier run from starting beside the first.

`scripts/gate/verify.sh :: claim_db_run` and `:: take_db_run` decide, before `pytest -m db` opens a
container, whether this process is the only db tier on the machine -- the failure two of them
report, and why the answer owed is a refusal at 2 rather than a wait, are `docs/ops/spec.md` §1.6's.
Both are lifted out of verify.sh and driven against a claim directory under `tmp_path`, sourcing the
gate being a whole gate run. `scripts/gate/verify.sh :: gate_exit` is lifted with them for the
other half of the contract:
the run that took the claim is the run that gives it back, and a run refused for someone else's
claim gives back nothing. `:: DB_RUN_LOCK` serialises the one window in which two runs decide
about a single claim, so the cases below drive that window from both ends.
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

CLAIM: Final[tuple[str, ...]] = ("pid_alive", "take_db_run", "refuse_to_the_holder", "claim_db_run")
RECLAIM: Final[tuple[str, ...]] = (*CLAIM, "gate_exit")

# The two a refusal names, printed before the call that may not return to print anything.
ANNOUNCE: Final = "\n".join(
    (
        'printf "pid=%s\\n" "$$"',
        'printf "lock=%s\\n" "$DB_RUN_LOCK"',
    )
)

# Reported one per line, so a case reads the state the shell held rather than a formatted sentence.
REPORT: Final = "\n".join(
    (
        ANNOUNCE,
        'printf "marker=%s\\n" "$DB_RUN_MARKER"',
        'printf "held=%s\\n" "$(cat "${DB_RUN_DIR}/pid")"',
    )
)

# A claim already standing, taken by a pid this shell knows is alive because it is its own.
HELD_BY_A_LIVE_PID: Final = 'mkdir -p "$DB_RUN_DIR"\nprintf "%s\\n" "$$" > "${DB_RUN_DIR}/pid"'

# What EPERM looks like to the shell: `kill -0` answers non-zero for a live process another account
# owns. Stubbed rather than run under a second account, which no suite can arrange for itself.
KILL_REFUSED: Final = "kill() { return 1; }"

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

# Another run's takeover, whole, at the seam this run announces its own at: it renames the
# abandoned claim aside, clears it, and takes the machine in a name this shell knows is alive.
A_COMPLETED_TAKEOVER: Final = "\n".join(
    (
        "warn() {",
        '  mv "$DB_RUN_DIR" "${DB_RUN_DIR}.won"',
        '  rm -rf "${DB_RUN_DIR}.won"',
        '  mkdir "$DB_RUN_DIR"',
        '  printf "%s\\n" "$$" > "${DB_RUN_DIR}/pid"',
        "}",
    )
)


def _declaration(name: str) -> str:
    """One `NAME="value"` line as verify.sh spells it, for a fixture that must not respell it.

    A path derived here instead would agree with the gate only until one of the two moved.
    """
    found = re.search(rf'^{name}="[^"]*"$', VERIFY.read_text(encoding="utf-8"), re.MULTILINE)
    assert found is not None, f"scripts/gate/verify.sh declares no {name} as one quoted value"
    return found.group(0)


def _run(body: str, marker: Path, *, lifted: tuple[str, ...] = CLAIM, trap: bool = False) -> tuple[int, str]:
    """One fixture shell: `_lib.sh`, the lifted claim, and the two variables it reads."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    with tempfile.TemporaryDirectory() as scratch:
        fixture = Path(scratch) / "parent.sh"
        lines = [
            "#!/usr/bin/env bash",
            f'source "{LIB.as_posix()}"',
            f'DB_RUN_DIR="{marker.as_posix()}"',
            # Read out of verify.sh and never spelled here: it is derived from the line above, so a
            # fixture naming its own would leave the gate's lock untested under a passing suite.
            _declaration("DB_RUN_LOCK"),
            'DB_RUN_MARKER=""',
            "POOL_DIRS=()",
            'STEP_UNIT=""',
            "cleanup() { :; }",
            lift_function(VERIFY, "step_worker"),
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

    Exit 2 rather than 1 is `.claude/CLAUDE.md` §7 **exit codes** -- the tier did not run, so
    nothing here is a verdict on the change.
    """
    marker = tmp_path / "db-run"
    rc, out = _run(f"{HELD_BY_A_LIVE_PID}\nclaim_db_run\n{REPORT}", marker)
    assert rc == 2, out
    assert marker.as_posix() in out, out
    assert "rm -rf" in out, out
    # Untouched: the refused run must hand the holder back exactly what it found.
    assert (marker / "pid").read_text(encoding="utf-8").strip().isdigit(), out


def test_a_holder_this_account_may_not_signal_is_refused_rather_than_called_gone(tmp_path: Path) -> None:
    """`kill -0` answers EPERM for a live process another account owns exactly as it answers ESRCH for one that is gone.

    Read as gone, the holder's live claim is renamed aside and the db tier starts beside it.
    """
    marker = tmp_path / "db-run"
    body = f"{HELD_BY_A_LIVE_PID}\n{KILL_REFUSED}\n{ANNOUNCE}\nclaim_db_run"
    rc, out = _run(body, marker, lifted=RECLAIM, trap=True)
    assert rc == 2, out
    state = _reported(out)
    assert f"holds {marker.as_posix()} (pid {state['pid']})" in out, out
    assert "which is gone" not in out, out
    # Nothing taken and nothing held: a run refused for a live claim may not touch either path.
    assert (marker / "pid").read_text(encoding="utf-8").strip() == state["pid"], out
    assert not Path(state["lock"]).exists(), out


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
    # Given back on the way through: a lock still standing would refuse every later takeover on
    # this machine, and nothing on the success path ever looks at it again.
    assert not Path(state["lock"]).exists(), out


def test_a_second_run_clearing_the_same_abandoned_claim_refuses_rather_than_joining(tmp_path: Path) -> None:
    """Two runs reading one dead pid: the second must not join the first.

    Deciding on the rename alone lets the straggler take the machine beside the winner, whose own
    exit then gives back the claim the straggler took.
    """
    marker = tmp_path / "db-run"
    # `warn` is the seam: the takeover announces itself there, above the lock, which is the window
    # the run further along completes the whole takeover in.
    body = f"{ABANDONED}\n{A_COMPLETED_TAKEOVER}\n{ANNOUNCE}\nclaim_db_run"
    rc, out = _run(body, marker, lifted=RECLAIM, trap=True)
    assert rc == 2, out
    state = _reported(out)
    # Named as the live holder it now is, rather than as a run clearing something.
    assert f"holds {marker.as_posix()} (pid {state['pid']})" in out, out
    # The winner's claim, untouched, and still the machine's only one: the straggler took nothing,
    # so its own trap gave nothing back.
    assert (marker / "pid").read_text(encoding="utf-8").strip() == state["pid"], out
    assert not Path(state["lock"]).exists(), out


def test_a_takeover_lock_a_killed_run_left_behind_refuses_naming_both_paths(tmp_path: Path) -> None:
    """A lock a killed run left is cleared by hand: the window it is held in is milliseconds wide.

    The refusal is therefore the whole remedy, and owes both paths and the command that clears them.
    """
    marker = tmp_path / "db-run"
    body = f'{ABANDONED}\nmkdir "$DB_RUN_LOCK"\n{ANNOUNCE}\nclaim_db_run'
    rc, out = _run(body, marker, lifted=RECLAIM, trap=True)
    assert rc == 2, out
    state = _reported(out)
    assert f"rm -rf {state['lock']} {marker.as_posix()}" in out, out
    # Both left standing: a run refused for a lock it does not hold may clear neither.
    assert Path(state["lock"]).is_dir(), out
    assert (marker / "pid").is_file(), out


def test_a_claim_this_run_cannot_rename_is_not_reported_as_another_run_clearing_it(tmp_path: Path) -> None:
    """On Linux an abandoned claim can be another account's, which no rename of this run's will move.

    The lock this run holds rules out the other reading, so the text owes the ownership and the
    remedy, not a race.
    """
    marker = tmp_path / "db-run"
    # The rename refused, which is what a sticky directory answers over another user's claim.
    hook = "mv() { return 1; }"
    body = f"{ABANDONED}\n{hook}\n{ANNOUNCE}\nclaim_db_run"
    rc, out = _run(body, marker, lifted=RECLAIM, trap=True)
    assert rc == 2, out
    assert "already clearing" not in out, out
    assert "as that user or as root" in out, out
    assert f"rm -rf {marker.as_posix()}" in out, out
    state = _reported(out)
    # Nothing taken and nothing held: the claim stands and the lock is given back.
    assert (marker / "pid").is_file(), out
    assert not Path(state["lock"]).exists(), out


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
