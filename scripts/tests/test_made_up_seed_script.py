"""The made-up seed's verdict, driven through `scripts/ops/made_up_seed.sh` itself behind a stand-in engine

Every caller fails on any code but 0, so only this suite tells a refusal from a failure: no engine, a stack without the
local database service, without a running backend or with a running frontend, a state the seed does not hold, or a
read-back that could not judge, is 2, and a seed or a document to correct is 1. Each case copies the script with `_lib.sh` into a fixture
tree of its own and puts a stand-in `docker` first on PATH, which lists the services of the files `COMPOSE_FILE` names
and answers every other call with the code the case gives. The seed's own decisions are judged by the backend's suite,
`fl_backend/tests/core/test_made_up_seed.py`.
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

# Every engine call, one per line; a hand-in's stdin kept under the file name its `cat >` writes. `compose config
# --services` lists what the files `COMPOSE_FILE` names declare (`docker-compose.yml` alone where it is unset, as on
# the server's checkout), and `compose ps` the services the case's `running` file holds.
DOCKER: Final = r"""#!/usr/bin/env bash
d="$FL_SEED_DIR"
printf '%s\n' "$*" >> "$d/calls"
answer() { cat "$d/$1" 2>/dev/null || printf 0; }
case " $* " in
  " version "*) exit "$(answer version)" ;;
  " compose config --services ")
    printf '%s\n' frontend backend nginx cloudflared
    case "${COMPOSE_FILE-}" in *docker-compose.local.yml*) printf '%s\n' mongo ;; esac
    exit "$(answer config)" ;;
  " compose ps --status running --services ") cat "$d/running"; exit 0 ;;
  *" sh -c "*) target="${*##* }"; cat > "$d/handed.${target##*/}"; exit "$(answer hand)" ;;
  *" tests.made_up_seed "*) exit "$(answer seed)" ;;
  *" app.readback "*) exit "$(answer readback)" ;;
esac
exit 0
"""


def seed(
    *args: str,
    stack: Mapping[str, str] = LOCAL_STACK,
    running: str = "mongo\nbackend\n",
    codes: Mapping[str, int] = MappingProxyType({}),
) -> tuple[int, str, list[str], set[str]]:
    """One run of the script: its exit code, its output, the engine calls and the files it handed in.

    `codes` gives the code each kind of call answers with (`version`, `config`, `hand`, `seed`, `readback`), 0 otherwise.
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
    (engine / "running").write_bytes(running.encode())
    for name, code in codes.items():
        (engine / name).write_bytes(str(code).encode())
    environment = {name: value for name, value in base_env().items() if name not in ("COMPOSE_FILE", "TAG")}
    environment |= {**stack, "PATH": str(stubs) + os.pathsep + os.environ["PATH"], "FL_SEED_DIR": engine.as_posix()}
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
    ("args", "codes", "expected"),
    [
        (("--landing=runing",), {"seed": 2}, 2),
        ((), {"seed": 2}, 2),
        ((), {"seed": 1}, 1),
        ((), {"hand": 1}, 1),
        ((), {"readback": 1}, 1),
        ((), {"readback": 3}, 2),
    ],
    ids=["unknown-state-refused", "seed-refusal-stays-refused", "seed-fails", "hand-in-fails", "document-refused", "read-back-cannot-judge"],
)
def test_a_refusal_stays_apart_from_a_failure(args: tuple[str, ...], codes: dict[str, int], expected: int) -> None:
    code, said, calls, _ = seed(*args, codes=codes)
    assert code == expected, said
    # Nothing is judged after a seed that did not load.
    if codes.keys() & {"seed", "hand"}:
        assert not any("app.readback" in call for call in calls), calls


@pytest.mark.parametrize(
    ("stack", "running", "codes"),
    [
        # The server's checkout: no COMPOSE_FILE, so Compose reads `docker-compose.yml` alone, with the deploy's TAG.
        ({"TAG": "sha-1234567"}, "frontend\nbackend\nnginx\ncloudflared\n", {}),
        # Each with the backend running, so only the refusal the case names stands between the run and a container.
        (LOCAL_STACK, "mongo\nbackend\n", {"version": 1}),
        (LOCAL_STACK, "mongo\nbackend\n", {"config": 15}),
        (LOCAL_STACK, "mongo\n", {}),
        (LOCAL_STACK, "mongo\nbackend\nfrontend\n", {}),
    ],
    ids=["production-stack", "no-engine", "unresolved-stack", "no-backend-running", "frontend-running"],
)
def test_nothing_reaches_a_container_but_in_a_local_stack_with_its_backend_running_and_its_frontend_not(
    stack: Mapping[str, str], running: str, codes: dict[str, int]
) -> None:
    code, said, calls, handed = seed(stack=stack, running=running, codes=codes)
    assert code == 2, said
    assert not handed, calls
    assert not any(" exec " in f" {call} " for call in calls), calls
