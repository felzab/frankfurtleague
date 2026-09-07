"""SCRIPTS · the width each test runner is handed when two of them share one machine.

`scripts/gate/verify.sh :: gate_width` divides one concurrency budget between the sections that
declare a width, and `:: gate_widths_fit` answers whether those sections share a pool at all.
Neither speaks on a machine whose core count covers the declared demand -- which is every machine
this suite has run on -- so both are lifted out of the gate and driven here at budgets a real run
would need a smaller machine to reach.

Invariants:
  Every optimum and floor is read out of the script rather than restated, and a revised one fails the guard case before it reaches a table.
"""

from __future__ import annotations

import re
import shutil
import tempfile
from pathlib import Path
from typing import Final

from conftest import base_env, lift_function, run_shell, write_shell

SCRIPTS: Final = Path(__file__).resolve().parent.parent
VERIFY: Final = SCRIPTS / "gate" / "verify.sh"

# Not a skip condition, for `test_exit_contract.py`'s reason: a machine with no bash cannot run the
# gate at all, so a contract silently skipped here is the failure this file exists to stop.
BASH: Final = shutil.which("bash")

SCRIPTS_SUITE: Final = "the scripts suite"
DB_TIER: Final = "the db tier"

DECLARED: Final[dict[str, tuple[str, str]]] = {
    SCRIPTS_SUITE: ("GATE_WIDTH_SCRIPTS_PYTEST", "GATE_WIDTH_SCRIPTS_PYTEST_FLOOR"),
    DB_TIER: ("GATE_WIDTH_DB_PYTEST", "GATE_WIDTH_DB_PYTEST_FLOOR"),
}

# The optimum and floor every row below was computed against. A floor is a measurement and gets
# re-taken, so a revision arrives as a failure naming the tables rather than a row still passing.
ASSUMED: Final[dict[str, tuple[int, int]]] = {SCRIPTS_SUITE: (8, 8), DB_TIER: (6, 4)}

# The parent's own decision, opened on the pool's flag and closed at the margin. Anchored on its
# text rather than a position, as `scripts/tests/conftest.py :: lift_function` anchors a function.
DECISION: Final = re.compile(r"(?m)^if \(\( PARALLEL \)\); then\n(?:.*\n)*?fi$")


def _constant(name: str) -> int:
    """One `NAME=<n>` line, as the script itself declares it.

    Read rather than restated: a width this module kept its own copy of would go on passing while
    the gate handed a runner something else.
    """
    found = re.search(rf"(?m)^{re.escape(name)}=([0-9]+)$", VERIFY.read_text(encoding="utf-8"))
    assert found is not None, f"{VERIFY.name} no longer declares {name}"
    return int(found.group(1))


def _pool_decision() -> str:
    """The block that answers whether there is a pool, as the script writes it.

    Lifted for `scripts/tests/conftest.py :: lift_function`'s reason, by a reader of its own: the
    decision is a conditional rather than a function it can find.
    """
    text = VERIFY.read_text(encoding="utf-8")
    found = DECISION.search(text)
    assert found is not None, f"{VERIFY.name} opens no block on the pool's own flag"
    block = found.group(0)
    assert "gate_widths_fit" in block, f"{VERIFY.name} decides on a pool before asking whether the declared floors fit"
    return block


def _answers(body: str, *names: str) -> dict[str, str]:
    """Every `label<TAB>answer` line one parent-side run printed.

    `test_unit_replay.py :: _parent` is the original and lays down a pool directory and its ledgers,
    which these two functions never read; what they read is laid down per row inside `body` instead.
    """
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    with tempfile.TemporaryDirectory() as scratch:
        fixture = Path(scratch) / "parent.sh"
        lines = ("#!/usr/bin/env bash", *(lift_function(VERIFY, name) for name in names), body, "")
        done = run_shell(BASH, write_shell(fixture, "\n".join(lines)), env=base_env())
    output = done.stdout + done.stderr
    assert done.returncode == 0, output
    return {line.split("\t", 1)[0]: line.split("\t", 1)[1] for line in output.splitlines() if "\t" in line}


def test_the_widths_this_module_was_written_against_are_still_declared() -> None:
    """The guard both tables rest on, so a revised floor lands here rather than inside a case."""
    wrong: list[str] = []
    for label, (optimum, floor) in DECLARED.items():
        declared = (_constant(optimum), _constant(floor))
        if declared != ASSUMED[label]:
            wrong.append(f"{label} declares {declared} and the tables below are written for {ASSUMED[label]}")
        if declared[1] > declared[0]:
            wrong.append(f"{label} declares a floor of {declared[1]} above its own optimum of {declared[0]}")
    assert not wrong, "\n".join(wrong)


# Demand is an input here and not a prediction: the parent sums the enabled optima into it beside the
# pool, and each row hands the division a sum of its own choosing.
DEMAND: Final = 14

# (budget, demand, the scripts suite's width, the db tier's). Below a budget that covers the demand
# only the db tier has a proportional arm, the scripts suite declaring a floor at its own optimum.
SHARES: Final[tuple[tuple[int, int, int, int], ...]] = (
    (0, DEMAND, 8, 6),
    (16, DEMAND, 8, 6),
    (DEMAND, DEMAND, 8, 6),
    (13, DEMAND, 8, 5),
    (12, DEMAND, 8, 5),
    (8, DEMAND, 8, 4),
    (2, DEMAND, 8, 4),
    (8, 0, 8, 6),
)


def test_a_share_is_never_narrower_than_the_floor_the_consumer_declared() -> None:
    """The 8- and 2-core rows are load-bearing: a proportional share falls under both floors there.

    The 13- and 12-core rows are the control a budget-blind function would fail.
    """
    script: list[str] = []
    for budget, demand, _scripts_width, _db_width in SHARES:
        script.append(f"FL_GATE_BUDGET={budget}")
        script.append(f"FL_GATE_DEMAND={demand}")
        for label, (want, floor) in ASSUMED.items():
            row = f"{budget}/{demand} {label}"
            script.append(f"printf '%s\\t%s\\n' '{row}' \"$(gate_width {want} {floor})\"")
    answered = _answers("\n".join(script), "gate_width")
    wrong: list[str] = []
    for budget, demand, scripts_width, db_width in SHARES:
        for label, expected in ((SCRIPTS_SUITE, scripts_width), (DB_TIER, db_width)):
            got = answered.get(f"{budget}/{demand} {label}")
            if got != str(expected):
                wrong.append(f"at a budget of {budget} against a demand of {demand}, {label} was handed {got} and is owed {expected}")
    assert not wrong, "\n".join(wrong)


# (budget, the sum of the enabled floors, whether the scopes may share one pool).
FITS: Final[tuple[tuple[int, int, bool], ...]] = (
    (0, 12, True),
    (16, 12, True),
    (12, 12, True),
    (11, 12, False),
    (1, 12, False),
    (11, 0, True),
)


def test_a_budget_too_small_for_every_floor_sequences_the_scopes_instead() -> None:
    """The arm taken over letting the sections overlap into a width already measured to be slower.

    An unknown budget and an unknown floor demand both read as fit: neither is a reason to give up
    the pool.
    """
    script: list[str] = []
    for budget, floors, _fits in FITS:
        script.append(f"FL_GATE_BUDGET={budget}")
        script.append(f"FL_GATE_FLOOR_DEMAND={floors}")
        script.append("if gate_widths_fit; then verdict=pool; else verdict=sequence; fi")
        script.append(f"printf '%s\\t%s\\n' '{budget}/{floors}' \"$verdict\"")
    answered = _answers("\n".join(script), "gate_widths_fit")
    wrong: list[str] = []
    for budget, floors, fits in FITS:
        expected = "pool" if fits else "sequence"
        got = answered.get(f"{budget}/{floors}")
        if got != expected:
            wrong.append(f"a budget of {budget} against floors summing to {floors} answered {got} and owes {expected}")
    assert not wrong, "\n".join(wrong)


# The budget the decision is driven at, and what the enabled floors sum to under it. Eight cores
# cover neither the declared demand nor that sum, which is what puts a run on the sequenced arm.
SEQUENCED_BUDGET: Final = 8
SEQUENCED_FLOORS: Final = sum(floor for _optimum, floor in ASSUMED.values())


def test_a_run_that_cannot_pool_leaves_no_budget_behind_the_decision() -> None:
    """The decision run whole, because a budget left standing behind it is invisible above.

    `gate_width` reads it as a shell variable through a call site's command substitution, so a
    sequenced run would otherwise take a pooled share.
    """
    script: list[str] = [
        # The machine the decision is being driven on, and the reporter it calls on the way out.
        f"nproc() {{ printf '%s' {SEQUENCED_BUDGET}; }}",
        "info() { printf 'info\\t%s\\n' \"$*\"; }",
        *(f"{name}={_constant(name)}" for pair in DECLARED.values() for name in pair),
        "RUN_SCRIPTS=1",
        "RUN_DB=1",
        "PARALLEL=1",
        _pool_decision(),
        "printf '%s\\t%s\\n' 'parallel' \"$PARALLEL\"",
        "printf '%s\\t%s\\n' 'budget' \"${FL_GATE_BUDGET:-none}\"",
    ]
    for label, (want, floor) in ASSUMED.items():
        script.append(f"printf '%s\\t%s\\n' '{label}' \"$(gate_width {want} {floor})\"")
    answered = _answers("\n".join(script), "gate_width", "gate_widths_fit")

    wrong: list[str] = []
    if answered.get("parallel") != "0":
        wrong.append(f"a budget of {SEQUENCED_BUDGET} left PARALLEL at {answered.get('parallel')} and owes 0")
    if answered.get("budget") != "none":
        wrong.append(f"the decision left a budget of {answered.get('budget')} standing, which every sequenced section then divides")
    for label, (optimum, _floor) in ASSUMED.items():
        got = answered.get(label)
        if got != str(optimum):
            wrong.append(f"{label} was handed {got} in sequence and is owed its own optimum of {optimum}")
    reported = answered.get("info", "")
    for number in (SEQUENCED_BUDGET, SEQUENCED_FLOORS):
        if str(number) not in reported:
            wrong.append(f"the run was told {reported!r}, which does not name {number}")
    assert not wrong, "\n".join(wrong)


def test_each_consumer_is_asked_with_the_floor_beside_the_optimum() -> None:
    """A floor declared and never handed on leaves the defect intact while the arithmetic passes.

    Structural because a call site is not a function: what each section passes is read rather than
    run.
    """
    text = VERIFY.read_text(encoding="utf-8")
    wrong: list[str] = []
    for label, (optimum, floor) in DECLARED.items():
        if not re.search(rf'gate_width "\${optimum}" "\${floor}"', text):
            wrong.append(f"{label} does not reach gate_width with {floor} beside {optimum}")
    assert not wrong, "\n".join(wrong)
