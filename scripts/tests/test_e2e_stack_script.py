"""The end-to-end stack's start and verdict, driven through `scripts/ops/e2e_stack.sh` itself behind a stand-in engine

No case can raise the stack, which needs the images and an engine. Each copies the script with `made_up_seed.sh`,
`local.sh` and `_lib.sh` into a fixture tree of its own and puts a stand-in `docker` first on PATH, which logs every
call with the compose files it was given and answers each kind of call with the code the case gives, and a stand-in
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

# Each call as `<COMPOSE_FILE> | <arguments>`. The kinds: `down`, `build`, `start` (the `up` without a wait), `wait`
# (the database and the backend waited for), `rest` (the whole stack waited for), and the seed's three.
DOCKER: Final = r"""#!/usr/bin/env bash
d="$FL_STACK_DIR"
printf '%s | %s\n' "${COMPOSE_FILE-}" "$*" >> "$d/calls"
answer() { cat "$d/$1" 2>/dev/null || printf 0; }
case " $* " in
  *" compose down "*) exit "$(answer down)" ;;
  *" compose build "*) exit "$(answer build)" ;;
  *" --wait-timeout 180 "*) exit "$(answer wait)" ;;
  *" --wait-timeout 240 "*) exit "$(answer rest)" ;;
  *" compose up "*) exit "$(answer start)" ;;
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
    # The local stack's files, as a caller beside it exports them: the script must name its own.
    environment = base_env() | {
        "PATH": str(stubs) + os.pathsep + os.environ["PATH"],
        "FL_STACK_DIR": engine.as_posix(),
        "COMPOSE_FILE": "docker-compose.yml;docker-compose.local.yml",
    }
    done = run_shell(BASH, root / script, *args, env=environment, cwd=root)
    calls = (engine / "calls").read_bytes().decode().splitlines() if (engine / "calls").exists() else []
    compose = [call for call in calls if " | compose " in call]
    assert all(call.startswith(f"{E2E_FILES} | ") for call in compose), compose
    return done.returncode, done.stdout + done.stderr, [kind(call.partition(" | ")[2]) for call in compose]


def checkout() -> Path:
    root = new_root("fl-stack-")
    for file in SCRIPTS:
        (root / file).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(REPO_ROOT / file, root / file)
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
    assert kinds == ["wait", "hand", "hand", "hand", "seed", "readback", "rest"], kinds


@pytest.mark.parametrize(
    ("args", "codes", "expected", "last"),
    [
        (("serve",), {"readback": 3}, 2, "readback"),
        (("serve",), {"seed": 1}, 1, "seed"),
        (("serve",), {"wait": 1}, 1, "wait"),
        (("start",), {"down": 1}, 1, "down"),
        (("start", "--build"), {"build": 1}, 1, "build"),
    ],
    ids=["seed-refused-stays-refused", "seed-fails", "wait-fails", "teardown-fails", "build-fails"],
)
def test_nothing_starts_after_a_step_that_did_not_hold(args: tuple[str, ...], codes: dict[str, int], expected: int, last: str) -> None:
    code, said, kinds = stack(checkout(), *args, codes=codes)
    assert code == expected, said
    assert kinds[-1] == last, kinds


@pytest.mark.parametrize(("codes", "expected"), [({"readback": 3}, 2), ({"seed": 1}, 1)], ids=["refused", "failed"])
def test_local_sh_keeps_the_stack_s_verdict(codes: dict[str, int], expected: int) -> None:
    code, said, kinds = stack(checkout(), "--e2e", codes=codes, script="scripts/ops/local.sh")
    assert code == expected, said
    assert kinds[:3] == ["down", "build", "start"], kinds
    assert "rest" not in kinds, kinds
