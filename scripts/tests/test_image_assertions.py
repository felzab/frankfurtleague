"""SCRIPTS · the image checks a successful build does not make, and how each answer is graded.

A `docker build` reports success over an image missing `instrumentation.js`, over one that runs as
root, and over a context its dockerignore stopped covering, so the three probes in the images scope
are the only things that read any of it. Each answers three ways, and the third -- an image that
would not run at all -- is a refusal rather than a finding (`docs/ops/spec.md` §1.6). Every case
drives the gate's own `--images` scope behind a stand-in `docker`, so no daemon and no build.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from conftest import base_env

SCRIPTS: Final = Path(__file__).resolve().parent.parent
REPO_ROOT: Final = SCRIPTS.parent
VERIFY: Final = SCRIPTS / "gate" / "verify.sh"

# Not a skip condition, for `scripts/tests/test_exit_contract.py :: BASH`'s reason.
BASH: Final = shutil.which("bash")

CASE_VAR: Final = "FL_IMAGE_CASE"

# The `-c` argument -- what the container was asked to run -- tells the probes apart.
STUB: Final = """#!/usr/bin/env bash
set -u
case "${1:-}" in
  version) printf 'stub\\n'; exit 0 ;;
  build|buildx|image|tag) exit 0 ;;
esac
if [[ "${1:-}" != "run" ]]; then exit 0; fi
cmd=""
prev=""
for arg in "$@"; do
  if [[ "$prev" == "-c" ]]; then cmd="$arg"; fi
  prev="$arg"
done
case "$cmd" in
  *instrumentation.js*)
    case "${FL_IMAGE_CASE:-clean}" in
      instrumentation_interrupted) exit 130 ;;
      instrumentation_unreadable) exit 125 ;;
      instrumentation_missing) exit 1 ;;
      *) exit 0 ;;
    esac ;;
  "id -u")
    case "${FL_IMAGE_CASE:-clean}" in
      user_interrupted) exit 130 ;;
      user_unreadable) exit 125 ;;
      user_root) printf '0\\n'; exit 0 ;;
      *) printf '1001\\n'; exit 0 ;;
    esac ;;
  find*)
    case "${FL_IMAGE_CASE:-clean}" in
      context_interrupted) exit 130 ;;
      context_unreadable) exit 125 ;;
      context_breach) printf '/app/planted\\n'; exit 0 ;;
      *) exit 0 ;;
    esac ;;
esac
exit 0
"""


@dataclass(frozen=True)
class Case:
    name: str
    code: int
    says: str
    # The sentence this ending must NOT carry: a refusal wearing a finding's words is the defect
    # these cases exist to hold shut.
    never: str | None = None


CASES: Final[tuple[Case, ...]] = (
    Case("clean", 0, "Green"),
    Case("instrumentation_missing", 1, "instrumentation.js is MISSING"),
    Case("instrumentation_unreadable", 2, "Refused after", "instrumentation.js is MISSING"),
    Case("instrumentation_interrupted", 130, "Interrupted after", "Refused after"),
    Case("user_root", 1, "An image runs as root"),
    Case("user_unreadable", 2, "Refused after", "An image runs as root"),
    Case("user_interrupted", 130, "Interrupted after", "Refused after"),
    Case("context_breach", 1, "dockerignore exists to exclude"),
    Case("context_unreadable", 2, "Refused after", "dockerignore exists to exclude"),
    Case("context_interrupted", 130, "Interrupted after", "Refused after"),
)


def _run(case: Case) -> tuple[int, str]:
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    environment = base_env()
    # Past `base_env`: `VERIFY_TAG` and its cache name another run's images, and `CI` skips the scope
    # check, which reads the branch's diff.
    for inherited in ("VERIFY_TAG", "VERIFY_IMAGES_CACHE"):
        environment.pop(inherited, None)
    environment.update({"CI": "1", CASE_VAR: case.name})
    with tempfile.TemporaryDirectory() as scratch:
        stub = Path(scratch) / "docker"
        # `newline=""` (CLAUDE.md §6); the execute bit is what puts this ahead of a real daemon on PATH.
        with stub.open("w", encoding="utf-8", newline="") as handle:
            handle.write(STUB)
        os.chmod(stub, 0o755)
        environment["PATH"] = scratch + os.pathsep + environment["PATH"]
        done = subprocess.run(
            (BASH, VERIFY.as_posix(), "--images", "--serial"),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=environment,
            check=False,
        )
    return done.returncode, done.stdout + done.stderr


def test_each_answer_the_image_assertions_can_give_ends_the_run_its_own_way() -> None:
    """A build proves neither promise, so a wrong grading here ships behind a green gate."""
    wrong: list[str] = []
    for case in CASES:
        code, output = _run(case)
        if code != case.code:
            wrong.append(f"{case.name}: exited {code}, and the contract gives it {case.code}")
        if case.says not in output:
            wrong.append(f"{case.name}: nothing it printed says {case.says!r}")
        if case.never is not None and case.never in output:
            wrong.append(f"{case.name}: it said {case.never!r}, which names a breach nothing observed")
    assert not wrong, "\n".join(wrong)


def _searched_shapes() -> frozenset[str]:
    """Every name shape `scripts/gate/verify.sh :: IMAGE_CONTEXT_FIND` looks for.

    Quoted names only, which is what leaves the two pruned directories out: they are spelled bare
    in the same expression.
    """
    declaration = ""
    for line in VERIFY.read_text(encoding="utf-8").splitlines():
        if line.startswith("IMAGE_CONTEXT_FIND="):
            declaration = line
            break
    assert declaration, "scripts/gate/verify.sh no longer declares IMAGE_CONTEXT_FIND"
    return frozenset(re.findall(r'-name "([^"]+)"', declaration))


def _excluded_shapes(dockerignore: Path) -> frozenset[str]:
    """One `.dockerignore`'s block of credential shapes, read from the comment that marks it.

    The block ends at the first blank line past a pattern; a comment inside it is skipped, one
    file explaining a single entry in the middle of the run.
    """
    lines = dockerignore.read_text(encoding="utf-8").splitlines()
    marked = [i for i, line in enumerate(lines) if "Matched by shape" in line]
    assert marked, f"{dockerignore.name} no longer marks the block of shapes it excludes by shape"
    shapes: list[str] = []
    for line in lines[marked[0] + 1 :]:
        text = line.strip()
        if not text:
            if shapes:
                break
            continue
        if text.startswith("#"):
            continue
        shapes.append(text.removeprefix("**/"))
    return frozenset(shapes)


def test_the_step_searches_for_every_shape_its_dockerignore_promises_to_exclude() -> None:
    """A shape excluded and unsearched is a promise the step makes and does not keep, silently."""
    searched = _searched_shapes()
    for package in ("fl_frontend", "fl_backend"):
        excluded = _excluded_shapes(REPO_ROOT / package / ".dockerignore")
        assert excluded, f"{package}: no shape was read out of its dockerignore"
        assert excluded == searched, (
            f"{package}: its dockerignore excludes {sorted(excluded - searched)} that the step does not "
            f"search for, and the step searches for {sorted(searched - excluded)} that it does not exclude"
        )
