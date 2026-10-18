"""SCRIPTS · the shell half of the four-value exit contract, executed.

`scripts/lib/checker_kernel.py` declares the codes and `scripts/lib/_lib.sh` is what a gate run actually
exits with, so every ending below is run rather than read: a comparison of two literals cannot see
an arm reordered inside `scripts/lib/_lib.sh :: finish`.
"""

from __future__ import annotations

import ast
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from conftest import BASH, base_env, run_shell, write_shell

SCRIPTS: Final = Path(__file__).resolve().parent.parent
LIB: Final = SCRIPTS / "lib" / "_lib.sh"


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
    Ending("an adopted rank outside the label table", ("adopt_section scope 7 10 0 0",), 3, "is outside 0-6"),
    Ending("an adopted count that is not a number", ("adopt_section scope 4 ten 0 0",), 3, "is not a count"),
    Ending("an adopted row while a section is still open", ("section demo", "adopt_section scope 2 10 0 0"), 3, "a section is still open"),
    # Rank 1 is the one verdict below `pass` that no ending owns: a run of nothing but skips has
    # judged no change, and green there reads as a run that did.
    Ending("a run of nothing but skips", ("section demo", 'skip "nothing"', "finish"), 2, "every section in this run was skipped"),
    Ending("a worker that found something", ("section demo", 'fail "one thing"', "end_worker"), 1, None, (("FL_GATE_WORKER", "1"),)),
    Ending("a worker that found nothing", ("section demo", 'ok "checked"', "end_worker"), 0, None, (("FL_GATE_WORKER", "1"),)),
)


def _kernel_exit_codes() -> dict[str, int]:
    """Every EXIT_ constant checker_kernel.py declares, read out of the source for `scripts/tests/conftest.py :: declared`'s reason."""
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


# A sourced file failing on its line 3, where the script sourcing it holds other text: the library
# is such a file to every script, and a crash in it must not be reported against the caller.
SOURCED: Final = (
    "#!/usr/bin/env bash\nboom() {\n  false # the failing line\n}\nparted() {\n  false \\\n    with \\\n    arguments\n}\n"
    # A comment ending in a backslash above the failing line, and one inside the command it ends:
    # `scripts/lib/_lib.sh :: _on_err_trap`'s walk continues past neither.
    "commented() {\n  # a comment whose last character is a backslash \\\n  false below the comment\n}\n"
    "cut() {\n  false above \\\n  # the comment that ends it \\\n  true\n}\n"
)


def _crash(*body: str, sourced_text: str = SOURCED) -> tuple[int, str]:
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    with tempfile.TemporaryDirectory() as scratch:
        sourced = write_shell(Path(scratch) / "sourced.sh", sourced_text)
        script = "\n".join(("#!/usr/bin/env bash", f'source "{LIB.as_posix()}"', f'source "{sourced.as_posix()}"', *body, ""))
        done = run_shell(BASH, write_shell(Path(scratch) / "caller.sh", script), env=base_env())
    return done.returncode, done.stdout + done.stderr


def test_a_crash_names_the_file_and_the_line_that_failed() -> None:
    """Both as a statement fails and inside another trap, where `$BASH_COMMAND` still holds the command that trap interrupted."""
    wrong: list[str] = []
    for how, body, says in (
        ("called", ("boom",), r"line 3:  false # the failing line$"),
        ("inside an EXIT trap", ("trap boom EXIT", "true"), r"line 3:  false # the failing line$"),
        # `parted` fails in a command continued over lines 6 to 8: whichever `$LINENO` names, that line
        # alone is a fragment of the command.
        ("continued over three lines", ("parted",), r"line [678]:  false with arguments$"),
        ("below a comment ending in a backslash", ("commented",), r"line 12:  false below the comment$"),
        ("continued into a comment ending in a backslash", ("cut",), r"line 1[56]:  false above # the comment that ends it$"),
    ):
        code, output = _crash(*body)
        if code != 3:
            wrong.append(f"{how}: exited {code}, and a crash exits 3")
        if "sourced.sh failed" not in output or re.search(says, output, re.MULTILINE) is None:
            wrong.append(f"{how}: the statement names another file or another command:\n{output}")
    assert not wrong, "\n".join(wrong)


# A sourced file entering the library's adopting helpers, each call on a line of its own: a crash a
# helper raises itself names the line that called the library, in the file holding that line.
ADOPTER: Final = """#!/usr/bin/env bash
contradicted() {
  adopt_section demo 2 10 0 0
  adopt_ending 1
}
mangled() {
  adopt_section demo 7 10 0 0
}
garbled() {
  adopt_ending none
}
uncounted() {
  adopt_section demo 4 ten 0 0
}
unclosed() {
  section demo
  adopt_section demo 2 10 0 0
}
"""


def test_a_crash_a_library_helper_raises_names_the_line_that_called_it() -> None:
    """`contradicted` is the load-bearing case: its crash is raised by a helper's helper, one frame further out."""
    wrong: list[str] = []
    for call, says in (
        ("contradicted", "line 4:  a worker exited 1, and every section row it sent home carries no finding."),
        ("mangled", "line 7:  adopt_section: rank 7 is outside 0-6."),
        ("garbled", "line 10:  adopt_ending: 'none' is not an exit status."),
        ("uncounted", "line 13:  adopt_section: 'ten' is not a count. Arguments: name rank ms findings [advisories]."),
        ("unclosed", "line 17:  adopt_section: a section is still open. Call end_section first."),
    ):
        code, output = _crash(call, sourced_text=ADOPTER)
        if code != 3:
            wrong.append(f"{call}: exited {code}, and a crash exits 3")
        if "sourced.sh failed" not in output or says not in output:
            wrong.append(f"{call}: the statement names another file, line or message than {says!r}:\n{output}")
    assert not wrong, "\n".join(wrong)


def test_a_crash_inside_a_trap_names_its_command_when_the_script_was_started_by_a_relative_path() -> None:
    """Inside a trap the file's own text is the only account of the command, read off a path given before the library's `cd`."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    script = "\n".join(
        (
            "#!/usr/bin/env bash",
            f'source "{LIB.as_posix()}"',
            "boom() {",
            "  false in the trap",
            "}",
            "trap boom EXIT",
            "true the interrupted command",
            "",
        )
    )
    with tempfile.TemporaryDirectory() as scratch:
        write_shell(Path(scratch) / "caller.sh", script)
        done = run_shell(BASH, Path("caller.sh"), env=base_env(), cwd=Path(scratch))
    output = done.stdout + done.stderr
    assert done.returncode == 3, f"exited {done.returncode}, and a crash exits 3:\n{output}"
    assert re.search(r"^ *line 4:  false in the trap$", output, re.MULTILINE), f"the statement names another command:\n{output}"


def test_every_exit_code_the_kernel_declares_is_reached_by_a_fixture() -> None:
    """A code nothing here ends with is a branch of the contract that no reader is being held to."""
    reached = {ending.code for ending in ENDINGS}
    missing = {name: value for name, value in _kernel_exit_codes().items() if value not in reached}
    assert not missing, f"no fixture ends with these: {missing}"
