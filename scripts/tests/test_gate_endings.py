"""The gate's endings: a scope's status read into the exit contract, a run alone or beside others.

A scope ending on the wrong class prints every line it would have printed, so nobody reading its output sees it: a
refusal reads as a finding to fix, or a finding as a crash, and only a green run of every scope may call itself safe to
merge. Each case copies the gate and its library into a fixture tree with the three compose files and the tools file, a
stand-in virtualenv whose interpreter and zizmor answer what the case says, a stand-in edge test and self-check, and a
stand-in `docker`, `uv` and `pnpm` first on PATH, so every scope runs with no daemon, no audit and no install. A backend
case may hand pytest to the real interpreter, which then judges the test modules the case writes.
"""

from __future__ import annotations

import os
import re
import shutil
import sys
from pathlib import Path
from typing import Final

import pytest
from conftest import BASH, REPO_ROOT, base_env, new_root, run_bounded, run_shell, write_shell

# `version` is the engine's and `compose version` the plugin's, and every other `compose` call is a render. `run` is
# the docs scope's lychee, answering `FL_LYCHEE_EXIT`, and the images scope's probes, each answering as a clean image
# does: its context lists nothing, and its user is no root.
DOCKER: Final = r"""#!/usr/bin/env bash
case "${1:-}" in
  version) printf 'stub\n'; exit 0 ;;
  compose) exit 0 ;;
  run)
    if [[ " $* " == *" find /app "* ]]; then exit 0; fi
    if [[ " $* " == *" id -u "* ]]; then printf '1001\n'; exit 0; fi
    printf 'stub: lychee answered %s\n' "${FL_LYCHEE_EXIT:-0}"; exit "${FL_LYCHEE_EXIT:-0}" ;;
esac
printf 'stub: no answer for docker %s\n' "$*" >&2
exit 1
"""

# pnpm answering each command as `FL_PNPM_<command>` says: `<status>` a script's own, `<status>:<code>` pnpm's own
# error, on a line opening `[ERR_PNPM_<code>]` as pnpm 11.28.9 prints it. A program `pnpm exec` runs answers 0, and
# under `FL_CONTRACT=written` Orval writes the committed client where the contract check asks.
PNPM: Final = r"""#!/usr/bin/env bash
if [[ "$1" == --dir ]]; then cd "$2" || exit 1; shift 2; fi
if [[ "$1" == exec ]]; then
  if [[ "${2:-}" == orval && "${FL_CONTRACT:-}" == written ]]; then cp -r src/core/generated "${CONTRACT_SCRATCH}/generated"; fi
  exit 0
fi
variable="FL_PNPM_${1//[^A-Za-z]/_}"
answer="${!variable:-0}"
if [[ "$answer" == *:* ]]; then printf '[ERR_PNPM_%s] stub: pnpm %s\n' "${answer#*:}" "$*" >&2; fi
exit "${answer%%:*}"
"""


def _answers(variable: str) -> str:
    """A stand-in answering the status `variable` names, 0 where it names none."""
    return f'#!/usr/bin/env bash\nexit "${{{variable}:-0}}"\n'


# The virtualenv's interpreter: pytest is the real one where a case names an interpreter in `FL_REAL_PYTHON`, and every
# other module answers 0. Under `FL_CONTRACT=written` the document generator writes the committed document.
PYTHON: Final = r"""#!/usr/bin/env bash
if [[ -n "${FL_REAL_PYTHON:-}" && "${1:-} ${2:-}" == "-m pytest" ]]; then exec "$FL_REAL_PYTHON" "$@"; fi
if [[ "${1:-} ${2:-}" == "-m app.openapi_document" && "${FL_CONTRACT:-}" == written ]]; then cp openapi.json "$3"; fi
exit 0
"""

# A script on the library, as the edge test is, ending as `FL_EDGE` says.
EDGE: Final = r"""#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh"
if [[ "${FL_EDGE:-pass}" == refusal ]]; then refuse "could not start the pinned nginx for the edge test."; fi
ok "the edge passed"
"""

# The self-check, a script on the library too, passing.
SELFCHECK: Final = r"""#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh"
ok "the scripts passed"
"""

COPIED: Final = (
    "scripts/gate/verify.sh",
    "scripts/lib/_lib.sh",
    "docker-compose.yml",
    "docker-compose.local.yml",
    "docker-compose.e2e.yml",
    "scripts/gate/tools.Dockerfile",
)


def _committed(root: Path) -> None:
    """The fixture tree as a repository holding its every file, which the format and db scopes ask git about."""
    for command in (
        ("git", "init", "--quiet"),
        ("git", "add", "--all"),
        ("git", "-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "commit", "--quiet", "--message=fixture"),
    ):
        done = run_bounded(command, cwd=root)
        assert done.returncode == 0, done.stdout + done.stderr


def _gate(*scopes: str, answers: dict[str, str], backend_tests: dict[str, str] | None = None, committed: bool = True) -> tuple[int, str]:
    """`verify.sh` run once over `scopes` behind the stand-ins, its exit code and both streams.

    `backend_tests` are test modules written into the fixture's `fl_backend/`, which the real pytest collects. The tree
    holds a contract its stand-in generators write again, and is a repository holding it where `committed`.
    """
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root = new_root("fl-gate-endings-")
    for path in COPIED:
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(REPO_ROOT / path, root / path)
    (root / "scripts" / "checks").mkdir()
    write_shell(root / "scripts" / "checks" / "edge_test.sh", EDGE)
    write_shell(root / "scripts" / "gate" / "selfcheck.sh", SELFCHECK)
    (root / "fl_frontend" / "src" / "core" / "generated").mkdir(parents=True)
    write_shell(root / "fl_frontend" / "src" / "core" / "generated" / "client.ts", "export {};\n")
    (root / "fl_backend").mkdir()
    write_shell(root / "fl_backend" / "openapi.json", "{}\n")
    answers = {"FL_CONTRACT": "written", "VERIFY_IMAGES_BUILT": "1"} | answers
    if committed:
        _committed(root)
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


def _wrong(exited: int, output: str, code: int, says: str) -> list[str]:
    wrong: list[str] = []
    if exited != code:
        wrong.append(f"exited {exited}, and the exit contract gives it {code}")
    if says not in output:
        wrong.append(f"nothing it printed says {says!r}")
    return wrong


SAFE: Final = "Safe to merge."


@pytest.mark.parametrize(
    ("flags", "closes"),
    [
        pytest.param((), "Green — every scope, no findings, ", id="every-scope"),
        pytest.param(("--quick",), "Green — 3 scopes, no findings, ", id="quick"),
    ],
)
def test_only_a_green_run_of_every_scope_is_safe_to_merge(flags: tuple[str, ...], closes: str) -> None:
    """A run naming fewer scopes closes green and never as safe to merge."""
    exited, output = _gate(*flags, answers={})
    wrong = _wrong(exited, output, 0, closes)
    if not flags and SAFE not in output:
        wrong.append("a green run of every scope did not call itself safe to merge")
    if flags and SAFE in output:
        wrong.append("the run called itself safe to merge, which only a green run of every scope is")
    assert not wrong, "\n".join(wrong) + "\n" + output


@pytest.mark.parametrize(
    ("answers", "code", "row", "closes"),
    [
        # lychee answers 2 for a broken link and 1 for its own failure.
        pytest.param({"FL_LYCHEE_EXIT": "2"}, 1, ("docs", "failed"), "finding(s) in this run", id="a-finding"),
        pytest.param({"FL_EDGE": "refusal"}, 2, ("ops", "refused"), "Refused after", id="a-refusal"),
        pytest.param({"FL_LYCHEE_EXIT": "1"}, 3, ("docs", "crashed"), "Crashed after", id="a-crash"),
        pytest.param({"FL_LYCHEE_EXIT": "130"}, 130, ("docs", "interrupted"), "Interrupted after", id="an-interrupt"),
    ],
)
def test_a_run_beside_others_ends_on_the_class_its_scope_ended_on(
    answers: dict[str, str], code: int, row: tuple[str, str], closes: str
) -> None:
    """The docs and ops scopes side by side, one ending on each class: the run and that scope's row end on it."""
    exited, output = _gate("--docs", "--ops", answers=answers)
    wrong = _wrong(exited, output, code, "running side by side: docs ops")
    scope, result = row
    if not re.search(rf"^\s+{scope}\s+{result}\s", output, re.MULTILINE):
        wrong.append(f"the table gives the {scope} row no {result!r}")
    if closes not in output:
        wrong.append(f"the run closed on no {closes!r}")
    assert not wrong, "\n".join(wrong) + "\n" + output


def test_a_registry_pnpm_cannot_reach_is_a_refusal() -> None:
    """pnpm answers 1 for a registry it could not reach as for a finding, so its code decides."""
    exited, output = _gate("--frontend", answers={"FL_PNPM_dedupe": "1:META_FETCH_FAIL"})
    wrong = _wrong(exited, output, 2, "pnpm could not read the registry")
    assert not wrong, "\n".join(wrong) + "\n" + output


def test_a_contract_check_git_cannot_answer_is_a_crash() -> None:
    """Outside a repository git answers 128 for the untracked files it was asked, and the check ends as a crash.

    A bare read inside the check, run where bash suspends the error trap, passed it as none untracked.
    """
    exited, output = _gate("--db", answers={}, committed=False)
    wrong = _wrong(exited, output, 3, "fatal: not a git repository")
    assert not wrong, "\n".join(wrong) + "\n" + output


def test_a_test_module_that_does_not_collect_is_a_finding() -> None:
    """The real pytest of this run's interpreter, with the arguments the backend scope hands it.

    pytest alone answers 2, its interrupt's, which the gate reads as a crash; under pytest-xdist it is a failure.
    """
    tests = {"test_kept.py": "def test_kept() -> None:\n    pass\n", "test_broken.py": "import a_module_nobody_wrote\n"}
    exited, output = _gate("--backend", answers={"FL_REAL_PYTHON": Path(sys.executable).as_posix()}, backend_tests=tests)
    wrong = _wrong(exited, output, 1, "fl_backend tests failed.")
    if "ERROR test_broken.py" not in output:
        wrong.append("pytest's output names no 'ERROR test_broken.py'")
    assert not wrong, "\n".join(wrong) + "\n" + output
