"""The self-check's linters: what one found is a finding, and an image that never ran judged nothing.

Both linters run only in Docker, so a pull that fails or a daemon error answers `docker run`'s own 125, and read as
the linter's finding it would end the scripts scope on something to fix with no script linted. Each case copies the
self-check, its library and the tools file into a fixture repository holding one script, behind a stand-in `docker`
first on PATH whose `run` answers what the case says.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from typing import Final

import pytest
from conftest import BASH, REPO_ROOT, base_env, new_root, run_shell, write_shell

DOCKER: Final = r"""#!/usr/bin/env bash
case "${1:-}" in
  version) printf 'stub\n'; exit 0 ;;
  run) printf 'stub: the linter answered %s\n' "$FL_LINT_EXIT"; exit "$FL_LINT_EXIT" ;;
esac
printf 'stub: no answer for docker %s\n' "$*" >&2
exit 1
"""

COPIED: Final = ("scripts/gate/selfcheck.sh", "scripts/lib/_lib.sh", "scripts/gate/tools.Dockerfile")


def _selfcheck(lint_exit: str) -> tuple[int, str]:
    """`selfcheck.sh` run once behind the stand-in, both linters answering `lint_exit`, its exit code and both streams."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root = new_root("fl-selfcheck-")
    for path in COPIED:
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(REPO_ROOT / path, root / path)
    for git in (("init", "-q"), ("add", "."), ("update-index", "--chmod=+x", "scripts/gate/selfcheck.sh")):
        subprocess.run(("git", *git), cwd=root, check=True, capture_output=True)
    stubs = new_root("fl-selfcheck-engine-")
    os.chmod(write_shell(stubs / "docker", DOCKER), 0o755)
    environment = base_env() | {"PATH": str(stubs) + os.pathsep + os.environ["PATH"], "FL_LINT_EXIT": lint_exit}
    done = run_shell(BASH, root / "scripts" / "gate" / "selfcheck.sh", env=environment, cwd=root)
    return done.returncode, done.stdout + done.stderr


@pytest.mark.parametrize(
    ("lint_exit", "code", "says"),
    [
        pytest.param("0", 0, "All script self-checks passed.", id="clean"),
        pytest.param("1", 1, "shellcheck reported the findings above (exit 1)", id="a-linter-s-finding-is-a-finding"),
        pytest.param("125", 2, "shellcheck judged nothing it was handed (exit 125)", id="an-image-that-never-ran-is-a-refusal"),
    ],
)
def test_each_linter_s_status_ends_the_self_check_as_its_table_reads_it(lint_exit: str, code: int, says: str) -> None:
    """What a linter found is the finding 1; Docker's own 125 judged nothing, the refusal 2."""
    exited, output = _selfcheck(lint_exit)
    wrong: list[str] = []
    if exited != code:
        wrong.append(f"exited {exited}, and the exit contract gives it {code}")
    if says not in output:
        wrong.append(f"nothing it printed says {says!r}")
    assert not wrong, "\n".join(wrong) + "\n" + output
