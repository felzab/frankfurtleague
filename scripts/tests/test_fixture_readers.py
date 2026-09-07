"""SCRIPTS · the shell reader `scripts/tests/conftest.py` shares, over the shapes it is pointed at.

`lift_function` is what keeps a gate function out of a test as a hand copy, so its own silent answer
is the failure that matters: a lift walking past the end of a one-line function stops at the next
function's closing brace and hands the caller a shell carrying whatever stood between, which then
runs. Its cases sit here rather than beside a subject sharing its fixture, for the reason
`test_fixture_builder.py` gives about the builder.
"""

from __future__ import annotations

from pathlib import Path
from typing import Final

from conftest import lift_function, write_shell

SCRIPTS: Final = Path(__file__).resolve().parents[1]
VERIFY: Final = SCRIPTS / "gate" / "verify.sh"

ONE_LINE: Final = 'one_line() { printf "%s" "$1"; }'
INDENTED: Final = 'inner() { printf "%s" "$1"; }'

# The one-liner ahead of the block, which is the arrangement a walk mis-reads: with no closing line
# of its own the first lift runs on to the second function's.
MIXED: Final = "\n".join(("#!/usr/bin/env bash", ONE_LINE, "", "a_block() {", '  printf "not this"', "}", ""))

NESTED: Final = "\n".join(("#!/usr/bin/env bash", "outer() {", "  " + INDENTED, "  inner x", "}", ""))

# Closed at a margin the caller did not name, so neither shape matches and the lift has no answer.
ADRIFT: Final = "\n".join(("#!/usr/bin/env bash", "adrift() {", '  printf "%s" "$1"', "  }", ""))


def test_a_one_line_function_is_lifted_without_the_block_below_it(tmp_path: Path) -> None:
    """A wrong lift is a shell that still runs, so nothing but its text says the fixture is not the gate's."""
    script = write_shell(tmp_path / "mixed.sh", MIXED)

    assert lift_function(script, "one_line") == ONE_LINE


def test_a_block_function_is_lifted_from_its_opening_line_to_its_closing_one(tmp_path: Path) -> None:
    script = write_shell(tmp_path / "mixed.sh", MIXED)

    assert lift_function(script, "a_block") == 'a_block() {\n  printf "not this"\n}'


def test_an_indented_one_line_function_is_lifted_dedented(tmp_path: Path) -> None:
    """The shape `scripts/gate/selfcheck.sh` writes inside a step, where the margin is the caller's argument."""
    script = write_shell(tmp_path / "nested.sh", NESTED)

    assert lift_function(script, "inner", "  ") == INDENTED


def test_a_function_closing_on_neither_shape_is_refused_by_its_name(tmp_path: Path) -> None:
    """Refusing is what sends a caller to a hand copy deliberately rather than by discovery."""
    script = write_shell(tmp_path / "adrift.sh", ADRIFT)

    try:
        lift_function(script, "adrift")
    except AssertionError as refusal:
        assert "adrift" in str(refusal), refusal
    else:
        raise AssertionError("a function closed by no line this reader knows was lifted anyway")


def test_the_gates_own_one_line_function_comes_back_as_one_line() -> None:
    script = lift_function(VERIFY, "step_worker")

    assert script.startswith("step_worker() {") and "\n" not in script, script
