"""SCRIPTS · the guards inside selfcheck.sh, driven rather than read.

Every one of these fails silently in the direction of a pass: a crashed hook reads as one that
allowed, a verdict with no trailing newline is dropped, and a helper the call reader cannot see
resolves for nobody. Each function is lifted out of the script rather than copied here, so a
regression in the gate's own copy is what fails.
"""

from __future__ import annotations

import ast
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Final

from conftest import declared, lift_function, run_shell, write_shell

SCRIPTS: Final = Path(__file__).resolve().parent.parent
SELFCHECK: Final = SCRIPTS / "gate" / "selfcheck.sh"
LIB: Final = SCRIPTS / "lib" / "_lib.sh"
CHECKER: Final = SCRIPTS / "checks" / "docs_gate" / "checks.py"

# Every line-anchored awk pattern the script spells, so a literal is found wherever inside it the
# reader that arms on one has moved to.
AWK_PATTERN_RE: Final = re.compile(r"/(\^[^/\n]*)/")

# Not a skip condition, for `scripts/tests/test_exit_contract.py :: BASH`'s reason.
BASH: Final = shutil.which("bash")

# A value rather than a `skipif`: nothing here imports pytest (`scripts/tests/conftest.py`), and
# without node every row reaches the same arm, so each is read for the line its machine can print.
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
    """The harness handed to bash as a path, its two streams read apart.

    A hook's stderr is a verdict of its own here, so it may not be merged into the stdout the
    verdicts are counted from.
    """
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


# The verdict shape a guard prints on the way to refusing something.
REFUSAL: Final = '{"hookSpecificOutput":{"permissionDecision":"deny"}}'

# Each fake hook fails in a way that leaves stdout empty, which is also how a hook says "allowed" --
# apart from the last, whose stdout carries a correct refusal and whose status says it died.
FAKE_HOOKS: Final[tuple[tuple[str, str, bool], ...]] = (
    ("syntaxerr.sh", "if [\n", True),
    ("exit2.sh", "#!/usr/bin/env bash\nexit 2\n", True),
    ("onstderr.sh", "#!/usr/bin/env bash\nprintf deny >&2\nexit 0\n", True),
    ("allows.sh", "#!/usr/bin/env bash\nexit 0\n", False),
    ("refuses_then_dies.sh", "#!/usr/bin/env bash\nprintf '" + REFUSAL + "'\nexit 3\n", True),
)

# Driven beside the hooks above and written nowhere: an absent file is silent the way each of them
# is, and it is the one case no fixture body can produce.
ABSENT_HOOK: Final[tuple[str, bool]] = ("absent.sh", True)

PAYLOAD_FN: Final = 'cmd_payload() { printf \'{"tool_input":{"command":"%s"}}\' "$1"; }'


def test_a_crashed_hook_is_not_read_as_one_that_allowed(tmp_path: Path) -> None:
    """A hook allows by printing nothing, and every failure of one looks the same.

    The row that refuses and then dies is the other half: graded by its stdout, a crash reads as
    the refusal it printed.
    """
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    for name, body, _ in FAKE_HOOKS:
        (hooks / name).write_text(body, encoding="utf-8", newline="\n")
    (tmp_path / "repo").mkdir()
    probes = [(name, crashes) for name, _, crashes in FAKE_HOOKS] + [ABSENT_HOOK]
    names = [name for name, _ in probes]
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
    graded = [line for line in out.splitlines() if "\t" in line]
    assert len(graded) == len(probes), f"{out!r} {err!r}"
    for (name, crashes), line in zip(probes, graded, strict=True):
        verb, verdict = line.split("\t", 1)
        # Read off the verb as well as the text: every probe here wants `allowed`, so a fail line
        # quotes the word `allowed` back and a substring test alone would clear a wrong grade.
        crashed = verb == "fail" and "crashed" in verdict
        assert crashed is crashes, f"{name}: {line!r} {err!r}"


def _build_hook_fixture(repo: Path, tmp_path: Path) -> tuple[str, str]:
    """The builder run from the script's own calling position, an `if !`.

    Bash disarms errexit for everything a compound command there runs, so a status not carried by
    hand never reaches the caller.
    """
    _, out, err = _bash(
        (
            SHEBANG,
            f"source {LIB.as_posix()!r}",
            f"HOOK_REPO={repo.as_posix()!r}",
            _function("build_hook_fixture", "  "),
            "if ! quietly build_hook_fixture; then printf 'REPORTED\\n'; else printf 'SILENT\\n'; fi",
        ),
        tmp_path,
    )
    return out, err


# The builder's own list, so a path added to it is covered here without this file being touched.
TRACKED_LIST_RE: Final = re.compile(r"for tracked in (.*?); do", re.DOTALL)


def test_the_hook_fixture_holds_every_file_its_list_names(tmp_path: Path) -> None:
    """Nothing downstream asks whether a probe's subject is on disk: `git check-ignore` answers for a path nobody wrote.

    The probes on the tracked half of each pair then run against a fixture that has none.
    """
    listed = TRACKED_LIST_RE.search(_function("build_hook_fixture", "  "))
    assert listed is not None, "build_hook_fixture no longer lists the files it writes"
    repo = tmp_path / "repo"
    out, err = _build_hook_fixture(repo, tmp_path)
    assert "REPORTED" not in out, f"{out!r} {err!r}"
    absent = [name for name in listed.group(1).replace("\\", " ").split() if not (repo / name).is_file()]
    assert not absent, f"{absent} -- {out!r} {err!r}"


def test_the_hook_fixture_reports_a_file_it_could_not_write(tmp_path: Path) -> None:
    """A blocked write otherwise leaves the caller told the fixture was built.

    Its own `set -e` cannot report it from the position it is called in, so the status is carried
    out of the loop by hand.
    """
    repo = tmp_path / "repo"
    (repo / "scripts").mkdir(parents=True)
    # A file where the builder must make a directory: `mkdir -p` refuses it, and the tracked file
    # underneath it cannot be written.
    write_shell(repo / "scripts" / "gate", "blocked\n")
    out, err = _build_hook_fixture(repo, tmp_path)
    assert "REPORTED" in out, f"{out!r} {err!r}"


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


# A guard in the shape the comparison reads: a decision handed to a child under a kill budget.
FIXTURE_GUARD: Final = '#!/usr/bin/env bash\nanswer="$(timeout -s KILL 15 bash "$0" --decide)"\n'


def _guard(dispatch: str) -> str:
    """One guard whose child is spelled the way the row under test spells it, or run under nothing at all."""
    run = f"{dispatch} " if dispatch else ""
    return f'#!/usr/bin/env bash\nanswer="$({run}bash "$0" --decide)"\n'


def _registration(seconds: int, event: str = "PreToolUse", hook: str = "guard.sh") -> str:
    """One entry, spelled as `.claude/settings.json` spells one."""
    command = 'bash "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/' + hook + '"'
    entry = {"type": "command", "command": command, "timeout": seconds}
    return json.dumps({"hooks": {event: [{"matcher": "Bash", "hooks": [entry]}]}})


def _agent_definition(seconds: int | None, hook: str = "guard.sh") -> str:
    """One agent's own registration, in the frontmatter shape `.claude/agents/` carries it.

    `None` leaves the timeout line out, which the frontmatter allows and the harness reads as no
    bound of its own.
    """
    command = '          command: bash "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/' + hook + '"'
    lines = [
        "---",
        "name: fixture",
        "hooks:",
        "  PreToolUse:",
        '    - matcher: "Write"',
        "      hooks:",
        "        - type: command",
        command,
    ]
    if seconds is not None:
        lines.append(f"          timeout: {seconds}")
    lines += ["---", ""]
    return "\n".join(lines)


def _compare_budgets(settings: Path, hooks: Path, tmp_path: Path, agents: Path | None = None) -> str:
    """The step-14 comparison over a fixture pair, its verbs stubbed.

    The default agents directory is there and empty, which registers nothing: a directory that is
    not there is a finding of its own.
    """
    if agents is None:
        agents = tmp_path / "no-agents"
        agents.mkdir(exist_ok=True)
    _, out, err = _bash(
        (
            SHEBANG,
            f"source {LIB.as_posix()!r}",
            "note_fail() { printf 'FAIL %s\\n' \"$*\"; }",
            "info() { printf 'INFO %s\\n' \"$*\"; }",
            _function("hook_child_budgets", "  "),
            _function("hook_reenters", "  "),
            _function("agent_registrations", "  "),
            _function("compare_hook_budgets", "  "),
            f"compare_hook_budgets {settings.as_posix()!r} {hooks.as_posix()!r} {agents.as_posix()!r}",
        ),
        tmp_path,
    )
    return out + err


def test_a_registration_that_does_not_stand_clear_of_its_guards_budget_is_a_finding(tmp_path: Path) -> None:
    """The equal case is the one worth spelling: at the same number the harness may kill the hook first.

    A killed hook prints nothing and has allowed the command, and lowering a registration reads as
    tuning a timeout.
    """
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    write_shell(hooks / "guard.sh", FIXTURE_GUARD)
    # The last row is the widening: before it, only `PreToolUse` was walked, and a hook registered on
    # any other event was compared against nothing.
    for seconds, event, said in (
        (30, "PreToolUse", "INFO guard.sh: a 15s child under a 30s PreToolUse registration"),
        (15, "PreToolUse", "FAIL guard.sh decides under 15s"),
        (10, "PreToolUse", "FAIL guard.sh decides under 15s"),
        (10, "PostToolUse", "FAIL guard.sh decides under 15s"),
    ):
        settings = write_shell(tmp_path / "settings.json", _registration(seconds, event))
        out = _compare_budgets(settings, hooks, tmp_path)
        assert _said(said) in out, f"{seconds}s on {event}: {out!r}"


def test_a_guard_with_no_child_is_reported_rather_than_compared(tmp_path: Path) -> None:
    """A guard deciding in the hook process has one number, and comparing it against itself would fail every such hook."""
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    write_shell(hooks / "guard.sh", "#!/usr/bin/env bash\nexit 0\n")
    settings = write_shell(tmp_path / "settings.json", _registration(10))
    out = _compare_budgets(settings, hooks, tmp_path)
    assert _said("INFO guard.sh: decides in the hook process") in out, out


# The load-bearing rows are the seven that are not `-s KILL 15`: a reader keyed to that one spelling
# calls each of them a guard with no child, which is an `info` on the hook whose watchdog it lost.
DISPATCHES: Final[tuple[tuple[str, str], ...]] = (
    ("timeout -s KILL 15", "FAIL guard.sh decides under 15s"),
    ("timeout --signal=KILL 15", "FAIL guard.sh decides under 15s"),
    ("timeout --signal KILL 15", "FAIL guard.sh decides under 15s"),
    ("timeout -sKILL 15", "FAIL guard.sh decides under 15s"),
    ("timeout -k 5 15", "FAIL guard.sh decides under 15s"),
    ("timeout --kill-after=5 15", "FAIL guard.sh decides under 15s"),
    ("timeout 15s", "FAIL guard.sh decides under 15s"),
    ("timeout 15", "FAIL guard.sh decides under 15s"),
    # Neither is a watchdog this can hold against a registration, and reporting either as a readable
    # one is the same silence under a number nobody checked.
    ('timeout -s KILL "$BUDGET"', "FAIL guard.sh gives a child a duration this cannot read as whole seconds — line 2"),
    ("timeout -s KILL 2m", "FAIL guard.sh gives a child a duration this cannot read as whole seconds — line 2"),
)


def test_every_spelling_of_one_watchdog_is_compared_and_no_other_is_read_as_seconds(tmp_path: Path) -> None:
    """Each row runs the same child under the same 15 seconds, so a row answering differently answers on the spelling."""
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    settings = write_shell(tmp_path / "settings.json", _registration(10))
    for dispatch, said in DISPATCHES:
        write_shell(hooks / "guard.sh", _guard(dispatch))
        out = _compare_budgets(settings, hooks, tmp_path)
        assert _said(said) in out, f"{dispatch!r}: {out!r}"


# The last two rows are load-bearing: a reader keyed to `$0` and `--decide` reads a guard spelling
# `${BASH_SOURCE[0]}` under a sentinel of its own as one deciding in process, which is an `info`.
RE_ENTRIES: Final[tuple[str, ...]] = (
    'bash "$0" --decide',
    'bash "$0" --verdict',
    'bash "${BASH_SOURCE[0]}" --decide',
    'bash "${BASH_SOURCE[0]}" --verdict',
    'sh "$BASH_SOURCE" --verdict',
)


def test_a_guard_that_re_enters_itself_under_no_watchdog_is_a_finding(tmp_path: Path) -> None:
    """Deleting the dispatch is the cheapest way to leave this comparison green, and nothing else asks whether a guard has a watchdog.

    Every row re-enters under nothing at all, so a row answering differently answers on the spelling.
    """
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    settings = write_shell(tmp_path / "settings.json", _registration(10))
    for re_entry in RE_ENTRIES:
        write_shell(hooks / "guard.sh", f'#!/usr/bin/env bash\nanswer="$({re_entry})"\n')
        out = _compare_budgets(settings, hooks, tmp_path)
        assert _said("FAIL guard.sh hands its decision to a child under no timeout of its own") in out, f"{re_entry!r}: {out!r}"


def test_a_hook_an_agent_definition_registers_is_compared_like_a_settings_one(tmp_path: Path) -> None:
    """An agent's frontmatter is the one registration surface no settings file carries, and its hooks are killed the same way."""
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    agents = tmp_path / "agents"
    agents.mkdir()
    write_shell(hooks / "guard.sh", FIXTURE_GUARD)
    write_shell(hooks / "plain.sh", "#!/usr/bin/env bash\nexit 0\n")
    write_shell(agents / "fixture.md", _agent_definition(10))
    settings = write_shell(tmp_path / "settings.json", _registration(30, hook="plain.sh"))
    out = _compare_budgets(settings, hooks, tmp_path, agents)
    # The whole line, its verb included: read from the middle it is satisfied by the same words
    # downgraded to an `info`. The event names the price a kill costs, which a bare frontmatter key
    # read as one gets wrong.
    said = (
        f"FAIL guard.sh decides under 15s while {agents.as_posix()}/fixture.md gives the hook 10s on PreToolUse, "
        "so the harness kills it first and the silence reads as permission."
    )
    assert _said(said) in out, out
    assert _said("INFO plain.sh: decides in the hook process") in out, out


def test_an_agent_registration_carrying_no_timeout_is_named_rather_than_dropped(tmp_path: Path) -> None:
    """The one shape the two readers answered differently: node prints `undefined` and the loop fails it.

    A dropped entry takes its hook out of every finding, so a registration bounding nothing reads
    like one nobody wrote.
    """
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    agents = tmp_path / "agents"
    agents.mkdir()
    write_shell(hooks / "guard.sh", FIXTURE_GUARD)
    write_shell(hooks / "plain.sh", "#!/usr/bin/env bash\nexit 0\n")
    write_shell(agents / "fixture.md", _agent_definition(None))
    settings = write_shell(tmp_path / "settings.json", _registration(30, hook="plain.sh"))
    out = _compare_budgets(settings, hooks, tmp_path, agents)
    said = f"FAIL {agents.as_posix()}/fixture.md gives guard.sh no readable timeout on PreToolUse"
    assert _said(said) in out, out


# What an agent read answers with when it read nothing: no directory at all, a definition renamed off
# the suffix the glob names, and a directory holding neither.
AGENT_READS: Final[tuple[tuple[str, str | None], ...]] = (
    ("gone", None),
    ("renamed", "fixture.markdown"),
    ("empty", ""),
)


def test_an_agent_read_that_answered_nothing_is_named_rather_than_left_at_zero(tmp_path: Path) -> None:
    """A definition renamed off `.md` drops every hook an agent registers, and reads as a tree carrying none.

    The empty row is the control: failing a directory that registers nothing would fail every
    fixture here carrying no agent.
    """
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    write_shell(hooks / "plain.sh", "#!/usr/bin/env bash\nexit 0\n")
    settings = write_shell(tmp_path / "settings.json", _registration(30, hook="plain.sh"))
    for label, entry in AGENT_READS:
        agents = tmp_path / label
        if entry is not None:
            agents.mkdir()
        if entry:
            write_shell(agents / entry, _agent_definition(10))
        out = _compare_budgets(settings, hooks, tmp_path, agents)
        said = f"FAIL no agent registration was read out of {agents.as_posix()}"
        if entry == "":
            assert said not in out, f"{label}: {out!r}"
            assert _said("INFO plain.sh: decides in the hook process") in out, f"{label}: {out!r}"
        else:
            assert _said(said) in out, f"{label}: {out!r}"


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
