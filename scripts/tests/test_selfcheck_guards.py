"""SCRIPTS · the guards inside selfcheck.sh, driven rather than read.

Every one of these fails silently in the direction of a pass: a verdict with no trailing newline
is dropped, a registration naming no script runs nothing, and a helper the call reader cannot see
resolves for nobody. Each function is lifted out of the script rather than copied here, so a
regression in the gate's own copy is what fails.
"""

from __future__ import annotations

import ast
import json
import re
import shutil
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Final

import pytest
from conftest import BASH, declared, lift_function, run_shell, write_shell

SCRIPTS: Final = Path(__file__).resolve().parent.parent
SELFCHECK: Final = SCRIPTS / "gate" / "selfcheck.sh"
LIB: Final = SCRIPTS / "lib" / "_lib.sh"
CHECKER: Final = SCRIPTS / "checks" / "docs_gate" / "checks.py"

# Every line-anchored awk pattern the script spells, so a literal is found wherever inside it the
# reader that arms on one has moved to.
AWK_PATTERN_RE: Final = re.compile(r"/(\^[^/\n]*)/")


# A value rather than a `skipif`: without node every row reaches the same arm, so each is still
# read, for the line its machine can print.
NODE: Final = shutil.which("node")
NO_NODE_SAID: Final = "FAIL no hook registration was read"


def _said(expected: str) -> str:
    """The whole line a row is read for, its verb included: a finding downgraded to an `info` says the same words."""
    return expected if NODE else NO_NODE_SAID


# Joined from lines, for `test_gate_pool.py :: DRIVER`'s reason: a harness here is the lifted
# function plus the lines one case adds, and a tuple splices where a written-out block would not.
SHEBANG: Final = "#!/usr/bin/env bash"


def _function(name: str, indent: str = "") -> str:
    return lift_function(SELFCHECK, name, indent)


def _bash(lines: tuple[str, ...], cwd: Path) -> tuple[int, str, str]:
    """The harness handed to bash as a path, its two streams read apart."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    done = run_shell(BASH, write_shell(cwd / "drive.sh", "\n".join((*lines, ""))), cwd=cwd)
    return done.returncode, done.stdout, done.stderr


def _reader(tmp_path: Path) -> Path:
    """The call-site reader, lifted out of selfcheck.sh's `CMD_WORDS` and written where awk reads it."""
    held = SELFCHECK.read_text(encoding="utf-8").split("CMD_WORDS='", 1)
    assert len(held) == 2, "selfcheck.sh no longer holds the call-site reader"
    reader = tmp_path / "reader.awk"
    reader.write_text(held[1].split("\n'\n", 1)[0], encoding="utf-8", newline="\n")
    return reader


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
            "PAR_ITEMS=(); PAR_LABELS=()",
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
    done = subprocess.run(
        ["awk", "-f", _reader(tmp_path).as_posix(), (SCRIPTS / "gate" / "verify.sh").as_posix()],
        capture_output=True,
        encoding="utf-8",
    )
    assert done.returncode == 0, done.stderr
    assert "call\tset_not_run" in done.stdout, "verify.sh's set_not_run call is invisible to the reader"


def _armed_patterns(source: str) -> set[str]:
    """Every line-anchored awk pattern in a stretch of shell, its escaping dropped.

    Unescaped rather than the checker's constant escaped: awk leaves a space alone where
    `re.escape` escapes it, so the two could never agree.
    """
    return {pattern.replace("\\", "") for pattern in AWK_PATTERN_RE.findall(source)}


def _lead_in_names(source: Path) -> list[str]:
    """Every constant the checker declares whose name ends `_LEAD_IN`.

    Swept rather than listed here: a lead-in this file had to be told about is one a checker can
    gain while the reader beside it gains nothing.
    """
    return [
        name
        for node in ast.walk(ast.parse(source.read_text(encoding="utf-8")))
        if isinstance(node, ast.AnnAssign) and (name := getattr(node.target, "id", "")).endswith("_LEAD_IN")
    ]


def test_the_helper_tables_are_read_off_the_same_literals() -> None:
    """Compared in both directions: a lead-in armed in one file alone reads a table the other keeps no verdict on.

    This script skips where the gate fails, so a drifted pair leaves the skip on somebody else's
    branch.
    """
    reader = _armed_patterns(_function("check_documented_helpers"))
    assert reader, "no line-anchored awk pattern was read out of the reader, so nothing was compared"
    names = _lead_in_names(CHECKER)
    assert names, f"{CHECKER.name} declares no lead-in, so nothing was compared"
    spelled = {str(declared(CHECKER, name)).replace("\\", "") for name in names}
    # The bold opener is what a lead-in is, and the reader arms on nothing else that carries one.
    assert {pattern for pattern in reader if "**" in pattern} == spelled, f"{sorted(reader)} against {sorted(spelled)}"
    column = str(declared(CHECKER, "OUTPUT_VERB_COLUMN")).replace("\\", "")
    assert column in reader, f"OUTPUT_VERB_COLUMN is spelled in no awk pattern of the reader: {sorted(reader)}"


# A sheet in the shape the reader walks: two lead-ins, a table under each, and prose between them.
FIXTURE_SHEET: Final = """**The output standard.** One vocabulary, one verb per meaning:

| Verb   | Means                    |
| ------ | ------------------------ |
| `die`  | A finding that ends it   |

Prose the reader steps over on its way down the sheet.

**The helpers a script leans on.** Not output verbs:

| Helper      | Answers                  |
| ----------- | ------------------------ |
| `verbose`   | Whether to stream        |
| `worker`    | Whether this is a worker |
| `quietly`   | Runs a command captured  |
| `usage`     | Prints the header        |
"""

# `DEFINED` comes off the opening `name()` of every line, so a body is what the fixture may drop.
FIXTURE_LIB: Final = "".join(f"{name}() {{ :; }}\n" for name in ("die", "verbose", "worker", "quietly", "usage"))


def _documented_helpers(sheet: Path, lib: Path, tmp_path: Path) -> str:
    """Step 4's vocabulary route over a fixture sheet and a fixture library, its verbs stubbed."""
    _, out, err = _bash(
        (
            SHEBANG,
            f"source {LIB.as_posix()!r}",
            'SELFCHECK_TMP="$(mktemp -d)"',
            "note_fail() { printf 'FAIL %s\\n' \"$*\"; }",
            "note_skip() { printf 'SKIP %s\\n' \"$*\"; }",
            "info() { printf 'INFO %s\\n' \"$*\"; }",
            _function("read_lib_definitions"),
            _function("check_documented_helpers"),
            f"read_lib_definitions {lib.as_posix()!r}",
            f"check_documented_helpers {sheet.as_posix()!r}",
        ),
        tmp_path,
    )
    return out + err


def test_a_helper_the_sheet_names_and_the_library_dropped_is_a_finding(tmp_path: Path) -> None:
    """Driven over both tables, the second being the one the reader reaches last.

    Every name in either is a single word, which step 4's call-site reader drops by design, so a
    rename in `_lib.sh` is caught here or nowhere.
    """
    sheet = write_shell(tmp_path / "spec.md", FIXTURE_SHEET)
    whole = write_shell(tmp_path / "whole.sh", FIXTURE_LIB)
    intact = _documented_helpers(sheet, whole, tmp_path)
    assert "FAIL" not in intact and "SKIP" not in intact, intact
    for renamed in ("die", "quietly"):
        dropped = write_shell(tmp_path / "dropped.sh", FIXTURE_LIB.replace(f"{renamed}()", "hushed()"))
        out = _documented_helpers(sheet, dropped, tmp_path)
        assert "FAIL" in out and renamed in out, f"{renamed}: {out!r}"


def _registration(hook: str, event: str = "PreToolUse") -> str:
    """One entry, spelled as `.claude/settings.json` spells one."""
    command = 'bash "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/' + hook + '"'
    entry = {"type": "command", "command": command, "timeout": 10}
    return json.dumps({"hooks": {event: [{"matcher": "Bash", "hooks": [entry]}]}})


def _check_registrations(settings: Path, hooks: Path, tmp_path: Path) -> str:
    """The step-13 registration read over a fixture pair, its verbs stubbed."""
    _, out, err = _bash(
        (
            SHEBANG,
            f"source {LIB.as_posix()!r}",
            "note_fail() { printf 'FAIL %s\\n' \"$*\"; }",
            "info() { printf 'INFO %s\\n' \"$*\"; }",
            _function("check_hook_registrations", "  "),
            f"check_hook_registrations {settings.as_posix()!r} {hooks.as_posix()!r}",
        ),
        tmp_path,
    )
    return out + err


def test_a_registration_whose_script_is_missing_is_a_finding(tmp_path: Path) -> None:
    """The harness runs nothing for it and says nothing, so the hook reads as one with nothing to say."""
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    settings = write_shell(tmp_path / "settings.json", _registration("gone.sh", "Stop"))
    out = _check_registrations(settings, hooks, tmp_path)
    assert _said(f"FAIL {settings.as_posix()} registers gone.sh on Stop, and it is not in {hooks.as_posix()}") in out, out


def test_a_registration_whose_script_is_there_passes(tmp_path: Path) -> None:
    """The contrast the case above needs: a read failing every registration would pass it."""
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    write_shell(hooks / "plain.sh", "#!/usr/bin/env bash\nexit 0\n")
    settings = write_shell(tmp_path / "settings.json", _registration("plain.sh"))
    out = _check_registrations(settings, hooks, tmp_path)
    assert _said("INFO plain.sh: registered on PreToolUse, and there") in out, out
    if NODE:
        assert "FAIL" not in out, out


def _check_matcher(matcher: str, tmp_path: Path) -> str:
    """The step-12 matcher read over one registration, asked for the three shell tools."""
    registration = json.loads(_registration("guard.sh"))
    registration["hooks"]["PreToolUse"][0]["matcher"] = matcher
    settings = write_shell(tmp_path / "settings.json", json.dumps(registration))
    _, out, err = _bash(
        (
            SHEBANG,
            f"source {LIB.as_posix()!r}",
            "note_fail() { printf 'FAIL %s\\n' \"$*\"; }",
            "info() { printf 'INFO %s\\n' \"$*\"; }",
            _function("check_hook_matcher", "  "),
            f"check_hook_matcher {settings.as_posix()!r} PreToolUse guard.sh Bash Monitor PowerShell",
        ),
        tmp_path,
    )
    return out + err


# The line a machine without node prints for every row, read for in place of the row's own.
NO_NODE_MATCHER: Final = "FAIL guard.sh's PreToolUse registration in"


def test_a_matcher_missing_one_tool_is_a_finding_naming_that_tool(tmp_path: Path) -> None:
    """A guard registered on `Bash` alone runs for no `Monitor` call, and its own probes stay green."""
    out = _check_matcher("Bash|PowerShell", tmp_path)
    if not NODE:
        assert NO_NODE_MATCHER in out, out
        return
    assert "registers guard.sh on PreToolUse with no matcher taking Monitor" in out, out
    assert out.count("FAIL") == 1, out


def test_a_matcher_taking_every_tool_passes_in_either_list_form(tmp_path: Path) -> None:
    """The contrast the case above needs, in both spellings the harness reads as an exact list."""
    for matcher in ("Bash|Monitor|PowerShell", "Bash, Monitor, PowerShell"):
        out = _check_matcher(matcher, tmp_path)
        if not NODE:
            assert NO_NODE_MATCHER in out, out
            continue
        assert "INFO guard.sh: registered on PreToolUse for Bash Monitor PowerShell" in out and "FAIL" not in out, (matcher, out)


# Three characters the fixtures below cannot spell in a line literal without an escape a reader of
# this file would have to count: a backslash, the quote awk is told about, and a dollar beside one.
BS: Final = chr(92)
SQ: Final = chr(39)
DOLLAR: Final = chr(36)


# One fixture per construct the reader was driven against: its lines, the helper that must still
# read as a call (the control a fix may not cost), the name that must not, and the name that may
# appear in no record at all.

# A row naming something that must not read as a call is a construct that reddened the gate on
# correct code; one carrying only its control lost a call in silence.
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
    ("for list", ("for package in list_one list_two; do real_twelve x; done",), "real_twelve", "list_one", ""),
    ("select list", ("select choice in pick_one pick_two; do real_thirteen x; done",), "real_thirteen", "pick_one", ""),
)


def test_every_shape_the_call_site_reader_once_mis_lexed(tmp_path: Path) -> None:
    """A punctuated heredoc is the load-bearing row: a reader that misses its closing word stops, leaving every call below unread.

    The control helper in each row fails a fix that closes a class by seeing fewer calls.
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


# Each pin check, the manifest spelling its pin, the image line naming a tag, the pin, and a release
# the pin does not admit. The Python row's pin names a series, which a release inside it satisfies.
PIN_CHECKS: Final[dict[str, tuple[str, Callable[[str], str], str, str]]] = {
    "check_uv_pin": ('required-version = "==0.12.19"\n', lambda tag: f"FROM ghcr.io/astral-sh/uv:{tag}@sha256:0 AS uv\n", "0.12.19", "0.12.20"),
    "check_node_pin": (
        '{\n  "version": "1.0.0",\n  "devEngines": {\n    "runtime": {\n      "name": "node",\n      "version": "26.10.0"\n    }\n  }\n}\n',
        lambda tag: f"FROM node:{tag}-trixie-slim@sha256:0 AS base\n",
        "26.10.0",
        "26.11.0",
    ),
    "check_pnpm_pin": ('{\n  "packageManager": "pnpm@11.27.1"\n}\n', lambda tag: f"ARG PNPM_VERSION={tag}\n", "11.27.1", "11.28.0"),
    "check_python_series": ("3.14\n", lambda tag: f"FROM python:{tag}-slim@sha256:0 AS base\n", "3.14.7", "3.15.0"),
}


def _pin_check(name: str, manifest: str, dockerfile: str, tmp_path: Path) -> str:
    """One pin step's check, lifted with the helper it calls, over a fixture pair; its verbs stubbed."""
    pinned = write_shell(tmp_path / "manifest", manifest)
    image = write_shell(tmp_path / "Dockerfile", dockerfile)
    _, out, err = _bash(
        (
            SHEBANG,
            f"source {LIB.as_posix()!r}",
            "note_fail() { printf 'FAIL %s\\n' \"$*\"; }",
            "info() { printf 'INFO %s\\n' \"$*\"; }",
            _function("first_disagreeing_tag"),
            _function("judge_pin"),
            _function(name),
            f"{name} {pinned.as_posix()!r} {image.as_posix()!r}",
        ),
        tmp_path,
    )
    return out + err


@pytest.mark.parametrize("name", sorted(PIN_CHECKS))
def test_a_pin_every_stage_agrees_with_passes(name: str, tmp_path: Path) -> None:
    """Two stages naming the admitted release: the control, or a check refusing everything passes the cases below."""
    manifest, stage, admitted, _ = PIN_CHECKS[name]

    said = _pin_check(name, manifest, stage(admitted) + stage(admitted), tmp_path)

    assert "INFO" in said and "FAIL" not in said, said


@pytest.mark.parametrize("name", sorted(PIN_CHECKS))
def test_a_later_stage_naming_another_release_fails(name: str, tmp_path: Path) -> None:
    """The second stage is the load-bearing one: read as one value with the first, the series row's glob matched across the break."""
    manifest, stage, admitted, other = PIN_CHECKS[name]

    said = _pin_check(name, manifest, stage(admitted) + stage(other), tmp_path)

    assert f"FAIL {(tmp_path / 'manifest').as_posix()}" in said and other in said, said


@pytest.mark.parametrize("name", sorted(PIN_CHECKS))
def test_a_side_it_cannot_read_fails(name: str, tmp_path: Path) -> None:
    """A spelling the reader misses would otherwise pass as agreement, on either side."""
    manifest, stage, admitted, _ = PIN_CHECKS[name]

    for pinned, image in (("{}\n", stage(admitted)), (manifest, "FROM scratch\n")):
        said = _pin_check(name, pinned, image, tmp_path)

        assert "FAIL could not read" in said, said
