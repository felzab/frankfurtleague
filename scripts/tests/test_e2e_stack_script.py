"""The end-to-end stack's start and verdict, driven through `scripts/ops/e2e_stack.sh` itself behind a stand-in engine

No case can raise the stack, which needs the images and an engine. Each copies the script with `made_up_seed.sh`,
`local.sh` and `_lib.sh` into a fixture tree of its own and puts a stand-in `docker` first on PATH, which logs every
call with the compose files and project it was given and answers each kind of call with the code the case gives, and a stand-in
`uname` answering as Git Bash does, so `local.sh` runs on any machine. `local.sh --e2e` and CI's journeys fail on any
code but 0, so only this suite tells the seed's refusal from a failure, and only it sees a stack started over a failed
step.
"""

from __future__ import annotations

import os
import re
import shutil
from collections.abc import Mapping
from pathlib import Path
from types import MappingProxyType
from typing import Final

import pytest
from conftest import BASH, REPO_ROOT, base_env, new_root, run_shell, write_shell

SCRIPTS: Final = ("scripts/ops/e2e_stack.sh", "scripts/ops/made_up_seed.sh", "scripts/ops/local.sh", "scripts/lib/_lib.sh")
SEED_FILES: Final = ("fl_backend/tests/documents.py", "fl_backend/tests/made_up_seed.py", "fl_backend/tests/made_up_people.json")
KEYS: Final = ("auth_secret", "internal_api_key_base", "internal_api_key_system", "internal_api_key_admin")
E2E_FILES: Final = "docker-compose.yml:docker-compose.local.yml:docker-compose.e2e.yml"
# The project docker-compose.e2e.yml names, which every call must reach whatever the caller's environment names.
(E2E_PROJECT,) = re.findall(r"(?m)^name: (\S+)$", (REPO_ROOT / "docker-compose.e2e.yml").read_bytes().decode())

# Each call as `<COMPOSE_FILE> | <COMPOSE_PROJECT_NAME> | <arguments>`. The kinds: `down`, `build`, `start` (the `up` without a wait), `wait`
# (the database and the backend waited for), `rest` (the whole stack waited for), and the seed's five: `services`
# and `running`, its look at the stack, then `hand`, `seed` and `readback`.
DOCKER: Final = r"""#!/usr/bin/env bash
d="$FL_STACK_DIR"
printf '%s | %s | %s\n' "${COMPOSE_FILE-}" "${COMPOSE_PROJECT_NAME-}" "$*" >> "$d/calls"
answer() { cat "$d/$1" 2>/dev/null || printf 0; }
case " $* " in
  *" compose down "*) exit "$(answer down)" ;;
  *" compose build "*) exit "$(answer build)" ;;
  *" --wait-timeout 180 "*) exit "$(answer wait)" ;;
  *" --wait-timeout 240 "*) exit "$(answer rest)" ;;
  *" compose up "*) exit "$(answer start)" ;;
  # The services the three files declare, and the two the wait above has running.
  *" compose config --services "*) printf '%s\n' frontend backend mongo nginx cloudflared; exit 0 ;;
  *" compose ps --status running --services "*) printf '%s\n' mongo backend; exit 0 ;;
  *" sh -c "*) cat > /dev/null; exit "$(answer hand)" ;;
  *" tests.made_up_seed "*) exit "$(answer seed)" ;;
  *" app.readback "*) exit "$(answer readback)" ;;
esac
exit 0
"""
UNAME: Final = "#!/usr/bin/env bash\nprintf '%s\\n' MINGW64_NT-10.0-26100\n"


def kind(call: str) -> str:
    """The kind of one logged call, as the stand-in told them apart."""
    for needle, name in (
        (" compose down ", "down"),
        (" compose build", "build"),
        ("--wait-timeout 180", "wait"),
        ("--wait-timeout 240", "rest"),
        (" compose up ", "start"),
        (" compose config --services ", "services"),
        (" compose ps --status running --services ", "running"),
        (" sh -c ", "hand"),
        ("tests.made_up_seed", "seed"),
        ("app.readback", "readback"),
    ):
        if needle in f" {call} ":
            return name
    return "other"


def stack(
    root: Path, *args: str, codes: Mapping[str, int] = MappingProxyType({}), script: str = "scripts/ops/e2e_stack.sh"
) -> tuple[int, str, list[str]]:
    """One run of `script` in `root`, each kind of call in `codes` answering with its code, 0 otherwise.

    Returns the exit code, the output and the kinds of engine call made, in order.
    """
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    engine = new_root("fl-stack-engine-")
    stubs = engine / "stubs"
    stubs.mkdir()
    for name, text in (("docker", DOCKER), ("uname", UNAME)):
        os.chmod(write_shell(stubs / name, text), 0o755)
    for name, code in codes.items():
        (engine / name).write_bytes(str(code).encode())
    # The local stack's files and project, as a caller beside it exports them: the script must name its own.
    environment = base_env() | {
        "PATH": str(stubs) + os.pathsep + os.environ["PATH"],
        "FL_STACK_DIR": engine.as_posix(),
        "COMPOSE_FILE": "docker-compose.yml;docker-compose.local.yml",
        "COMPOSE_PROJECT_NAME": "frankfurtleague",
    }
    done = run_shell(BASH, root / script, *args, env=environment, cwd=root)
    calls = (engine / "calls").read_bytes().decode().splitlines() if (engine / "calls").exists() else []
    compose = [call.split(" | ", 2) for call in calls if " | compose " in call]
    # By either separator: local.sh spells Windows' own, and e2e_stack.sh the one it sets.
    assert all(re.split("[:;]", files) == E2E_FILES.split(":") and project == E2E_PROJECT for files, project, _ in compose), compose
    return done.returncode, done.stdout + done.stderr, [kind(arguments) for _, _, arguments in compose]


def checkout() -> Path:
    root = new_root("fl-stack-")
    for file in SCRIPTS:
        (root / file).parent.mkdir(parents=True, exist_ok=True)
        # `copy`, not `copyfile`: the script runs `made_up_seed.sh` as a program, which Linux refuses without its mode.
        shutil.copy(REPO_ROOT / file, root / file)
    for file in SEED_FILES:
        (root / file).parent.mkdir(parents=True, exist_ok=True)
        (root / file).write_bytes(file.encode())
    return root


def test_a_start_runs_on_new_keys_over_an_empty_stack_and_mail_sink_and_serves_once_seeded() -> None:
    root = checkout()
    sink = root / ".tmp-e2e/mail"
    sink.mkdir(parents=True)
    (sink / "earlier").write_bytes(b"a code an earlier run filed")

    code, said, kinds = stack(root, "start")
    assert code == 0, said
    assert kinds == ["down", "start"], kinds
    assert not any(sink.iterdir())
    first = {name: (root / ".tmp-e2e/secrets" / name).read_bytes() for name in KEYS}
    assert all(re.fullmatch(rb"[0-9a-f]{64}", key) for key in first.values()), first
    assert not any(key.decode() in said for key in first.values())

    code, said, kinds = stack(root, "start", "--build")
    assert code == 0, said
    assert kinds == ["down", "build", "start"], kinds
    assert all((root / ".tmp-e2e/secrets" / name).read_bytes() != key for name, key in first.items())

    code, said, kinds = stack(root, "serve")
    assert code == 0, said
    assert kinds == ["wait", "services", "running", "hand", "hand", "hand", "seed", "readback", "rest"], kinds


@pytest.mark.parametrize(
    ("args", "codes", "expected", "last"),
    [
        (("serve",), {"readback": 2}, 2, "readback"),
        (("serve",), {"seed": 1}, 1, "seed"),
        # The seed's crash keeps its own status, and an interrupt stays 130.
        (("serve",), {"seed": 137}, 137, "seed"),
        (("serve",), {"seed": 130}, 130, "seed"),
        (("serve",), {"wait": 1}, 1, "wait"),
        (("start",), {"down": 1}, 1, "down"),
        (("start", "--build"), {"build": 1}, 1, "build"),
    ],
    ids=["seed-refused-stays-refused", "seed-fails", "seed-crashes", "seed-interrupted", "wait-fails", "teardown-fails", "build-fails"],
)
def test_nothing_starts_after_a_step_that_did_not_hold(args: tuple[str, ...], codes: dict[str, int], expected: int, last: str) -> None:
    code, said, kinds = stack(checkout(), *args, codes=codes)
    assert code == expected, said
    assert kinds[-1] == last, kinds


@pytest.mark.parametrize(
    ("codes", "expected"),
    [({"readback": 2}, 2), ({"seed": 1}, 1), ({"seed": 137}, 137), ({"seed": 130}, 130)],
    ids=["refused", "failed", "crashed", "interrupted"],
)
def test_local_sh_keeps_the_stack_s_verdict(codes: dict[str, int], expected: int) -> None:
    code, said, kinds = stack(checkout(), "--e2e", codes=codes, script="scripts/ops/local.sh")
    assert code == expected, said
    assert kinds[:3] == ["down", "build", "start"], kinds
    assert "rest" not in kinds, kinds


def test_local_sh_deletes_the_end_to_end_stack_s_volume_alone() -> None:
    # Its own call rather than `e2e_stack.sh`'s, so `stack` holds the project local.sh names.
    code, said, kinds = stack(checkout(), "--e2e", "--down", script="scripts/ops/local.sh")
    assert code == 0, said
    assert kinds == ["down"], kinds
