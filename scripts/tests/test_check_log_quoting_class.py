"""SCRIPTS · the comparison of the console format's quoting class across the two packages

`check_log_quoting_class.py` reads one declaration per package, so every case here writes its own
pair: the class reader against the escapes and ranges either language spells a class with, and the
comparison against the three answers it owes -- a pair that agrees, one that drifted, and one whose
class it could not expand at all.

The real pair is driven too, so a drift in either file fails here and not only at the gate.

`scripts/checks/` is put on the path here because the module under test is run as a script
everywhere else, which is what seeds that directory onto the path for it.
"""

from __future__ import annotations

import contextlib
import importlib
import sys
from pathlib import Path

from conftest import details, severities, withdraw, write

SCRIPTS = Path(__file__).resolve().parents[1]

# Withdrawn at module import, kernel dropped from the cache with it: `test_check_docs.py` runs the
# gate from a throwaway copy of scripts/, and a `checker_kernel` cached here would answer its
# imports and root every check at the wrong repository.
sys.path.insert(0, str(SCRIPTS / "checks"))
try:
    quoting = importlib.import_module("check_log_quoting_class")
finally:
    sys.path.remove(str(SCRIPTS / "checks"))
    withdraw("check_log_quoting_class", "checker_kernel")

# The class both packages spell today, as the source text of either literal carries it. Written as
# escapes here for the reason the two literals are: every character in it is invisible.
SPACES = r"\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

# The two tails differ by the Python string literal's own escape of the quote, which is the one
# thing the reader has to see through before either class can be compared with the other.
BACKEND_CLASS = SPACES + r"='\""
FRONTEND_CLASS = SPACES + "='\""

# The plant this checker was driven red on: one surface stops quoting the byte-order mark.
DRIFTED_CLASS = SPACES.replace(r"\ufeff", "") + "='\""


def read(body: str) -> frozenset[int]:
    return quoting.code_points(body, "under-test")


def backend_source(body: str) -> str:
    """The declaration as the backend writes it: a raw string handed to `re.compile`."""
    return f'import re\n\nNEEDS_QUOTING = re.compile(r"[{body}]")\n'


def frontend_source(body: str) -> str:
    """The declaration as the frontend writes it: a regex literal carrying the unicode flag."""
    return f"const NEEDS_QUOTING = /[{body}]/u;\n"


def pair(tmp_path: Path, backend: str, frontend: str) -> list[str]:
    """One fixture pair on disk, as the two arguments `main` takes."""
    write(tmp_path, "logging.py", backend_source(backend))
    write(tmp_path, "logFormat.ts", frontend_source(frontend))
    return [str(tmp_path / "logging.py"), str(tmp_path / "logFormat.ts")]


def test_a_hex_escape_is_the_code_point_it_names():
    assert read(r"\u0041") == frozenset({0x41})


def test_a_range_expands_to_every_code_point_in_it():
    """The comparison is over characters, so a range left unexpanded could only ever compare spellings."""
    assert read(r"\u2000-\u200a") == frozenset(range(0x2000, 0x200B))


def test_an_escaped_punctuation_is_the_character_itself():
    """The backend's tail is `='\\"`, whose backslash belongs to the Python string and not to the class."""
    assert read(r"='\"") == frozenset({ord("="), ord("'"), ord('"')})


def test_a_hyphen_ending_a_class_is_a_character_and_not_a_range():
    """Both languages read it that way, and a reader that did not would take whatever follows as a range end."""
    assert read(r"\u0041-") == frozenset({0x41, ord("-")})


# `suppress` and a raise, not `pytest.raises`, throughout this file, for `scripts/tests/conftest.py`'s
# pytest invariant.
def test_a_shorthand_class_refuses():
    """The drift this checker exists for: `\\s` and `str.isspace()` disagree, so two shorthands compare nothing."""
    with contextlib.suppress(quoting.Unreadable):
        read(r"\s='\"")
        raise AssertionError("a shorthand class was expanded")


def test_a_negated_class_refuses():
    """A set built from what a negated class excludes would then be compared as though it were the class."""
    with contextlib.suppress(quoting.Unreadable):
        read(r"^\u0041")
        raise AssertionError("a negated class was expanded")


def test_a_range_running_backwards_refuses():
    with contextlib.suppress(quoting.Unreadable):
        read(r"\u0041-\u0030")
        raise AssertionError("a backwards range was expanded")


def test_a_hex_escape_short_of_its_digits_refuses():
    with contextlib.suppress(quoting.Unreadable):
        read(r"\u009")
        raise AssertionError("a truncated escape was read")


def test_an_empty_class_refuses():
    """Two emptied literals would agree, which is the loudest form of this defect and not an answer."""
    with contextlib.suppress(quoting.Unreadable):
        read("")
        raise AssertionError("an empty class was read")


def test_two_spellings_of_one_class_expand_alike():
    """What makes the comparison honest: neither language has to write a character the way the other does."""
    assert read(r"\u003d\u0027") == read(r"='")


def test_the_one_spelling_collapses_neighbours_into_a_range():
    """A finding quotes these whole, and thirty separate escapes would bury the handful that differ."""
    assert quoting.spelled(frozenset({0x41, 0x42, 0x43, 0x50})) == r"[\u0041-\u0043\u0050]"


def test_a_pair_that_agrees_is_no_finding():
    left = quoting.Spelling("left", read(BACKEND_CLASS))
    right = quoting.Spelling("right", read(FRONTEND_CLASS))

    assert quoting.disagreement(left, right) == []


def test_a_drifted_pair_names_both_spellings_and_what_only_one_side_quotes():
    """The repair is the handful of characters one side stopped quoting, which two whole classes do not show."""
    left = quoting.Spelling("left", read(BACKEND_CLASS))
    right = quoting.Spelling("right", read(DRIFTED_CLASS))

    findings = quoting.disagreement(left, right)

    assert severities(findings) == ["fail"]
    assert r"only left:  [\ufeff]" in details(findings)
    assert r"right:  [\u0009-\u000d" in details(findings)


def test_a_drift_reaches_the_exit_code(tmp_path, monkeypatch):
    """The red-first case: the dropped code point the plant behind this checker used, through `main`."""
    monkeypatch.setattr(sys, "argv", ["check_log_quoting_class.py", *pair(tmp_path, BACKEND_CLASS, DRIFTED_CLASS)])

    assert quoting.main() == 1


def test_a_pair_that_agrees_passes_through_main(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, "argv", ["check_log_quoting_class.py", *pair(tmp_path, BACKEND_CLASS, FRONTEND_CLASS)])

    assert quoting.main() == 0


def test_a_file_declaring_nothing_refuses(tmp_path, monkeypatch):
    """A renamed constant leaves two files with no declaration to disagree over, which is not two files that agree."""
    monkeypatch.setattr(sys, "argv", ["check_log_quoting_class.py", *pair(tmp_path, BACKEND_CLASS, FRONTEND_CLASS)])
    write(tmp_path, "logFormat.ts", "const QUOTED = /[=]/u;\n")

    assert quoting.main() == quoting.EXIT_REFUSED


def test_a_declaration_this_reader_cannot_take_a_class_out_of_refuses(tmp_path, monkeypatch):
    """Exit 2 rather than 1: nothing was compared, so there is no verdict on the two literals to give."""
    monkeypatch.setattr(sys, "argv", ["check_log_quoting_class.py", *pair(tmp_path, BACKEND_CLASS, FRONTEND_CLASS)])
    write(tmp_path, "logging.py", "NEEDS_QUOTING = re.compile(SOMEWHERE_ELSE)\n")

    assert quoting.main() == quoting.EXIT_REFUSED


def test_a_file_that_is_not_there_refuses(tmp_path, monkeypatch):
    """`OSError` is input the checker cannot judge, and a crash there would blame the machine for it."""
    monkeypatch.setattr(sys, "argv", ["check_log_quoting_class.py", str(tmp_path / "absent.py"), str(tmp_path / "absent.ts")])

    assert quoting.main() == quoting.EXIT_REFUSED


def test_the_repository_own_pair_is_one_class():
    """The check against the real files, so a drift in either fails here and not only at the gate."""
    left = quoting.lifted(quoting.REPO_ROOT / quoting.BACKEND, quoting.BACKEND, quoting.BACKEND_RE)
    right = quoting.lifted(quoting.REPO_ROOT / quoting.FRONTEND, quoting.FRONTEND, quoting.FRONTEND_RE)

    assert left.points != frozenset()
    assert quoting.disagreement(left, right) == []


def test_the_module_under_test_is_this_repository_own():
    """Names the import-order hazard the withdrawal above prevents, rather than leaving it silent."""
    assert quoting.REPO_ROOT == SCRIPTS.parent
