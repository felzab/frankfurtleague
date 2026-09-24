"""SCRIPTS · which slash the comment reader takes for a regex literal, read off the code before it.

Taken for a division, a literal's quote opens a string that hides every comment below it, and the
gate passes whatever those comments say; taken for a literal, a division's slash swallows the
comment after it on the same line. Each case lexes a module through the real reader.
"""

from __future__ import annotations

from pathlib import Path
from typing import Final

from conftest import import_scripts

SCRIPTS: Final = Path(__file__).resolve().parents[1]

[kernel] = import_scripts("docs_gate.kernel")

TYPESCRIPT: Final = ".ts"
COMMENT: Final = "// The comment below the literal."

# Each keyword stands where an expression opens, so the slash after it opens a literal. `instanceof`
# is the load-bearing row: a lead window under its ten characters cuts it to a word the set does not
# name.
KEYWORD_LEADS: Final[tuple[tuple[str, str], ...]] = (
    ("return", "function first(text) {\n  return /`/.test(text);\n}\n"),
    ("case", "switch (kind) {\n  case /`/.source:\n    break;\n}\n"),
    ("default", "export default /`/;\n"),
    ("delete", "delete /`/.lastIndex;\n"),
    ("do", "do /`/.exec(text); while (again());\n"),
    ("else", "if (plain) run(); else /`/.exec(text);\n"),
    ("extends", "class Tick extends /`/.constructor {}\n"),
    ("in", "const held = key in /`/;\n"),
    ("instanceof", "const same = value instanceof /`/.constructor;\n"),
    ("new", "const made = new /`/.constructor(text);\n"),
    ("throw", "throw /`/;\n"),
    ("typeof", "const kind = typeof /`/;\n"),
    ("void", "void /`/.exec(text);\n"),
    ("=>", "const tick = (text) => /`/.test(text);\n"),
)


def test_a_regex_literal_after_a_keyword_hides_no_comment_below_it() -> None:
    missed = [lead for lead, code in KEYWORD_LEADS if COMMENT not in kernel.comments_only(code + COMMENT + "\n", TYPESCRIPT)]
    assert not missed, "a literal after these was read as a division, and its tick hid the comment below: " + ", ".join(missed)


# The others end in a keyword's spelling, which a lead set matching a suffix rather than a word reads
# as that keyword; `counts.in` is a property, `$in` an identifier a `$` opens, and `notinstanceof`
# runs one character past the keyword.
DIVISION_LEADS: Final[tuple[str, ...]] = ("total", "margin", "undo", "counts.in", "$in", "notinstanceof")


def test_a_division_after_a_value_keeps_the_comment_after_it() -> None:
    """The other direction: a lead set widened past an expression's opening reads this slash as a literal."""
    lost = [lead for lead in DIVISION_LEADS if COMMENT not in kernel.comments_only(f"const half = {lead} / 2; " + COMMENT + "\n", TYPESCRIPT)]
    assert not lost, "a division after these was read as a literal, and it swallowed the comment after it: " + ", ".join(lost)
