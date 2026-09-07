"""SCRIPTS · the worker to parent handoff, run end to end rather than asserted as literals.

A parent replays rows it never watched being produced, so a ledger that misreports a rank or a
count is replayed as truth and closes the run green over a real finding. Every case below runs a
real worker under `scripts/gate/verify.sh :: gate_exit` and `:: wrap_up`, and replays the ledger it
wrote through `:: replay_scope` and `:: adopt_rows`, all four lifted rather than written again here.

Invariants:
A worker's exit status and the rows it sent home are two accounts of one run and must agree.
`scripts/lib/_lib.sh :: emit_section_ledger` is the only producer of those rows.
"""

from __future__ import annotations

import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from conftest import base_env, lift_function, run_shell, write_shell

SCRIPTS: Final = Path(__file__).resolve().parent.parent
LIB: Final = SCRIPTS / "lib" / "_lib.sh"
VERIFY: Final = SCRIPTS / "gate" / "verify.sh"

# Not a skip condition, for `scripts/tests/test_exit_contract.py :: BASH`'s reason.
BASH: Final = shutil.which("bash")


def _lifted(name: str, indent: str = "") -> str:
    return lift_function(VERIFY, name, indent)


def _env() -> dict[str, str]:
    """`scripts/tests/conftest.py :: base_env`, minus the self-check ledger a gate run exports.

    The lifted `gate_exit` reclaims that file when the pid matches, and no fixture here owns one.
    """
    env = base_env()
    for name in ("FL_SELFCHECK_LEDGER", "FL_SELFCHECK_LEDGER_OWNER"):
        env.pop(name, None)
    return env


@dataclass(frozen=True)
class Handoff:
    """One worker run, the ledger it sent home, and the parent's replay of both."""

    name: str
    # The worker's own script, below the `source` line and above `end_worker`.
    body: tuple[str, ...]
    # Every row the worker owes its parent: rank, findings, advisories, section name. The duration
    # column is held to being a count and never to a value, being a wall clock.
    rows: tuple[tuple[int, int, int, str], ...]
    worker_code: int
    parent_code: int
    # A fragment the parent's closing statement must carry.
    says: str
    # A fragment the WORKER must have printed, for a case whose rows are empty by design: the
    # worker's own message is then the only account of why the scope was left unproven.
    worker_says: str | None = None
    # A status handed to the parent in place of the worker's own, for the one case no honest worker
    # produces: a status and rows that disagree.
    replay_as: int | None = None


HANDOFFS: Final[tuple[Handoff, ...]] = (
    Handoff("a scope that passed", ("section demo", 'ok "checked"'), ((2, 0, 0, "demo"),), 0, 0, "Green"),
    Handoff(
        "a scope that found something",
        ("section demo", "step work", 'fail "a real finding the change must fix"'),
        ((5, 1, 0, "demo"),),
        1,
        1,
        "1 finding(s) in this run",
    ),
    # The rank below is the one `scripts/lib/_lib.sh :: refuse` produced, which every parent-side
    # literal assumes instead: collapsed to a pass, the refusal reaches the parent as a green row.
    Handoff(
        "a scope that could not judge its input",
        ("section demo", 'ok "checked"', 'refuse "the input could not be judged"'),
        ((4, 0, 0, "demo"),),
        2,
        2,
        "Refused after",
    ),
    # 3 is the crash floor, where a status stops being a verdict on the change at all.
    Handoff("a scope that crashed", ("section demo", "false"), ((5, 0, 0, "demo"),), 3, 3, "Crashed after"),
    Handoff(
        "a scope that was interrupted",
        ("section demo", 'ok "checked"', "on_interrupt"),
        ((2, 0, 0, "demo"),),
        130,
        130,
        "Interrupted after",
    ),
    # An advisory rides home in the row it was recorded under and never fails the run, so its
    # column is the only evidence it survived the trip.
    Handoff(
        "a scope carrying an advisory home",
        ("section demo", 'warn "worth a look"', 'ok "checked"'),
        ((3, 0, 1, "demo"),),
        0,
        0,
        "1 advisory line(s) above",
    ),
    # A finding recorded before the first section has no row to travel in, so the ledger refuses
    # rather than emitting rows that would report the scope clean.
    Handoff(
        "a finding recorded before the first section",
        ('fail "counted where no row can carry it"', "section demo", 'ok "checked"'),
        (),
        1,
        1,
        "closed with no verdict",
        worker_says="were recorded outside any section",
    ),
    # The false green, which only a disagreement produces: a status naming a finding over rows that
    # name none. Graded with the run's own faults, the handoff being what broke.
    Handoff(
        "a status naming a finding its rows do not carry",
        ("section demo", 'ok "checked"'),
        ((2, 0, 0, "demo"),),
        0,
        3,
        "carries no finding",
        replay_as=1,
    ),
    # The other half of the same disagreement, and the one a single clean-or-not flag cannot see:
    # a refusal is a rank, not a count, so the rows have to be read for the rank the status claims.
    Handoff(
        "a status naming a refusal its rows do not carry",
        ("section demo", 'ok "checked"'),
        ((2, 0, 0, "demo"),),
        0,
        3,
        "carries no refusal",
        replay_as=2,
    ),
)


def _worker_script(body: tuple[str, ...]) -> str:
    return "\n".join(
        (
            "#!/usr/bin/env bash",
            'source "' + LIB.as_posix() + '"',
            # This run is no step worker, owns no pool and holds no db claim: `gate_exit`'s
            # reclaims are false by construction rather than by a copy of the gate's own tests,
            # and `set -u` refuses a missing array or marker.
            "POOL_DIRS=()",
            'DB_RUN_MARKER=""',
            "step_worker() { false; }",
            "cleanup() { :; }",
            _lifted("gate_exit"),
            _lifted("wrap_up"),
            "trap gate_exit EXIT",
            *body,
            "wrap_up",
            "",
        )
    )


def _parent_script(pool: Path, statuses: dict[str, str]) -> str:
    """A parent over one pool directory, minus the capture files `replay_scope` also cats."""
    rows = " ".join(f'[{scope}]="{status}"' for scope, status in statuses.items())
    return "\n".join(
        (
            "#!/usr/bin/env bash",
            'source "' + LIB.as_posix() + '"',
            f'POOL_DIR="{pool.as_posix()}"',
            f"declare -A UNIT_STATUS=({rows})",
            # Every scope this fixture opens is replayed, so the closing statement is a whole run's.
            'NOT_RUN=""',
            _lifted("adopt_rows", "  "),
            _lifted("replay_scope", "  "),
            _lifted("wrap_up"),
            "ENDING=0",
            "REPLAY_STATUS=0",
            'for scope in "$@"; do',
            # The gate's `adopt_finished` arm past the first failure is
            # `scripts/tests/test_unit_replay.py`'s subject, and no case here replays behind one.
            '  if (( ! ENDING )); then replay_scope "$scope"; ENDING="$REPLAY_STATUS"; fi',
            "done",
            "if (( ENDING )); then finish; fi",
            "wrap_up",
            "",
        )
    )


@dataclass(frozen=True)
class Replay:
    """What each end of one handoff saw."""

    worker_code: int
    worker_output: str
    rows: tuple[tuple[int, int, int, str], ...]
    parent_code: int
    parent_output: str


def _bash(path: Path, args: tuple[str, ...], env: dict[str, str]) -> tuple[int, str]:
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    done = run_shell(BASH, path, *args, env=env)
    return done.returncode, done.stdout + done.stderr


def _run_worker(
    scratch: Path, pool: Path, tag: str, body: tuple[str, ...], env: dict[str, str]
) -> tuple[int, str, tuple[tuple[int, int, int, str], ...]]:
    """Run one worker under its own ledger, and read that ledger back as rows.

    The ledger is written where the pool would have left it, which is where `adopt_rows` looks.
    """
    ledger = pool / f"{tag}.ledger"
    script = scratch / f"{tag}.sh"
    write_shell(script, _worker_script(body))
    code, output = _bash(script, (), {**env, "FL_GATE_WORKER": "1", "FL_GATE_LEDGER": ledger.as_posix()})
    rows: list[tuple[int, int, int, str]] = []
    if ledger.exists():
        for line in ledger.read_text(encoding="utf-8").splitlines():
            rank, ms, findings, advisories, name = line.split("\t")
            assert ms.isdigit(), f"{tag}: the duration column reads {ms!r}"
            rows.append((int(rank), int(findings), int(advisories), name))
    return code, output, tuple(rows)


def _pool(scratch: str) -> Path:
    pool = Path(scratch) / "pool"
    pool.mkdir()
    return pool


def _replay(case: Handoff) -> Replay:
    """Run the worker, read the ledger it wrote, and hand both to a parent."""
    env = _env()
    with tempfile.TemporaryDirectory() as scratch:
        pool = _pool(scratch)
        worker_code, worker_output, rows = _run_worker(Path(scratch), pool, "demo", case.body, env)
        status = case.worker_code if case.replay_as is None else case.replay_as
        parent = write_shell(Path(scratch) / "parent.sh", _parent_script(pool, {"demo": str(status)}))
        parent_code, parent_output = _bash(parent, ("demo",), env)
    return Replay(worker_code, worker_output, rows, parent_code, parent_output)


def test_every_handoff_carries_the_workers_verdict_home_in_its_rows() -> None:
    """The rows are held to alongside both exit codes.

    A ledger misreporting a rank or a count is replayed as truth, and the parent's own status can
    stay right over a row that was wrong -- the count it prints is the half that moves.
    """
    wrong: list[str] = []
    for case in HANDOFFS:
        seen = _replay(case)
        if seen.worker_code != case.worker_code:
            wrong.append(f"{case.name}: the worker exited {seen.worker_code}, and the contract gives it {case.worker_code}")
        if seen.rows != case.rows:
            wrong.append(f"{case.name}: the ledger reads {seen.rows}, and the contract gives it {case.rows}")
        if seen.parent_code != case.parent_code:
            wrong.append(f"{case.name}: the parent exited {seen.parent_code}, and the contract gives it {case.parent_code}")
        if case.says not in seen.parent_output:
            wrong.append(f"{case.name}: nothing the parent printed says {case.says!r}")
        if case.worker_says is not None and case.worker_says not in seen.worker_output:
            wrong.append(f"{case.name}: nothing the worker printed says {case.worker_says!r}")
        # On every case rather than one: each reaches `_closing` by a different arm, and a worker
        # summarising a run it sees one scope of duplicates the parent's table below it.
        for statement in ("Green —", "finding(s) in this run", "Refused after", "Crashed after", "Interrupted after"):
            if statement in seen.worker_output:
                wrong.append(f"{case.name}: the worker printed the {statement!r} statement")
    assert not wrong, "\n".join(wrong)


def test_a_scope_whose_status_its_rows_contradict_is_caught_behind_a_scope_that_found_something() -> None:
    """Two scopes, because the cross-check reads state a run accumulates.

    The first scope's finding would stand in for the second scope's silence. Its status is replayed
    as 0 only so the replay reaches the second at all.
    """
    env = _env()
    with tempfile.TemporaryDirectory() as scratch:
        pool = _pool(scratch)
        found = ("section one", "step work", 'fail "a real finding"')
        first_code, _, first_rows = _run_worker(Path(scratch), pool, "one", found, env)
        second_code, _, second_rows = _run_worker(Path(scratch), pool, "two", ("section two", 'ok "checked"'), env)
        assert (first_code, first_rows) == (1, ((5, 1, 0, "one"),))
        assert (second_code, second_rows) == (0, ((2, 0, 0, "two"),))
        parent = write_shell(Path(scratch) / "parent.sh", _parent_script(pool, {"one": "0", "two": "1"}))
        code, output = _bash(parent, ("one", "two"), env)
    assert code == 3, f"the second scope's disagreement exited {code}"
    assert "the two scope exited 1" in output, output
