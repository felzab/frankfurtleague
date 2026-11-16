"""The made-up seed's verdict, driven through `scripts/ops/made_up_seed.sh` itself behind a stand-in engine

Every caller fails on any code but 0, so only this suite tells a refusal from a failure: no engine, a stack running
no local database service or no backend of its own, or with a frontend not stopped, a state the seed does not hold, or
a read-back that could not judge, is 2, a seed or a document to correct, named by its own closing line, is 1, an
interrupt 130, and a crash 3 or more, a Compose call that failed and a 1 without its closing line among them. Each case
copies the script with `_lib.sh` into a fixture tree of its own and puts a stand-in `docker` first on PATH, which lists
the containers the case gives and answers every call with the code and the words the case gives.
The seed's own decisions are judged by the backend's suite, `fl_backend/tests/core/test_made_up_seed.py`.
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

# Every engine call, one per line; a hand-in's stdin kept under the file name its `cat >` writes. `compose ps` lists
# the containers the case's `states` file holds, as `<service> <state> <one-off label>`, whatever code it answers with.
# The seed and the read-back print what the case's `<kind>.said` holds, on stderr.
DOCKER: Final = r"""#!/usr/bin/env bash
d="$FL_SEED_DIR"
printf '%s\n' "$*" >> "$d/calls"
answer() { cat "$d/$1" 2>/dev/null || printf 0; }
case " $* " in
  " version "*) exit "$(answer version)" ;;
  *" compose ps --all --format "*) cat "$d/states"; exit "$(answer ps)" ;;
  *" sh -c "*) target="${*##* }"; cat > "$d/handed.${target##*/}"; exit "$(answer hand)" ;;
  *" tests.made_up_seed "*) cat "$d/seed.said" >&2 2>/dev/null; exit "$(answer seed)" ;;
  *" app.readback "*) cat "$d/readback.said" >&2 2>/dev/null; exit "$(answer readback)" ;;
esac
exit 0
"""


def seed(
    *args: str,
    states: str = "mongo running False\nbackend running False\n",
    codes: Mapping[str, int] = MappingProxyType({}),
    said: Mapping[str, str] = MappingProxyType({}),
) -> tuple[int, str, list[str], set[str]]:
    """One run of the script: its exit code, its output, the engine calls and the files it handed in.

    `states` is what `compose ps` lists; `codes` gives the code each kind of call answers with (`version`, `ps`, `hand`,
    `seed`, `readback`), 0 otherwise, and `said` what the seed and the read-back print.
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
    (engine / "states").write_bytes(states.encode())
    for name, code in codes.items():
        (engine / name).write_bytes(str(code).encode())
    for name, words in said.items():
        (engine / f"{name}.said").write_bytes(words.encode())
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


# Each program's own closing line for its 1, as made_up_seed.py and readback.py print it.
INSERT_REFUSED: Final = "An insert was refused: E11000 duplicate key error collection: fl_made_up.teams\n"
DOCUMENT_REFUSED: Final = "12 documents read, 1 refused.\n"


@pytest.mark.parametrize(
    ("args", "codes", "said", "expected"),
    [
        (("--landing=runing",), {"seed": 2}, {}, 2),
        ((), {"seed": 2}, {}, 2),
        ((), {"seed": 1}, {"seed": INSERT_REFUSED}, 1),
        ((), {"readback": 1}, {"readback": DOCUMENT_REFUSED}, 1),
        ((), {"readback": 2}, {}, 2),
        # Compose answers its own errors 1, and so does Python for a module that never ran: without the program's
        # closing line, a 1 judged nothing about the seed, a crash.
        ((), {"seed": 1}, {"seed": "Error response from daemon: container is not running\n"}, 3),
        ((), {"readback": 1}, {"readback": "No module named app.readback\n"}, 3),
        # A hand-in that failed handed nothing in, so nothing was judged: Compose's own failure, a crash.
        ((), {"hand": 1}, {}, 3),
        # A crash keeps the child's own status where it is 3 or more, and an interrupt stays 130.
        ((), {"seed": 137}, {}, 137),
        ((), {"seed": 130}, {}, 130),
        ((), {"readback": 3}, {}, 3),
        ((), {"readback": 130}, {}, 130),
    ],
    ids=[
        "unknown-state-refused",
        "seed-refusal-stays-refused",
        "seed-fails",
        "document-refused",
        "read-back-cannot-judge",
        "seed-1-without-its-line-crashes",
        "read-back-1-without-its-line-crashes",
        "hand-in-crashes",
        "seed-crashes",
        "seed-interrupted",
        "read-back-crashes",
        "read-back-interrupted",
    ],
)
def test_each_verdict_keeps_its_own_code(args: tuple[str, ...], codes: dict[str, int], said: dict[str, str], expected: int) -> None:
    code, output, calls, _ = seed(*args, codes=codes, said=said)
    assert code == expected, output
    # Nothing is judged after a seed that did not load.
    if codes.keys() & {"seed", "hand"}:
        assert not any("app.readback" in call for call in calls), calls


# Production on the server's checkout with its frontend stopped, whichever files the checkout's Compose reads.
PRODUCTION_STOPPED_FRONTEND: Final = "frontend exited False\nbackend running False\nnginx running False\ncloudflared running False\n"
# Every state Compose lists a container in but the two of one that stays stopped.
NOT_STOPPED: Final = ("running", "restarting", "paused", "removing", "dead")
# The stack's own containers, as Compose labels a service's: `docker compose run` labels its one-off `True`.
OWN: Final = "mongo running False\nbackend running False\n"


@pytest.mark.parametrize("state", ["exited", "created"])
def test_a_stopped_frontend_leaves_the_seed_to_run(state: str) -> None:
    code, said, _, handed = seed(states=f"{OWN}frontend {state} False\n")
    assert code == 0, said
    assert handed == {file.rsplit("/", 1)[-1] for file in SEED_FILES}


def test_a_listing_compose_could_not_give_is_a_crash_and_reaches_no_container() -> None:
    """Compose answers any error with its 1, our invocation's among them, so a listing it failed judged nothing."""
    code, said, calls, handed = seed(states=OWN, codes={"ps": 15})
    assert code == 15, said
    assert "Compose could not list the stack's containers" in said, said
    assert not handed, calls
    assert not any(" exec " in f" {call} " for call in calls), calls


@pytest.mark.parametrize(
    ("states", "codes", "refusal"),
    [
        (PRODUCTION_STOPPED_FRONTEND, {}, "this one runs no mongo service"),
        (OWN, {"version": 1}, "Docker is not responding"),
        ("mongo running False\nbackend exited False\n", {}, "the stack's backend is not running"),
        # A one-off container lists under its service's name, and runs none of the service's work.
        ("mongo running False\nbackend exited False\nbackend running True\n", {}, "the stack's backend is not running"),
        ("mongo running True\nbackend running False\n", {}, "this one runs no mongo service"),
        *((f"{OWN}frontend {state} False\n", {}, f"the stack's frontend is {state},") for state in NOT_STOPPED),
        # A one-off frontend writes as the service's own does.
        (f"{OWN}frontend exited False\nfrontend running True\n", {}, "the stack's frontend is running,"),
    ],
    ids=[
        "production-stack",
        "no-engine",
        "no-backend-running",
        "a-one-off-backend-alone",
        "a-one-off-mongo-alone",
        *(f"frontend-{state}" for state in NOT_STOPPED),
        "a-one-off-frontend-running",
    ],
)
def test_nothing_reaches_a_container_but_in_a_local_stack_with_its_backend_running_and_its_frontend_stopped(
    states: str, codes: dict[str, int], refusal: str
) -> None:
    # Every refusal but the case's own is met, so that one alone stands between the run and a container.
    code, said, calls, handed = seed(states=states, codes=codes)
    assert code == 2, said
    assert refusal in said, said
    assert not handed, calls
    assert not any(" exec " in f" {call} " for call in calls), calls
