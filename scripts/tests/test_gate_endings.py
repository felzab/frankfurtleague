"""The gate's endings: each tool's status read into the exit contract as its own table says, a run alone or beside others.

A tool's status is read through `scripts/lib/_lib.sh :: EXIT_CODES`, so a row read wrongly ends a run on the wrong
class with every line still printed: a refusal reads as a finding to fix, or a finding as a crash. Nobody reading the
scope's output alone sees that, and a caller branching on the code acts on the wrong one. Each case copies the gate and
its library into a fixture tree with the three compose files and the tools file, a stand-in virtualenv whose interpreter
and zizmor answer what the case says, a stand-in edge test answering 0, and a stand-in `docker`, `uv` and `pnpm` first
on PATH, so the docs, ops, frontend and backend scopes run with no daemon, no audit and no install. A backend case may
hand pytest to the real interpreter, which then judges the test modules the case writes.
"""

from __future__ import annotations

import os
import re
import shutil
import sys
from pathlib import Path
from typing import Final

import pytest
from conftest import BASH, REPO_ROOT, base_env, new_root, run_shell, write_shell

# `version` is the engine's, which every case answers. `compose version` is the plugin's, which the
# missing case answers as the CLI does for a command it does not hold, and every other `compose` call
# is a render, which the broken case fails with a parse error, answering 1 as Compose 5.7.0 does, and the
# interrupted case ends with a cancel's 130. `run` is the docs scope's lychee.
DOCKER: Final = r"""#!/usr/bin/env bash
case "${1:-}" in
  version) printf 'stub\n'; exit 0 ;;
  compose)
    if [[ "${FL_COMPOSE:-}" == missing ]]; then
      printf '%s\n' "docker: 'compose' is not a docker command." >&2; exit 1
    fi
    if [[ "${2:-}" == version ]]; then printf 'Docker Compose version stub\n'; exit 0; fi
    if [[ "${FL_COMPOSE:-}" == broken ]]; then
      printf '%s\n' 'yaml: line 3: mapping values are not allowed in this context' >&2; exit 1
    fi
    if [[ "${FL_COMPOSE:-}" == interrupted ]]; then exit 130; fi
    exit 0 ;;
  run) printf 'stub: lychee answered %s\n' "${FL_LYCHEE_EXIT:-0}"; exit "${FL_LYCHEE_EXIT:-0}" ;;
esac
printf 'stub: no answer for docker %s\n' "$*" >&2
exit 1
"""


# pnpm answering each command as `FL_PNPM_<command>` says, as pnpm 11.28.9 prints, driven: `<status>` a script's
# own, which pnpm closes on its `[ELIFECYCLE]` line; `<status>:<code>` pnpm's own error, opening a line
# `[ERR_PNPM_<code>]`; `<status>:ERROR` a codeless error of its own; `<status>:quote` a script's finding quoting a
# pnpm code inside its own line; `<status>:tsc` tsc's error at a file's line and column. A script it runs is named by
# the script, `lint:only` as `FL_PNPM_lint_only`.
PNPM: Final = r"""#!/usr/bin/env bash
command="$1"
if [[ "$command" == exec || "$command" == --dir ]]; then exit 0; fi
variable="FL_PNPM_${command//[^A-Za-z]/_}"
answer="${!variable:-0}"
status="${answer%%:*}"
case "$answer" in
  *:quote) printf '%s\n' "src/core/x.ts: a finding quoting [ERR_PNPM_META_FETCH_FAIL] in its own words" ;;
  *:tsc) printf '%s\n' "src/app/page.tsx(3,7): error TS2322: Type 'string' is not assignable to type 'number'." ;;
  *:ERROR) printf '%s\n' "[ERROR] Bad escaped character in JSON at position 172" >&2 ;;
  *:*) printf '[ERR_PNPM_%s] stub: pnpm %s\n' "${answer#*:}" "$*" >&2 ;;
esac
# A script that failed under pnpm, which pnpm's own errors are not.
if [[ "$answer" != *:* || "$answer" == *:quote || "$answer" == *:tsc ]] && (( status )); then
  printf '[ELIFECYCLE] Command failed with exit code %s.\n' "$status" >&2
fi
exit "$status"
"""


def _answers(variable: str) -> str:
    """A stand-in answering the status `variable` names, 0 where it names none."""
    return f'#!/usr/bin/env bash\nexit "${{{variable}:-0}}"\n'


# The virtualenv's interpreter: pytest is the real one where a case names an interpreter in `FL_REAL_PYTHON`,
# and every other module answers `FL_CHECKER_EXIT`.
PYTHON: Final = r"""#!/usr/bin/env bash
if [[ -n "${FL_REAL_PYTHON:-}" && "${1:-} ${2:-}" == "-m pytest" ]]; then exec "$FL_REAL_PYTHON" "$@"; fi
exit "${FL_CHECKER_EXIT:-0}"
"""


# A script on the library, as the edge test is, ending as `FL_EDGE` says, each ending annotating itself.
EDGE: Final = r"""#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh"
case "${FL_EDGE:-pass}" in
  finding) fail "HEADER /"; die --summary "1 header case failed." ;;
  refusal) refuse "could not start the pinned nginx for the edge test." ;;
esac
ok "the edge passed"
"""

TOOLS_FILE: Final = "scripts/gate/tools.Dockerfile"
COPIED: Final = (
    "scripts/gate/verify.sh",
    "scripts/lib/_lib.sh",
    "docker-compose.yml",
    "docker-compose.local.yml",
    "docker-compose.e2e.yml",
    TOOLS_FILE,
)


def _gate(*scopes: str, answers: dict[str, str], tools: str | None = None, backend_tests: dict[str, str] | None = None) -> tuple[int, str]:
    """`verify.sh` run once over `scopes` behind the stand-ins, its exit code and both streams.

    `backend_tests` are test modules written into the fixture's `fl_backend/`, which the real pytest collects.
    """
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root = new_root("fl-gate-endings-")
    for path in COPIED:
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(REPO_ROOT / path, root / path)
    if tools is not None:
        write_shell(root / TOOLS_FILE, tools)
    (root / "scripts" / "checks").mkdir()
    write_shell(root / "scripts" / "checks" / "edge_test.sh", EDGE)
    venv = root / "fl_backend" / ".venv" / "bin"
    venv.mkdir(parents=True)
    os.chmod(write_shell(venv / "python", PYTHON), 0o755)
    for name, text in (backend_tests or {}).items():
        write_shell(root / "fl_backend" / name, text)
    os.chmod(write_shell(venv / "zizmor", _answers("FL_ZIZMOR_EXIT")), 0o755)
    stubs = new_root("fl-gate-endings-engine-")
    os.chmod(write_shell(stubs / "docker", DOCKER), 0o755)
    os.chmod(write_shell(stubs / "uv", _answers("FL_UV_EXIT")), 0o755)
    os.chmod(write_shell(stubs / "pnpm", PNPM), 0o755)
    (root / "fl_frontend" / "node_modules").mkdir(parents=True)
    environment = base_env() | {"PATH": str(stubs) + os.pathsep + os.environ["PATH"]} | answers
    done = run_shell(BASH, root / "scripts" / "gate" / "verify.sh", *scopes, env=environment, cwd=root)
    return done.returncode, done.stdout + done.stderr


def _wrong(exited: int, output: str, code: int, says: str, never: str) -> list[str]:
    wrong: list[str] = []
    if exited != code:
        wrong.append(f"exited {exited}, and the exit contract gives it {code}")
    if says not in output:
        wrong.append(f"nothing it printed says {says!r}")
    if never in output:
        wrong.append(f"it said {never!r}, which names another ending")
    return wrong


JUDGED_NOTHING: Final = "could not judge its input"
BROKEN_LINKS: Final = "lychee names each broken link"
NO_PLUGIN: Final = "Docker Compose did not answer"
UNPARSED: Final = "docker-compose.yml does not parse."
DEDUPE: Final = "holds a copy a dedupe would remove"
PEERS: Final = "installs a peer outside the range"
ESLINT: Final = "eslint failed."
TSC: Final = "tsc found type errors."
CONTRACT: Final = "The committed contract no longer matches"
# `on_error`'s own line, which only a crash prints.
CRASHED: Final = "exit status "


@pytest.mark.parametrize(
    ("scope", "answers", "code", "says", "never"),
    [
        pytest.param("--ops", {"FL_COMPOSE": "missing"}, 2, NO_PLUGIN, UNPARSED, id="no-compose-plugin-is-a-refusal"),
        pytest.param("--ops", {"FL_COMPOSE": "broken"}, 1, UNPARSED, NO_PLUGIN, id="a-parse-error-is-a-finding"),
        pytest.param("--ops", {"FL_COMPOSE": "interrupted"}, 130, "Interrupted after", UNPARSED, id="a-render-a-cancel-ended-is-an-interrupt"),
        pytest.param("--ops", {"FL_ZIZMOR_EXIT": "13"}, 1, "zizmor found a finding", JUDGED_NOTHING, id="a-zizmor-severity-is-a-finding"),
        # zizmor's 1 is any error during the audit, and lychee's 1 a missing input, a runtime failure or a configuration error.
        pytest.param("--ops", {"FL_ZIZMOR_EXIT": "1"}, 3, CRASHED, "zizmor found a finding", id="zizmor-s-own-error-is-a-crash"),
        pytest.param("--docs", {"FL_LYCHEE_EXIT": "2"}, 1, BROKEN_LINKS, JUDGED_NOTHING, id="a-failed-link-is-a-finding"),
        pytest.param("--docs", {"FL_LYCHEE_EXIT": "1"}, 3, CRASHED, BROKEN_LINKS, id="lychee-s-own-failure-is-a-crash"),
        pytest.param("--docs", {"FL_LYCHEE_EXIT": "3"}, 2, JUDGED_NOTHING, BROKEN_LINKS, id="a-config-lychee-cannot-load-is-a-refusal"),
        # pnpm answers 1 for its own failures and for a finding alike, so its code decides.
        pytest.param(
            "--frontend", {"FL_PNPM_dedupe": "1:DEDUPE_CHECK_ISSUES"}, 1, DEDUPE, JUDGED_NOTHING, id="a-dedupe-pnpm-would-make-is-a-finding"
        ),
        pytest.param(
            "--frontend", {"FL_PNPM_dedupe": "1:META_FETCH_FAIL"}, 2, JUDGED_NOTHING, DEDUPE, id="a-registry-pnpm-cannot-reach-is-a-refusal"
        ),
        pytest.param("--frontend", {"FL_PNPM_dedupe": "1:A_CODE_NO_ROW_NAMES"}, 3, CRASHED, DEDUPE, id="a-pnpm-code-no-row-names-is-a-crash"),
        pytest.param("--frontend", {"FL_PNPM_peers": "1"}, 1, PEERS, JUDGED_NOTHING, id="a-peer-out-of-range-is-a-finding"),
        pytest.param("--frontend", {"FL_PNPM_lint_only": "1:NO_SCRIPT"}, 3, CRASHED, ESLINT, id="a-script-the-manifest-lacks-is-a-crash"),
        # A script's own status passes through pnpm, so the tool's own row reads it.
        pytest.param("--frontend", {"FL_PNPM_lint_only": "1"}, 1, ESLINT, JUDGED_NOTHING, id="an-eslint-error-is-a-finding"),
        pytest.param("--frontend", {"FL_PNPM_lint_only": "2"}, 3, CRASHED, ESLINT, id="eslint-s-own-failure-is-a-crash"),
        # pnpm's code is read off pnpm's own line alone: a finding quoting one stays the tool's.
        pytest.param(
            "--frontend", {"FL_PNPM_lint_only": "1:quote"}, 1, ESLINT, JUDGED_NOTHING, id="a-finding-quoting-a-pnpm-code-stays-a-finding"
        ),
        pytest.param("--frontend", {"FL_PNPM_lint_only": "1:ERROR"}, 3, CRASHED, ESLINT, id="a-codeless-error-of-pnpm-s-own-is-a-crash"),
        # The supply-chain policies refuse an entry wherever pnpm verifies the lockfile, in words of their own.
        pytest.param(
            "--frontend",
            {"FL_PNPM_dedupe": "1:MINIMUM_RELEASE_AGE_VIOLATION"},
            1,
            "supply-chain policies refuse",
            DEDUPE,
            id="a-release-younger-than-the-policy-allows-is-a-finding-of-its-own",
        ),
        pytest.param("--frontend", {"FL_PNPM_dedupe": "1:FETCH_503"}, 2, JUDGED_NOTHING, DEDUPE, id="a-registry-answering-503-is-a-refusal"),
        # tsc's 1 and 2 are a finding only where it names an error at a file's line and column.
        pytest.param("--frontend", {"FL_PNPM_typecheck_only": "2:tsc"}, 1, TSC, JUDGED_NOTHING, id="a-type-error-is-a-finding"),
        pytest.param("--frontend", {"FL_PNPM_typecheck_only": "1"}, 3, CRASHED, TSC, id="tsc-stopping-before-a-program-is-a-crash"),
        pytest.param(
            "--frontend", {"FL_PNPM_typecheck_only": "1:NO_SCRIPT"}, 3, CRASHED, TSC, id="a-typecheck-script-the-manifest-lacks-is-a-crash"
        ),
        # The db scope's three runs side by side: a generator that answered 0 and wrote nothing reached no verdict.
        pytest.param("--db", {}, 3, "was not generated", CONTRACT, id="a-contract-generated-to-nowhere-is-a-crash"),
    ],
)
def test_each_tool_s_status_ends_the_scope_as_its_table_reads_it(scope: str, answers: dict[str, str], code: int, says: str, never: str) -> None:
    """What the tool found is the finding 1, what it says it could not judge the refusal 2."""
    exited, output = _gate(scope, answers=answers)
    wrong = _wrong(exited, output, code, says, never)
    assert not wrong, "\n".join(wrong) + "\n" + output


@pytest.mark.parametrize(
    ("lychee", "code", "row"),
    [
        pytest.param("0", 0, "pass", id="green"),
        pytest.param("2", 1, "failed", id="a-finding"),
        pytest.param("3", 2, "refused", id="a-refusal"),
        pytest.param("127", 3, "crashed", id="a-crash"),
        pytest.param("130", 130, "interrupted", id="an-interrupt"),
    ],
)
def test_a_run_beside_others_ends_on_the_class_its_scope_ended_on(lychee: str, code: int, row: str) -> None:
    """The docs scope ends on each class beside a green ops scope, and the run and the docs row end on that class."""
    exited, output = _gate("--docs", "--ops", answers={"FL_LYCHEE_EXIT": lychee})
    wrong = _wrong(exited, output, code, "running side by side: docs ops", "no verdict")
    if not re.search(rf"^\s+docs\s+{row}\s", output, re.MULTILINE):
        wrong.append(f"the table gives the docs row no {row!r}")
    if not re.search(r"^\s+ops\s+pass\s", output, re.MULTILINE):
        wrong.append("the table gives the ops row no 'pass'")
    assert not wrong, "\n".join(wrong) + "\n" + output


# zizmor's finding is counted, and the compose checker then refuses its input.
COUNTED_THEN_REFUSED: Final = {"FL_ZIZMOR_EXIT": "13", "FL_CHECKER_EXIT": "2"}


@pytest.mark.parametrize("scopes", [pytest.param(("--ops",), id="alone"), pytest.param(("--docs", "--ops"), id="beside-another-scope")])
def test_a_scope_that_counted_a_finding_and_then_refused_ends_the_run_refused(scopes: tuple[str, ...]) -> None:
    """The scope's own exit code decides its ending, never the count its row shows, so both runs end 2."""
    exited, output = _gate(*scopes, answers=COUNTED_THEN_REFUSED)
    wrong = _wrong(exited, output, 2, "zizmor found a finding", "finding(s) in this run")
    if "Refused after" not in output:
        wrong.append("the run closed on no refusal")
    assert not wrong, "\n".join(wrong) + "\n" + output


@pytest.mark.parametrize(("edge", "code"), [pytest.param("finding", 1, id="a-finding"), pytest.param("refusal", 2, id="a-refusal")])
def test_a_script_annotating_its_own_ending_raises_one_annotation_under_actions(edge: str, code: int) -> None:
    """The edge test annotates each finding and its refusal itself, so the gate's own verdict on it raises none."""
    exited, output = _gate("--ops", answers={"FL_EDGE": edge, "GITHUB_ACTIONS": "true"})
    # Replayed under the step as the gate replays a failing tool's output, indented, which the runner trims.
    annotations = [line for line in output.splitlines() if line.lstrip().startswith("::error::")]
    wrong = _wrong(exited, output, code, "::error::", "no verdict")
    if len(annotations) != 1:
        wrong.append(f"raised {len(annotations)} annotations, where the one ending raises one: {annotations}")
    assert not wrong, "\n".join(wrong) + "\n" + output


def test_a_tools_file_without_lychee_s_line_is_a_finding_of_its_own() -> None:
    """The tools file is the change's, so its missing stage is a finding, and no link was judged broken."""
    tools = (REPO_ROOT / TOOLS_FILE).read_text(encoding="utf-8")
    without = "".join(line for line in tools.splitlines(keepends=True) if not line.rstrip().endswith(" AS lychee"))
    assert without != tools, f"{TOOLS_FILE} holds no lychee stage for this case to remove"
    exited, output = _gate("--docs", answers={}, tools=without)
    wrong = _wrong(exited, output, 1, "names no single FROM line for lychee", BROKEN_LINKS)
    assert not wrong, "\n".join(wrong) + "\n" + output


# The one row whose tool answers 0 for what it found and a nonzero status for nothing found, as git-grep(1)'s "EXIT
# STATUS" documents it.
INVERTED: Final = {"git-grep": "0:1 1:0"}


def _tables() -> dict[str, dict[str, str]]:
    """`EXIT_CODES`, `EXIT_LINES` and `PNPM_ERRORS` as `_lib.sh` declares them once sourced, each entry's key beside its value."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    body = (
        f'source "{(REPO_ROOT / "scripts" / "lib" / "_lib.sh").as_posix()}"\n'
        "for table in EXIT_CODES EXIT_LINES PNPM_ERRORS; do\n"
        '  declare -n rows="$table"\n'
        '  for key in "${!rows[@]}"; do printf \'%s\\t%s\\t%s\\n\' "$table" "$key" "${rows[$key]}"; done\n'
        "  unset -n rows\n"
        "done\n"
    )
    done = run_shell(BASH, write_shell(new_root("fl-exit-tables-") / "dump.sh", body), env=base_env())
    assert done.returncode == 0, done.stdout + done.stderr
    tables: dict[str, dict[str, str]] = {"EXIT_CODES": {}, "EXIT_LINES": {}, "PNPM_ERRORS": {}}
    for line in done.stdout.splitlines():
        table, key, value = line.split("\t")
        tables[table][key] = value
    assert all(tables.values()), f"a table read empty, so nothing below is judged: {tables}"
    return tables


def test_no_row_reads_a_tool_s_nonzero_status_as_clean_or_its_zero_as_anything_else() -> None:
    """A row reading a finding as 0 ends the scope green over it, every line still printed, which no case driving a tool sees.

    Every reading a status takes is held at once: a pair of `EXIT_CODES`, the class an `EXIT_LINES` row gives its
    statuses, and the class a pnpm code reads as.
    """
    tables = _tables()
    wrong: list[str] = []
    for table, row in tables["EXIT_CODES"].items():
        if table in INVERTED:
            continue
        pairs = dict(pair.split(":") for pair in row.split(" "))
        if pairs.get("0") != "0":
            wrong.append(f"EXIT_CODES[{table}]={row!r} reads 0 as {pairs.get('0')!r}, never as clean")
        wrong += [f"EXIT_CODES[{table}]={row!r} reads {status} as clean" for status, read in pairs.items() if status != "0" and read == "0"]
    for table, row in tables["EXIT_LINES"].items():
        statuses, read, _ = row.split(" ", 2)
        if read == "0":
            wrong.append(f"EXIT_LINES[{table}]={row!r} reads {statuses} as clean by the tool's words")
    wrong += [f"PNPM_ERRORS[{code}]={read} reads a pnpm failure as clean" for code, read in tables["PNPM_ERRORS"].items() if read == "0"]
    inverted = {table: tables["EXIT_CODES"].get(table) for table in INVERTED}
    if inverted != INVERTED:
        wrong.append(f"the inverted rows read {inverted}, where git-grep(1) documents {INVERTED}")
    assert not wrong, "\n".join(wrong)


KEPT: Final = "def test_kept() -> None:\n    pass\n"


@pytest.mark.parametrize(
    ("tests", "names"),
    [
        # pytest alone answers 2, its interrupt's, which the table reads as a crash; pytest-xdist counts it a failure.
        pytest.param(
            {"test_kept.py": KEPT, "test_broken.py": "import a_module_nobody_wrote\n"},
            "ERROR test_broken.py",
            id="a-module-that-does-not-collect",
        ),
        pytest.param(
            {
                "pytest.ini": "[pytest]\nmax_warnings = 0\n",
                "test_warned.py": "import warnings\n\n\ndef test_warned() -> None:\n    warnings.warn('planted', UserWarning, stacklevel=1)\n",
            },
            "maximum allowed warnings exceeded",
            id="every-test-passing-past-the-warnings-allowed",
        ),
    ],
)
def test_what_the_real_pytest_answers_about_the_tests_is_a_finding(tests: dict[str, str], names: str) -> None:
    """The real pytest of this run's interpreter, with the arguments the backend scope hands it.

    A scope dropping its spread, or a row dropping a status, reads what the tests say as the gate's own crash.
    """
    exited, output = _gate("--backend", answers={"FL_REAL_PYTHON": Path(sys.executable).as_posix()}, backend_tests=tests)
    wrong = _wrong(exited, output, 1, "fl_backend tests failed.", "Crashed after")
    if names not in output:
        wrong.append(f"pytest's output names no {names!r}")
    assert not wrong, "\n".join(wrong) + "\n" + output
