"""The ops scope's compose step: a missing Compose plugin judged nothing, and a file that does not parse is a finding.

Compose is a plugin of the Docker CLI, so an engine can answer while `docker compose` is no command at all, and the
parse step's `|| die` would then read every compose file as broken. Each case copies the gate and its library into a
fixture tree with both compose files, a stand-in virtualenv whose interpreter and zizmor answer 0, and a stand-in
`docker` and `uv` first on PATH, so the scope reaches its compose step with no daemon, no audit and no install.
"""

from __future__ import annotations

import os
import shutil
from typing import Final

import pytest
from conftest import BASH, REPO_ROOT, base_env, new_root, run_shell, write_shell

CASE_VAR: Final = "FL_COMPOSE_CASE"

# `version` is the engine's, which every case answers. `compose version` is the plugin's, which the
# missing case answers as the CLI does for a command it does not hold, and every other `compose` call
# is a render, which the broken case fails with a parse error.
DOCKER: Final = r"""#!/usr/bin/env bash
case "${1:-}" in
  version) printf 'stub\n'; exit 0 ;;
  compose)
    if [[ "$FL_COMPOSE_CASE" == missing ]]; then
      printf '%s\n' "docker: 'compose' is not a docker command." >&2; exit 1
    fi
    if [[ "${2:-}" == version ]]; then printf 'Docker Compose version stub\n'; exit 0; fi
    printf '%s\n' 'yaml: line 3: mapping values are not allowed in this context' >&2; exit 15 ;;
esac
printf 'stub: no answer for docker %s\n' "$*" >&2
exit 1
"""

ANSWERS: Final = "#!/usr/bin/env bash\nexit 0\n"


def _ops(case: str) -> tuple[int, str]:
    """The ops scope run once behind the stand-ins, its exit code and both streams."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root = new_root("fl-ops-compose-")
    for path in ("scripts/gate/verify.sh", "scripts/lib/_lib.sh", "docker-compose.yml", "docker-compose.local.yml"):
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(REPO_ROOT / path, root / path)
    venv = root / "fl_backend" / ".venv" / "bin"
    venv.mkdir(parents=True)
    for name in ("python", "zizmor"):
        os.chmod(write_shell(venv / name, ANSWERS), 0o755)
    stubs = new_root("fl-ops-compose-engine-")
    os.chmod(write_shell(stubs / "docker", DOCKER), 0o755)
    os.chmod(write_shell(stubs / "uv", ANSWERS), 0o755)
    environment = base_env() | {"PATH": str(stubs) + os.pathsep + os.environ["PATH"], CASE_VAR: case}
    done = run_shell(BASH, root / "scripts" / "gate" / "verify.sh", "--ops", env=environment, cwd=root)
    return done.returncode, done.stdout + done.stderr


@pytest.mark.parametrize(
    ("case", "code", "says", "never"),
    [
        pytest.param("missing", 2, "Docker Compose did not answer", "does not parse", id="no-compose-plugin-is-a-refusal"),
        pytest.param("broken", 1, "docker-compose.yml does not parse.", "Docker Compose did not answer", id="a-parse-error-is-a-finding"),
    ],
)
def test_the_compose_step_tells_a_missing_plugin_from_a_file_that_does_not_parse(case: str, code: int, says: str, never: str) -> None:
    """A missing plugin judged nothing, so it is the refusal 2; a parse error is the change's, a finding 1."""
    exited, output = _ops(case)
    wrong: list[str] = []
    if exited != code:
        wrong.append(f"exited {exited}, and the exit contract gives it {code}")
    if says not in output:
        wrong.append(f"nothing it printed says {says!r}")
    if never in output:
        wrong.append(f"it said {never!r}, which names the other ending")
    assert not wrong, "\n".join(wrong) + "\n" + output
