"""SCRIPTS · the worker to parent handoff, run end to end rather than asserted as literals.

A parent replays rows it never watched being produced, so a ledger that misreports a rank or a
count is replayed as truth and closes the run green over a real finding. Every case below runs a
real worker, reads the ledger it wrote, and hands both to a parent shaped like
`scripts/verify.sh :: replay_scope`.

Invariants:
A worker's exit status and the rows it sent home are two accounts of one run and must agree.
`scripts/_lib.sh :: emit_section_ledger` is the only producer of those rows.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Final

SCRIPTS: Final = Path(__file__).resolve().parent.parent
LIB: Final = SCRIPTS / "_lib.sh"

# Not a skip condition, for `scripts/tests/test_exit_contract.py :: BASH`'s reason.
BASH: Final = shutil.which("bash")


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
    # The rank below is the one `scripts/_lib.sh :: refuse` produced, which every parent-side
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
    ),
    # The false green, which only a disagreement produces: a status naming a finding over rows that
    # name none. Graded a refusal, the run having contradicted itself.
    Handoff(
        "a status its rows contradict",
        ("section demo", 'ok "checked"'),
        ((2, 0, 0, "demo"),),
        0,
        2,
        "two accounts of one run",
        replay_as=1,
    ),
)


def _worker_script(body: tuple[str, ...]) -> str:
    """`scripts/verify.sh :: gate_exit` and `:: wrap_up` in miniature.

    The `worker` calls are the point: a fixture writing the ledger unconditionally proves the trap
    rather than the branch that decides whether a run owes one at all.
    """
    return "\n".join(
        (
            "#!/usr/bin/env bash",
            'source "' + LIB.as_posix() + '"',
            'gate_exit() { if worker; then end_section; emit_section_ledger > "${FL_GATE_LEDGER:?}"; fi; }',
            "trap gate_exit EXIT",
            *body,
            "if worker; then end_worker; fi",
            "finish",
            "",
        )
    )


# `scripts/verify.sh :: replay_scope` and the loop that drives it, minus the captured bytes it
# replays: rows, then status, then ending, one scope per three arguments. The rank-0 stand-in is
# what a scope that sent no ledger home gets.
PARENT_SCRIPT: Final = "\n".join(
    (
        "#!/usr/bin/env bash",
        'source "' + LIB.as_posix() + '"',
        "while (( $# )); do",
        '  label="$1"; ledger="$2"; status="$3"; shift 3',
        '  if [[ -s "$ledger" ]]; then',
        "    while IFS=$'\\t' read -r rank ms findings advisories name; do",
        '      adopt_section "$name" "$rank" "$ms" "$findings" "$advisories"',
        '    done < "$ledger"',
        "  else",
        '    adopt_section "$label" 0 0 0 0',
        "  fi",
        '  adopt_ending "$status" "the ${label} scope"',
        "  if (( status )); then finish; fi",
        "done",
        "finish",
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
    done = subprocess.run(
        (BASH, path.as_posix(), *args),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        check=False,
    )
    return done.returncode, done.stdout + done.stderr


def _write(path: Path, text: str) -> None:
    """`newline=""` because a CRLF fixture leaves bash a stray return on every line."""
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(text)


def _base_env() -> dict[str, str]:
    """The environment a fixture must not inherit.

    A parent's own run state would decide the answer: FL_GATE_WORKER silences every summary, and the
    pool's variables point a fixture at a ledger belonging to another run entirely.
    """
    env = {name: value for name, value in os.environ.items() if not name.startswith("FL_GATE_")}
    env.pop("GITHUB_ACTIONS", None)
    env.pop("VERBOSE", None)
    env["FL_GATE_COLOR"] = "0"
    env["NO_SPINNER"] = "1"
    return env


def _run_worker(
    scratch: Path, tag: str, body: tuple[str, ...], env: dict[str, str]
) -> tuple[int, str, Path, tuple[tuple[int, int, int, str], ...]]:
    """Run one worker under its own ledger, and read that ledger back as rows."""
    ledger = scratch / f"{tag}.ledger"
    script = scratch / f"{tag}.sh"
    _write(script, _worker_script(body))
    code, output = _bash(script, (), {**env, "FL_GATE_WORKER": "1", "FL_GATE_LEDGER": ledger.as_posix()})
    rows: list[tuple[int, int, int, str]] = []
    if ledger.exists():
        for line in ledger.read_text(encoding="utf-8").splitlines():
            rank, ms, findings, advisories, name = line.split("\t")
            assert ms.isdigit(), f"{tag}: the duration column reads {ms!r}"
            rows.append((int(rank), int(findings), int(advisories), name))
    return code, output, ledger, tuple(rows)


def _replay(case: Handoff) -> Replay:
    """Run the worker, read the ledger it wrote, and hand both to a parent."""
    env = _base_env()
    with tempfile.TemporaryDirectory() as scratch:
        parent = Path(scratch) / "parent.sh"
        _write(parent, PARENT_SCRIPT)
        worker_code, worker_output, ledger, rows = _run_worker(Path(scratch), "demo", case.body, env)
        status = case.worker_code if case.replay_as is None else case.replay_as
        parent_code, parent_output = _bash(parent, ("demo", ledger.as_posix(), str(status)), env)
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
        # On every case rather than one: each reaches `_closing` by a different arm, and a worker
        # summarising a run it sees one scope of duplicates the parent's table below it.
        for statement in ("Green —", "finding(s) in this run", "Refused after", "Crashed after", "Interrupted after"):
            if statement in seen.worker_output:
                wrong.append(f"{case.name}: the worker printed the {statement!r} statement")
    assert not wrong, "\n".join(wrong)


def test_a_ledger_refuses_to_travel_at_all_over_a_finding_no_row_can_carry() -> None:
    """The ledger is empty by design here, so the worker's own message is the only evidence.

    A parent replaying it can report the scope unproven, and never why it was unproven.
    """
    case = next(one for one in HANDOFFS if one.name == "a finding recorded before the first section")
    seen = _replay(case)
    assert seen.rows == (), f"the ledger emitted {seen.rows} over a finding no row can carry"
    assert "were recorded outside any section" in seen.worker_output


def test_a_scope_whose_status_its_rows_contradict_is_caught_after_a_scope_whose_rows_were_dirty() -> None:
    """Two scopes, because the cross-check reads state a run accumulates.

    A first scope leaving an unproven row is what would stand in for the second scope's silence and
    let the false green through behind it.
    """
    env = _base_env()
    with tempfile.TemporaryDirectory() as scratch:
        parent = Path(scratch) / "parent.sh"
        _write(parent, PARENT_SCRIPT)
        # Rank 0, and a status of 0 beside it: the one shape that leaves a row dirty without ending
        # the replay where it stands.
        first_code, _, first, first_rows = _run_worker(Path(scratch), "one", ("section one",), env)
        second_code, _, second, second_rows = _run_worker(Path(scratch), "two", ("section two", 'ok "checked"'), env)
        assert (first_code, first_rows) == (0, ((0, 0, 0, "one"),))
        assert (second_code, second_rows) == (0, ((2, 0, 0, "two"),))
        code, output = _bash(
            parent,
            ("one", first.as_posix(), "0", "two", second.as_posix(), "1"),
            env,
        )
    assert code == 2, f"the second scope's disagreement exited {code}"
    assert "the two scope exited 1" in output, output
