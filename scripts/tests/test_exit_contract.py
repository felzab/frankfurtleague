"""SCRIPTS · the shell half of the four-value exit contract, executed.

`scripts/lib/checker_kernel.py` declares the codes and `scripts/lib/_lib.sh` is what a gate run actually
exits with, so every ending below is run rather than read: a comparison of two literals cannot see
an arm reordered inside `scripts/lib/_lib.sh :: finish`.
"""

from __future__ import annotations

import ast
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from conftest import base_env, run_shell, write_shell

SCRIPTS: Final = Path(__file__).resolve().parent.parent
LIB: Final = SCRIPTS / "lib" / "_lib.sh"

# Not a skip condition: every script under `scripts/` is bash, so a machine without one cannot run
# the gate at all, and a contract silently skipped is what this file exists to stop.
BASH: Final = shutil.which("bash")


@dataclass(frozen=True)
class Ending:
    """One way a gate script can end, the shell that reaches it, and the code a caller may branch on."""

    name: str
    body: tuple[str, ...]
    code: int
    # A fragment the run's own output must carry, or None where the ending prints no statement: a
    # worker summarises nothing, and `die` outside a section closes no run.
    says: str | None = None
    env: tuple[tuple[str, str], ...] = ()


ENDINGS: Final[tuple[Ending, ...]] = (
    Ending("a clean run", ("section demo", 'ok "checked"', "finish"), 0, "Green"),
    Ending("a section that reported a finding", ("section demo", "step work", 'fail "one thing"', "finish"), 1, "finding(s) in this run"),
    Ending("a refusal", ('refuse "the input could not be judged"',), 2, "Refused after"),
    # The count, not just the prose: `die` owes the run a finding as well as the status, and a
    # statement reading "0 finding(s)" beside exit 1 sends the reader looking for nothing.
    Ending("die inside a section", ("section demo", 'die "the tool is missing"'), 1, "1 finding(s) in this run"),
    Ending("a command that failed under set -e", ("section demo", "false"), 3, "Crashed after"),
    # Already past the crash floor, so the underlying status survives rather than being flattened.
    Ending("a command that failed with a status of its own", ("section demo", "(exit 7)"), 7, "Crashed after"),
    Ending("an interrupt", ("section demo", "on_interrupt"), 130, "Interrupted after"),
    # `adopt_ending` is the parent's half of the contract: a worker's raw wait status, classified
    # before anything is allowed to `exit` with it.
    Ending("a worker that was interrupted", ("adopt_ending 130",), 130, "Interrupted after"),
    Ending("a worker that crashed", ("adopt_ending 4",), 4, "Crashed after"),
    # 2304 is what a Windows kill reports, and `exit` masks it to the zero that closes a run green
    # over a scope nothing judged.
    Ending("a worker killed with a status above 255", ("adopt_ending 2304",), 3, "Crashed after"),
    Ending("a worker whose rows tell the whole story", ("adopt_section demo 2 10 0 0", "adopt_ending 0", "finish"), 0, "Green"),
    # A 1 names a finding and a 2 names a refusal, and a plain-pass row carries neither. Neither
    # account is then a verdict: graded 3, the code for the run's own plumbing, never green.
    Ending("a worker status its rows contradict", ("adopt_section demo 2 10 0 0", "adopt_ending 1"), 3, "carries no finding"),
    Ending("a worker refusal its rows contradict", ("adopt_section demo 2 10 0 0", "adopt_ending 2"), 3, "carries no refusal"),
    # A rank of 4 is the row a 2 names, and a 1 over it names a finding no row holds: the two arms
    # are read apart, so neither status is corroborated by the other's row.
    Ending("a refusal its rows carry", ("adopt_section demo 4 10 0 0", "adopt_ending 2", "finish"), 2, "Refused after"),
    Ending("a finding named over a row that refused", ("adopt_section demo 4 10 0 0", "adopt_ending 1"), 3, "carries no finding"),
    # Rank 0 is the parent's own word for a scope that proved nothing, so a status of 1 over it is
    # corroborated rather than contradicted, and `finish` still refuses to call the run green.
    Ending("a worker that sent no ledger home", ("adopt_section demo 0 0 0 0", "adopt_ending 1", "finish"), 1, "closed with no verdict"),
    Ending("a section that closed with no verdict", ("section demo", "finish"), 1, "closed with no verdict"),
    Ending("an adopted row that refused", ("adopt_section scope 4 10 0 0", "finish"), 2, "Refused after"),
    Ending("an adopted row that failed while counting no finding", ("adopt_section scope 5 10 0 0", "finish"), 1, "finding(s) in this run"),
    # Findings outrank a refusal. The rank arms are exclusive, so only a finding carried outside
    # every rank-5 row puts the two arms in competition at all.
    Ending(
        "a finding counted before the first section, beside a refused row",
        ("add_findings 1", "adopt_section scope 4 10 0 0", "finish"),
        1,
        "finding(s) in this run",
    ),
    # The count is held to here for `adopt_section`'s reason for feeding the run total at all: the
    # rank arms alone would exit 1 over a statement reading "0 finding(s)".
    Ending(
        "adopted rows carrying a finding and a refusal together",
        ("adopt_section one 5 10 1 0", "adopt_section two 4 10 0 0", "finish"),
        1,
        "1 finding(s) in this run",
    ),
    # A mangled row is the gate's own handoff, so all three of `adopt_section`'s validations crash:
    # nothing in the tree under test could be edited to answer for one, which is what a 1 would say.
    Ending("an adopted rank outside the label table", ("adopt_section scope 6 10 0 0",), 3, "is outside 0-5"),
    Ending("an adopted count that is not a number", ("adopt_section scope 4 ten 0 0",), 3, "is not a count"),
    Ending("an adopted row while a section is still open", ("section demo", "adopt_section scope 2 10 0 0"), 3, "a section is still open"),
    # Rank 1 is the one verdict below `pass` that no ending owns: a run of nothing but skips has
    # judged no change, and green there reads as a run that did.
    Ending("a run of nothing but skips", ("section demo", 'skip "nothing"', "finish"), 2, "every section in this run was skipped"),
    Ending("a worker that found something", ("section demo", 'fail "one thing"', "end_worker"), 1, None, (("FL_GATE_WORKER", "1"),)),
    Ending("a worker that found nothing", ("section demo", 'ok "checked"', "end_worker"), 0, None, (("FL_GATE_WORKER", "1"),)),
)


def _kernel_exit_codes() -> dict[str, int]:
    """Every EXIT_ constant checker_kernel.py declares.

    Read out of the source, never imported: the module raises on an interpreter below its own floor.
    """
    source = (SCRIPTS / "lib" / "checker_kernel.py").read_text(encoding="utf-8")
    declared: dict[str, int] = {}
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.AnnAssign) and node.value is not None:
            name = getattr(node.target, "id", "")
            if name.startswith("EXIT_"):
                declared[name] = int(ast.literal_eval(node.value))
    assert declared, "checker_kernel.py no longer declares any EXIT_ constant"
    return declared


def _run(ending: Ending) -> tuple[int, str]:
    """Reach one ending in a throwaway script, and answer its status beside everything it printed."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    env = base_env()
    env.update(dict(ending.env))
    with tempfile.TemporaryDirectory() as scratch:
        # Sourcing `_lib.sh` cds to the repository root, so no body may lean on this directory.
        body = "\n".join(("#!/usr/bin/env bash", f'source "{LIB.as_posix()}"', *ending.body, ""))
        done = run_shell(BASH, write_shell(Path(scratch) / "ending.sh", body), env=env)
    return done.returncode, done.stdout + done.stderr


def test_every_ending_exits_the_code_the_contract_gives_it() -> None:
    """The closing statement is held to beside the status: an ending that exits 2 under the findings prose misreads the run twice."""
    wrong: list[str] = []
    for ending in ENDINGS:
        code, output = _run(ending)
        if code != ending.code:
            wrong.append(f"{ending.name}: exited {code}, and the contract gives it {ending.code}")
        if ending.says is not None and ending.says not in output:
            wrong.append(f"{ending.name}: nothing it printed says {ending.says!r}")
    assert not wrong, "\n".join(wrong)


def test_an_ending_reached_inside_a_worker_summarises_nothing() -> None:
    """`die` is the reachable one: a worker sees a single scope, and its parent prints the table once over replayed captures."""
    code, output = _run(Ending("a worker that died", ("section demo", 'die "the tool is missing"'), 1, None, (("FL_GATE_WORKER", "1"),)))
    assert code == 1
    assert "the tool is missing" in output
    for statement in ("Green", "finding(s) in this run", "Refused after", "Crashed after"):
        assert statement not in output, f"a worker printed the {statement!r} statement"


def test_every_exit_code_the_kernel_declares_is_reached_by_a_fixture() -> None:
    """A code nothing here ends with is a branch of the contract that no reader is being held to."""
    reached = {ending.code for ending in ENDINGS}
    missing = {name: value for name, value in _kernel_exit_codes().items() if value not in reached}
    assert not missing, f"no fixture ends with these: {missing}"
