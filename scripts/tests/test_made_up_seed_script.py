"""The made-up seed's verdict, driven through `scripts/ops/made_up_seed.sh` itself behind a stand-in engine

Every caller fails on any code but 0, so only this suite tells a refusal from a failure: a state the seed does not hold,
or a read-back that could not judge, is 2, and a seed or a document to correct is 1. Each case copies the script with
`_lib.sh` into a fixture tree of its own and puts a stand-in `docker` first on PATH, which answers the seed's run and
the read-back with the codes the case gives.
"""

from __future__ import annotations

import os
import shutil
from typing import Final

import pytest
from conftest import BASH, REPO_ROOT, base_env, new_root, run_shell, write_shell

SEED_FILES: Final = ("fl_backend/tests/documents.py", "fl_backend/tests/made_up_seed.py", "fl_backend/tests/made_up_people.json")

# Every engine call, one per line; a hand-in's stdin kept under the file name its `cat >` writes.
DOCKER: Final = r"""#!/usr/bin/env bash
d="$FL_SEED_DIR"
printf '%s\n' "$*" >> "$d/calls"
case " $* " in
  *" sh -c "*) target="${*##* }"; cat > "$d/handed.${target##*/}"; exit "$(cat "$d/hand")" ;;
  *" tests.made_up_seed "*) exit "$(cat "$d/seed")" ;;
  *" app.readback "*) exit "$(cat "$d/readback")" ;;
esac
exit 0
"""


def seed(*args: str, hand: int = 0, seeded: int = 0, read: int = 0) -> tuple[int, str, list[str], set[str]]:
    """One run of the script: its exit code, its output, the engine calls and the files it handed in."""
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
    for name, code in (("hand", hand), ("seed", seeded), ("readback", read)):
        (engine / name).write_bytes(str(code).encode())
    environment = base_env() | {"PATH": str(stubs) + os.pathsep + os.environ["PATH"], "FL_SEED_DIR": engine.as_posix()}
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
        (("--landing=runing",), {"seeded": 2}, 2),
        ((), {"seeded": 2}, 1),
        ((), {"seeded": 1}, 1),
        ((), {"hand": 1}, 1),
        ((), {"read": 1}, 1),
        ((), {"read": 3}, 2),
    ],
    ids=["unknown-state-refused", "two-without-a-state-fails", "seed-fails", "hand-in-fails", "document-refused", "read-back-cannot-judge"],
)
def test_a_refusal_stays_apart_from_a_failure(args: tuple[str, ...], codes: dict[str, int], expected: int) -> None:
    code, said, calls, _ = seed(*args, **codes)
    assert code == expected, said
    # Nothing is judged after a seed that did not load.
    if codes.keys() & {"seeded", "hand"}:
        assert not any("app.readback" in call for call in calls), calls
