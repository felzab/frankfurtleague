"""The made-up seed's verdict, driven through `scripts/ops/made_up_seed.sh` itself behind a stand-in engine

Every caller fails on any code but 0, so only this suite tells a refusal from a failure: no engine, no backend running,
a state the seed does not hold, or a read-back that could not judge, is 2, a seed or a document to correct is 1, an
interrupt 130, and a crash 3 or more. Each case copies the script with `_lib.sh` into a fixture tree of its own and puts
a stand-in `docker` first on PATH, which answers every call with the code the case gives. The seed's own decisions, the
server it refuses among them, are judged by the backend's suite, `fl_backend/tests/core/test_made_up_seed.py`.
"""

from __future__ import annotations

import os
import shutil
from collections.abc import Mapping
from types import MappingProxyType
from typing import Final

import pytest
from conftest import BASH, REPO_ROOT, base_env, new_root, run_shell, write_shell

SEED_FILES: Final = ("fl_backend/tests/documents.py", "fl_backend/tests/made_up_seed.py", "fl_backend/tests/made_up_people.json")
# As `local.sh` exports them for every call it makes.
LOCAL_STACK: Final = MappingProxyType({"COMPOSE_FILE": "docker-compose.yml;docker-compose.local.yml", "TAG": "local"})

# Every engine call, one per line; a hand-in's stdin kept under the file name its `cat >` writes. `compose ps` lists the
# running backend's container where the case's `backend` file names one.
DOCKER: Final = r"""#!/usr/bin/env bash
d="$FL_SEED_DIR"
printf '%s\n' "$*" >> "$d/calls"
answer() { cat "$d/$1" 2>/dev/null || printf 0; }
case " $* " in
  " version "*) exit "$(answer version)" ;;
  *" compose version "*) exit "$(answer compose)" ;;
  *" compose ps "*) cat "$d/backend" 2>/dev/null; exit 0 ;;
  *" sh -c "*) target="${*##* }"; cat > "$d/handed.${target##*/}"; exit "$(answer hand)" ;;
  *" tests.made_up_seed "*) exit "$(answer seed)" ;;
  *" app.readback "*) exit "$(answer readback)" ;;
esac
exit 0
"""


def seed(*args: str, backend: str = "4f2a\n", codes: Mapping[str, int] = MappingProxyType({})) -> tuple[int, str, list[str], set[str]]:
    """One run of the script: its exit code, its output, the engine calls and the files it handed in.

    `backend` is the running backend's container `compose ps` lists; `codes` gives the code each kind of call answers
    with (`version`, `compose` for the plugin's own version, `hand`, `seed`, `readback`), 0 otherwise.
    """
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root = new_root("fl-seed-")
    for script in ("scripts/ops/made_up_seed.sh", "scripts/lib/_lib.sh"):
        (root / script).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(REPO_ROOT / script, root / script)
    for file in SEED_FILES:
        (root / file).parent.mkdir(parents=True, exist_ok=True)
        (root / file).write_bytes(file.encode())
    engine = new_root("fl-seed-engine-")
    stubs = engine / "stubs"
    stubs.mkdir()
    os.chmod(write_shell(stubs / "docker", DOCKER), 0o755)
    (engine / "backend").write_bytes(backend.encode())
    for name, code in codes.items():
        (engine / name).write_bytes(str(code).encode())
    environment = {name: value for name, value in base_env().items() if name not in ("COMPOSE_FILE", "TAG")}
    environment |= {**LOCAL_STACK, "PATH": str(stubs) + os.pathsep + os.environ["PATH"], "FL_SEED_DIR": engine.as_posix()}
    done = run_shell(BASH, root / "scripts/ops/made_up_seed.sh", *args, env=environment, cwd=root)
    calls = (engine / "calls").read_bytes().decode().splitlines() if (engine / "calls").exists() else []
    handed = {path.name.removeprefix("handed.") for path in engine.glob("handed.*")}
    return done.returncode, done.stdout + done.stderr, calls, handed


def test_a_seed_read_back_whole_passes_with_its_state_alone_in_the_seed_s_environment() -> None:
    code, said, calls, handed = seed("--landing=decided")
    assert code == 0, said
    assert handed == {file.rsplit("/", 1)[-1] for file in SEED_FILES}
    run = [call for call in calls if "tests.made_up_seed" in call]
    assert run and all("--env SEED_LANDING=decided " in call for call in run), calls
    assert any("app.readback" in call for call in calls), calls

    code, said, calls, _ = seed()
    assert code == 0, said
    assert not any("SEED_LANDING" in call for call in calls), calls


@pytest.mark.parametrize(
    ("codes", "expected"),
    [
        pytest.param({"seed": 2}, 2, id="seed-refused"),
        pytest.param({"seed": 1}, 1, id="seed-fails"),
        pytest.param({"readback": 1}, 1, id="document-refused"),
        pytest.param({"readback": 2}, 2, id="read-back-cannot-judge"),
        # A hand-in that failed handed nothing in, so nothing was judged: Compose's own failure, a crash.
        pytest.param({"hand": 1}, 3, id="hand-in-crashes"),
        # A crash keeps the child's own status where it is 3 or more, and an interrupt stays 130.
        pytest.param({"seed": 137}, 137, id="seed-crashes"),
        pytest.param({"seed": 130}, 130, id="seed-interrupted"),
    ],
)
def test_each_verdict_keeps_its_own_code(codes: dict[str, int], expected: int) -> None:
    code, output, calls, _ = seed(codes=codes)
    assert code == expected, output
    # Nothing is judged after a seed that did not load.
    if codes.keys() & {"seed", "hand"}:
        assert not any("app.readback" in call for call in calls), calls


@pytest.mark.parametrize(
    ("backend", "codes", "refusal"),
    [
        pytest.param("4f2a\n", {"version": 1}, "Docker is not responding", id="no-engine"),
        # Docker answers 1 for a command it does not hold, a plugin that is not installed among them.
        pytest.param("4f2a\n", {"compose": 1}, "Docker Compose did not answer", id="no-compose-plugin"),
        pytest.param("", {}, "the stack's backend is not running", id="no-backend-running"),
    ],
)
def test_nothing_reaches_a_container_but_with_its_backend_running(backend: str, codes: dict[str, int], refusal: str) -> None:
    code, said, calls, handed = seed(backend=backend, codes=codes)
    assert code == 2, said
    assert refusal in said, said
    assert not handed, calls
    assert not any(" exec " in f" {call} " for call in calls), calls
