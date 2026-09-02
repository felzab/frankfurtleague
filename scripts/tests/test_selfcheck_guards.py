"""SCRIPTS · the guards inside selfcheck.sh, driven rather than read.

Every one of these fails silently in the direction of a pass: a crashed hook reads as one that
allowed, a verdict with no trailing newline is dropped, and a helper the call reader cannot see
resolves for nobody. Each function is lifted out of the script rather than copied here, so a
regression in the gate's own copy is what fails.
"""

from __future__ import annotations

import shutil
import subprocess
import textwrap
from pathlib import Path
from typing import Final

SCRIPTS: Final = Path(__file__).resolve().parent.parent
SELFCHECK: Final = SCRIPTS / "gate" / "selfcheck.sh"
LIB: Final = SCRIPTS / "lib" / "_lib.sh"

# Not a skip condition, for `scripts/tests/test_exit_contract.py :: BASH`'s reason.
BASH: Final = shutil.which("bash")

# Joined from lines, for `test_gate_pool.py :: DRIVER`'s reason: a harness here is the lifted
# function plus the lines one case adds, and a tuple splices where a written-out block would not.
SHEBANG: Final = "#!/usr/bin/env bash"


def _function(name: str, indent: str = "") -> str:
    """One function's source, taken out of selfcheck.sh by its opening and closing lines.

    Read rather than reimplemented: a copy here would pass while the gate's own copy regressed.
    """
    lines = SELFCHECK.read_text(encoding="utf-8").splitlines()
    start = next((i for i, line in enumerate(lines) if line.startswith(f"{indent}{name}() {{")), -1)
    assert start >= 0, f"selfcheck.sh no longer defines {name}"
    end = next((i for i in range(start + 1, len(lines)) if lines[i] == f"{indent}}}"), -1)
    assert end > start, f"selfcheck.sh's {name} has no closing line"
    return textwrap.dedent("\n".join(lines[start : end + 1]))


def _bash(lines: tuple[str, ...], cwd: Path) -> tuple[int, str, str]:
    """The harness written with `newline=""` and handed to bash as a path.

    Windows would otherwise turn every newline into a carriage return pair, and bash reads the
    result as one unterminated line.
    """
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    fixture = cwd / "drive.sh"
    with open(fixture, "w", newline="", encoding="utf-8") as handle:
        handle.write("\n".join((*lines, "")))
    # `encoding` rather than `text=True`: that decodes with the machine locale, which is cp1252 on
    # Windows, and every verdict here carries an em dash.
    done = subprocess.run((BASH, fixture.as_posix()), capture_output=True, encoding="utf-8", cwd=cwd)
    return done.returncode, done.stdout, done.stderr


# Each fake hook fails in a way that leaves stdout empty, which is also how a hook says "allowed".
FAKE_HOOKS: Final[tuple[tuple[str, str], ...]] = (
    ("syntaxerr.sh", "if [\n"),
    ("exit2.sh", "#!/usr/bin/env bash\nexit 2\n"),
    ("onstderr.sh", "#!/usr/bin/env bash\nprintf deny >&2\nexit 0\n"),
    ("allows.sh", "#!/usr/bin/env bash\nexit 0\n"),
)

PAYLOAD_FN: Final = 'cmd_payload() { printf \'{"tool_input":{"command":"%s"}}\' "$1"; }'


def test_a_crashed_hook_is_not_read_as_one_that_allowed(tmp_path: Path) -> None:
    """Silence on stdout is how a hook allows, and how every failure of one looks.

    Without the status and stderr, a guard that has started erroring on some input reads as a guard
    that ran and allowed -- the one regression the hook probes exist to catch.
    """
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    for name, body in FAKE_HOOKS:
        (hooks / name).write_text(body, encoding="utf-8", newline="\n")
    (tmp_path / "repo").mkdir()
    names = [name for name, _ in FAKE_HOOKS] + ["absent.sh"]
    _, out, err = _bash(
        (
            SHEBANG,
            f"source {LIB.as_posix()!r}",
            f"HOOKS_DIR={hooks.as_posix()!r}",
            f"HOOK_REPO={(tmp_path / 'repo').as_posix()!r}",
            'SELFCHECK_TMP="$(mktemp -d)"',
            "PROBE_HOOK=(" + " ".join(names) + ")",
            "PROBE_WANT=(" + " ".join(["allowed"] * len(names)) + ")",
            "PROBE_KIND=(" + " ".join(["cmd"] * len(names)) + ")",
            "PROBE_SUBJ=(" + " ".join(["x"] * len(names)) + ")",
            PAYLOAD_FN,
            _function("unit_probe", "  "),
            f'for (( i = 0; i < {len(names)}; i++ )); do unit_probe "$i" "" "probe-${{i}}"; done',
        ),
        tmp_path,
    )
    verdicts = [line.split("\t", 1)[1] for line in out.splitlines() if "\t" in line]
    assert len([v for v in verdicts if "crashed" in v]) == 4, f"{out!r} {err!r}"
    assert [v for v in verdicts if v.endswith("allowed")], f"{out!r} {err!r}"


def _par_run_harness(body: tuple[str, ...], tmp_path: Path) -> tuple[int, str, str]:
    """`par_run` with the note verbs stubbed, so a verdict it reads back is counted here."""
    return _bash(
        (
            SHEBANG,
            f"source {LIB.as_posix()!r}",
            'SELFCHECK_TMP="$(mktemp -d)"',
            "PAR_WIDTH=2",
            "FAILURES=0",
            "note_fail() { printf 'FAIL %s\\n' \"$*\"; FAILURES=$(( FAILURES + 1 )); }",
            "note_skip() { printf 'SKIP %s\\n' \"$*\"; }",
            "note_warn() { printf 'WARN %s\\n' \"$*\"; }",
            "info() { printf 'INFO %s\\n' \"$*\"; }",
            "PAR_ITEMS=(); PAR_LABELS=(); PROBE_HOOK=(); PROBE_WANT=(); PROBE_KIND=(); PROBE_SUBJ=()",
            _function("par_reset"),
            _function("par_add"),
            _function("par_run"),
            *body,
            "printf 'FAILURES=%s\\n' \"$FAILURES\"",
        ),
        tmp_path,
    )


QUEUE_THREE: Final = 'for n in a b c; do par_add "$n" "$n"; done'


def test_par_run_reads_a_verdict_with_no_trailing_newline(tmp_path: Path) -> None:
    """`read` returns non-zero on an unterminated final line, having filled the variables anyway.

    Dropped there, a unit's last finding disappears with the run still green: the file is not
    empty, so the "no verdict, twice" arm does not fire either.
    """
    _, out, err = _par_run_harness(
        (
            'unit() { printf %s "fail\\tunit ${3} is broken"; }',
            QUEUE_THREE,
            "par_run unit",
        ),
        tmp_path,
    )
    assert "FAILURES=3" in out, f"{out!r} {err!r}"


def test_par_run_survives_a_unit_that_exits(tmp_path: Path) -> None:
    """The serial retry runs in a subshell: `|| true` grades a status and does not contain an `exit`.

    In the parent shell a unit reaching `die` ends the whole run mid-step, before any summary.
    """
    status, out, err = _par_run_harness(
        (
            "unit() { if (( $1 == 0 )); then exit 1; fi; printf 'info\\t%s\\n' \"$3\"; }",
            QUEUE_THREE,
            "par_run unit",
        ),
        tmp_path,
    )
    assert status == 0, f"{out!r} {err!r}"
    assert "FAILURES=1" in out, out


def test_the_helper_check_reads_its_subjects_out_of_the_scripts(tmp_path: Path) -> None:
    """A pattern built from what `_lib.sh` defines can only match names that resolve (PRE-4).

    `set_not_run` proved it: defined in `_lib.sh`, called by `verify.sh` after a `then`, and
    invisible to a hand-written alternation that never spelled it.
    """
    held = SELFCHECK.read_text(encoding="utf-8").split("CMD_WORDS='", 1)
    assert len(held) == 2, "selfcheck.sh no longer holds the call-site reader"
    reader = tmp_path / "reader.awk"
    reader.write_text(held[1].split("\n'\n", 1)[0], encoding="utf-8", newline="\n")
    done = subprocess.run(
        ["awk", "-f", reader.as_posix(), (SCRIPTS / "gate" / "verify.sh").as_posix()],
        capture_output=True,
        encoding="utf-8",
    )
    assert done.returncode == 0, done.stderr
    assert "call\tset_not_run" in done.stdout, "verify.sh's set_not_run call is invisible to the reader"


# Three characters the fixtures below cannot spell in a line literal without an escape a reader of
# this file would have to count: a backslash, the quote awk is told about, and a dollar beside one.
BS: Final = chr(92)
SQ: Final = chr(39)
DOLLAR: Final = chr(36)


def _reader(tmp_path: Path) -> Path:
    """The call-site reader, lifted out of selfcheck.sh's `CMD_WORDS` and written where awk can read it."""
    held = SELFCHECK.read_text(encoding="utf-8").split("CMD_WORDS='", 1)
    assert len(held) == 2, "selfcheck.sh no longer holds the call-site reader"
    reader = tmp_path / "reader.awk"
    reader.write_text(held[1].split("\n'\n", 1)[0], encoding="utf-8", newline="\n")
    return reader


# One fixture per construct the reader was driven against: its lines, the helper that must still
# read as a call (the control a fix may not cost), the name that must not, and the name that may
# appear in no record at all.
MIS_LEX: Final[tuple[tuple[str, tuple[str, ...], str, str, str], ...]] = (
    ("continuation", ("some_cmd foo " + BS, "  my_plain_argument", "real_one x"), "real_one", "my_plain_argument", ""),
    ("array literal", ("arr=( arr_helper second_word )", "real_two x"), "real_two", "arr_helper", ""),
    (
        "nested case",
        ("case $a in", " one_p)", "  case $b in", "   in_p) real_three x ;;", "  esac", "  ;;", " two_p) real_four x ;;", "esac"),
        "real_four",
        "two_p",
        "",
    ),
    ("command from a variable", ("$my_runner --flag", "real_five x"), "real_five", "", "my_runner"),
    ("assignment substitution", ("x=$(real_six arg)",), "real_six", "", ""),
    ("double-quoted assignment prefix", ('FOO="bar" real_seven x',), "real_seven", "", ""),
    ("ansi-c assignment prefix", ("IFS=" + DOLLAR + SQ + BS + "t" + SQ + " real_ten x",), "real_ten", "", ""),
    ("punctuated heredoc, quoted", ("cat <<" + SQ + "EOF-1" + SQ, "body", "EOF-1", "real_eight x"), "real_eight", "", ""),
    ("punctuated heredoc, bare", ("cat <<END-OF", "body", "END-OF", "real_eleven x"), "real_eleven", "", ""),
    ("here-string", ('done <<< "$heads"', "real_nine x"), "real_nine", "", ""),
)


def test_the_reader_lexes_seven_constructs_it_used_to_get_wrong(tmp_path: Path) -> None:
    """Four of these reddened the gate on correct code and three lost a call in silence.

    Each row carries a control helper that must still read as a call, so a class closed by seeing
    fewer call sites fails here rather than passing quietly.
    """
    reader = _reader(tmp_path)
    wrong: list[str] = []
    for label, lines, must_call, must_not_call, absent in MIS_LEX:
        fixture = tmp_path / "fixture.sh"
        with open(fixture, "w", newline="", encoding="utf-8") as handle:
            handle.write("\n".join((*lines, "")))
        done = subprocess.run(["awk", "-f", reader.as_posix(), fixture.as_posix()], capture_output=True, encoding="utf-8")
        assert done.returncode == 0, f"{label}: {done.stderr}"
        calls = {line.split("\t", 1)[1] for line in done.stdout.splitlines() if line.startswith("call\t")}
        if must_call not in calls:
            wrong.append(f"{label}: {must_call} is no longer read as a call -- {done.stdout!r}")
        if must_not_call and must_not_call in calls:
            wrong.append(f"{label}: {must_not_call} is read as a call -- {done.stdout!r}")
        if absent and absent in done.stdout:
            wrong.append(f"{label}: {absent} was read as a word of some kind -- {done.stdout!r}")
        if "unterminated" in done.stdout:
            wrong.append(f"{label}: the reader stopped -- {done.stdout!r}")
    assert not wrong, "\n".join(wrong)
