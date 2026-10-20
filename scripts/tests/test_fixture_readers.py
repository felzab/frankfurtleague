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

import pytest
from conftest import lift_function, write_shell

SCRIPTS: Final = Path(__file__).resolve().parents[1]
VERIFY: Final = SCRIPTS / "gate" / "verify.sh"

ONE_LINE: Final = 'one_line() { printf "%s" "$1"; }'
INDENTED: Final = 'inner() { printf "%s" "$1"; }'

# `scripts/lib/_lib.sh :: image_created`'s shape: the padding sits on both sides of the body, so a
# reader tolerant of the opening column alone still walks past this one's end.
ALIGNED: Final = 'aligned()   { printf "%s" "$1";  }'

# `scripts/gate/verify.sh :: do_pyright`'s shape: a comment after the closing brace, so the line no
# longer ends on it.
COMMENTED: Final = 'commented() { printf "%s" "$1"; } # why it reads so'

# Each ended on its own line by what follows the brace -- an `&`, a redirection, a `;` -- so a reader
# keyed to a line ending on the brace walks on to the block below.
BACKGROUNDED: Final = "backgrounded() { sleep 1 & }"
REDIRECTED: Final = 'redirected() { printf "%s" "$1"; } >&2'
TERMINATED: Final = 'terminated() { printf "%s" "$1"; };'

# Each holding a `; }` bash reads as text, inside quotes or inside a parameter expansion, so the body
# runs on to a closing line of its own.
QUOTED: Final = ("quoted() { printf '%s; } # %s\\n' \"$1\"", '  printf "and this"', "}")
EXPANDED: Final = ('expanded() { printf "%s" ${1:-;} # the default', '  printf "and this"', "}")

# The one-liners ahead of the blocks, which is the arrangement a walk mis-reads: with no closing line
# of its own the first lift runs on to the second function's.
MIXED: Final = "\n".join(
    (
        "#!/usr/bin/env bash",
        ONE_LINE,
        "",
        ALIGNED,
        "",
        COMMENTED,
        "",
        BACKGROUNDED,
        REDIRECTED,
        TERMINATED,
        "",
        *QUOTED,
        "",
        *EXPANDED,
        "",
        "a_block() {",
        '  printf "not this"',
        "}",
        "",
    )
)

NESTED: Final = "\n".join(("#!/usr/bin/env bash", "outer() {", "  " + INDENTED, "  inner x", "}", ""))

# Closed at a margin the caller did not name, so neither shape matches and the lift has no answer.
ADRIFT: Final = "\n".join(("#!/usr/bin/env bash", "adrift() {", '  printf "%s" "$1"', "  }", ""))

# `scripts/lib/_lib.sh :: require_file`'s shape: a body opening on the definition's line and closing
# on the next, where the closer shares its line with the body and no line is a bare `}`.
UNCLOSED: Final = "\n".join(
    (
        "#!/usr/bin/env bash",
        'unclosed() { [[ -f "$1" ]] || echo "missing: $1${2:+',
        '$2}"; }',
        "",
        "a_block() {",
        '  printf "not this"',
        "}",
        "",
    )
)

# A one-liner sharing its line with the next definition's opening, which leaves that line unclosed.
SHARED: Final = "\n".join(("#!/usr/bin/env bash", 'shared() { printf "%s" "$1"; }; other() {', '  printf "not this"', "}", ""))


def test_a_one_line_function_is_lifted_without_the_block_below_it(tmp_path: Path) -> None:
    """A wrong lift is a shell that still runs, so nothing but its text says the fixture is not the gate's."""
    script = write_shell(tmp_path / "mixed.sh", MIXED)

    assert lift_function(script, "one_line") == ONE_LINE


def test_a_one_line_function_padded_out_to_a_column_is_lifted_whole(tmp_path: Path) -> None:
    """Alignment on either side is cosmetic to bash, so a reader keyed to one space calls the run below it the body."""
    script = write_shell(tmp_path / "mixed.sh", MIXED)

    assert lift_function(script, "aligned") == ALIGNED


def test_a_one_line_function_with_a_trailing_comment_is_lifted_whole(tmp_path: Path) -> None:
    """Run on to the block below, the lift hands a sweep another function's body under this name, which it counts as this one's."""
    script = write_shell(tmp_path / "mixed.sh", MIXED)

    assert lift_function(script, "commented") == COMMENTED


@pytest.mark.parametrize("line", [BACKGROUNDED, REDIRECTED, TERMINATED], ids=["ampersand", "redirection", "semicolon"])
def test_a_one_line_function_ended_by_what_follows_its_brace_is_lifted_whole(line: str, tmp_path: Path) -> None:
    script = write_shell(tmp_path / "mixed.sh", MIXED)

    assert lift_function(script, line.split("(")[0]) == line


@pytest.mark.parametrize("block", [QUOTED, EXPANDED], ids=["quoted", "expanded"])
def test_a_brace_bash_reads_as_text_leaves_the_body_running_to_its_closing_line(block: tuple[str, ...], tmp_path: Path) -> None:
    """Read as closed, the lift hands back the opening line alone, and a sweep never reads the rest of the body."""
    script = write_shell(tmp_path / "mixed.sh", MIXED)

    assert lift_function(script, block[0].split("(")[0]) == "\n".join(block)


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


def test_a_body_the_opening_line_never_closes_is_refused_by_its_name(tmp_path: Path) -> None:
    """The silent over-lift this reader exists to prevent: the block below is what the walk hands back instead."""
    script = write_shell(tmp_path / "unclosed.sh", UNCLOSED)

    try:
        lift_function(script, "unclosed")
    except AssertionError as refusal:
        assert "unclosed" in str(refusal), refusal
    else:
        raise AssertionError("a function whose body outruns its opening line was lifted anyway")


def test_a_one_line_function_sharing_its_line_with_another_definition_is_refused_by_its_name(tmp_path: Path) -> None:
    """The line bash leaves open is the other definition's, so walking on from it hands back that function's body as this one's."""
    script = write_shell(tmp_path / "shared.sh", SHARED)

    try:
        lift_function(script, "shared")
    except AssertionError as refusal:
        assert "shared" in str(refusal), refusal
    else:
        raise AssertionError("a function sharing its opening line with another definition was lifted anyway")


def test_the_gates_own_one_line_function_comes_back_as_one_line() -> None:
    script = lift_function(VERIFY, "step_worker")

    assert script.startswith("step_worker() {") and "\n" not in script, script


def test_a_definition_padded_out_to_a_column_is_found_rather_than_refused() -> None:
    """`scripts/gate/verify.sh` aligns a block of definitions on their braces, and a reader keyed to one space refuses every one of them."""
    script = lift_function(VERIFY, "do_prettier")

    assert script.startswith("do_prettier()") and "pnpm format:check" in script, script
