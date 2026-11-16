"""The image checks a successful build does not make, and how each answer is graded.

A build reports success over an image missing `instrumentation.js`, over one that runs as
root, and over a context its dockerignore stopped covering, so the three probes in the images scope
are the only things that read any of it. Each answers three ways, and the third -- an image that
would not run at all -- is no finding about the image. Every case drives the gate's own `--images`
scope behind a stand-in `docker`, so no daemon and no build.
"""

from __future__ import annotations

import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import pytest
from conftest import BASH, REPO_ROOT, base_env, run_shell, write_shell

SCRIPTS: Final = REPO_ROOT / "scripts"
VERIFY: Final = SCRIPTS / "gate" / "verify.sh"
LIB: Final = SCRIPTS / "lib" / "_lib.sh"


CASE_VAR: Final = "FL_IMAGE_CASE"
ONLY_VAR: Final = "FL_IMAGE_ONLY"

# The `-c` argument -- what the container was asked to run -- tells the probes apart.

# A case answers for every image, or for the one `FL_IMAGE_ONLY` names alone, so a check handed the
# wrong list meets a clean image.
STUB: Final = """#!/usr/bin/env bash
set -u
case_for() { # $1 the image asked about
  if [[ -z "${FL_IMAGE_ONLY:-}" || "$1" == *"${FL_IMAGE_ONLY}"* ]]; then printf '%s' "${FL_IMAGE_CASE:-clean}"; else printf clean; fi
}
case "${1:-}" in
  version) printf 'stub\\n'; exit 0 ;;
  buildx)
    # The local build is CI's own definition: any other build, or any call the scope is not to make,
    # is refused, here and below, so it fails every case whose build is to succeed.
    if [[ "${2:-}" != bake || " $* " != *" --file docker-bake.hcl "* ]]; then
      printf 'stub: not a bake of docker-bake.hcl: %s\\n' "$*"; exit 1
    fi
    case "${FL_IMAGE_CASE:-clean}" in
      build_failed) printf '%s\\n' "ERROR: failed to solve"; exit 1 ;;
      build_exhausted) exit 102 ;;
      build_internal) exit 100 ;;
      build_interrupted) exit 130 ;;
    esac
    exit 0 ;;
  image) exit 0 ;;
esac
if [[ "${1:-}" != "run" ]]; then printf 'stub: no answer for docker %s\\n' "$*"; exit 1; fi
cmd=""
image=""
prev=""
for arg in "$@"; do
  if [[ "$prev" == "-c" ]]; then cmd="$arg"; fi
  if [[ "$arg" == "-c" ]]; then image="$prev"; fi
  prev="$arg"
done
FL_IMAGE_CASE="$(case_for "$image")"
case "$cmd" in
  *instrumentation.js*)
    case "${FL_IMAGE_CASE:-clean}" in
      instrumentation_interrupted) exit 130 ;;
      instrumentation_unreadable) exit 125 ;;
      instrumentation_unrunnable) exit 127 ;;
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
    # The sentence this ending must NOT carry: an image that would not run wearing a finding's words
    # sends the reader to a file that is fine.
    never: str | None = None
    # The one package whose image carries the case, the other's answering clean.
    only: str | None = None
    # Built by the workflow, as CI's images job hands the scope its two images.
    built: bool = False

    @property
    def label(self) -> str:
        return " ".join(part for part in (self.name, self.only and f"{self.only} alone", self.built and "prebuilt") if part)


CASES: Final[tuple[Case, ...]] = (
    # One per image each check reads: the caller names its images itself, so a list losing one is
    # caught only where that image alone carries the defect.
    Case("instrumentation_missing", 1, "instrumentation.js is MISSING", only="frontend"),
    Case("user_root", 1, "An image runs as root", only="frontend"),
    Case("user_root", 1, "An image runs as root", only="backend"),
    Case("context_breach", 1, "dockerignore exists to exclude", only="frontend"),
    Case("context_breach", 1, "dockerignore exists to exclude", only="backend"),
    Case("build_failed", 1, "failed to build"),
    # buildx's own statuses past its 1: BuildKit out of a resource judged nothing, and its internal error is a
    # crash, which ends on the status itself, the contract's "3 or more".
    Case("build_exhausted", 2, "Refused after", "failed to build"),
    Case("build_internal", 100, "Crashed after", "failed to build"),
    Case("build_interrupted", 130, "Interrupted after", "failed to build"),
    Case("clean", 0, "Green"),
    Case("clean", 0, "Green", built=True),
    Case("instrumentation_missing", 1, "instrumentation.js is MISSING"),
    Case("instrumentation_missing", 1, "instrumentation.js is MISSING", built=True),
    # Docker's own 125, the daemon failing, judged nothing; 127, the image without the probe's shell, is a crash.
    Case("instrumentation_unreadable", 2, "Refused after", "instrumentation.js is MISSING"),
    Case("instrumentation_unrunnable", 3, "Crashed after", "instrumentation.js is MISSING"),
    Case("instrumentation_interrupted", 130, "Interrupted after", "Crashed after"),
    Case("user_root", 1, "An image runs as root"),
    Case("user_unreadable", 2, "Refused after", "An image runs as root"),
    Case("user_interrupted", 130, "Interrupted after", "Crashed after"),
    Case("context_breach", 1, "dockerignore exists to exclude"),
    Case("context_unreadable", 2, "Refused after", "dockerignore exists to exclude"),
    Case("context_interrupted", 130, "Interrupted after", "Crashed after"),
)


def _stubbed(scratch: str, environment: dict[str, str]) -> dict[str, str]:
    """`environment` with the stand-in `docker` first on its PATH."""
    stub = write_shell(Path(scratch) / "docker", STUB)
    # The execute bit is what puts this ahead of a real daemon on PATH.
    os.chmod(stub, 0o755)
    return {**environment, "PATH": scratch + os.pathsep + environment["PATH"]}


def _run(case: Case) -> tuple[int, str]:
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    environment = base_env()
    # Past `base_env`: an inherited tag or prebuilt flag would name another run's images.
    for inherited in ("VERIFY_TAG", "VERIFY_IMAGES_BUILT", ONLY_VAR):
        environment.pop(inherited, None)
    environment[CASE_VAR] = case.name
    if case.only is not None:
        environment[ONLY_VAR] = case.only
    if case.built:
        environment["VERIFY_TAG"] = "prebuilt"
        environment["VERIFY_IMAGES_BUILT"] = "1"
    with tempfile.TemporaryDirectory() as scratch:
        done = run_shell(BASH, VERIFY, "--images", env=_stubbed(scratch, environment))
    return done.returncode, done.stdout + done.stderr


@pytest.mark.parametrize("case", CASES, ids=[case.label for case in CASES])
def test_each_answer_the_image_assertions_can_give_ends_the_run_its_own_way(case: Case) -> None:
    """A build proves neither promise, so a wrong grading here ships behind a green gate."""
    code, output = _run(case)
    wrong: list[str] = []
    if code != case.code:
        wrong.append(f"exited {code}, and the contract gives it {case.code}\n{output}")
    if case.says not in output:
        wrong.append(f"nothing it printed says {case.says!r}")
    if case.never is not None and case.never in output:
        wrong.append(f"it said {case.never!r}, which names a breach nothing observed")
    if case.built and "buildx bake" in output:
        wrong.append("it built the images the workflow had built")
    assert not wrong, "\n".join(wrong)


def _searched_shapes() -> frozenset[str]:
    """Every name shape the library's `IMAGE_CONTEXT_FIND` looks for.

    Quoted names only, which is what leaves the two pruned directories out: they are spelled bare
    in the same expression.
    """
    declaration = ""
    for line in LIB.read_text(encoding="utf-8").splitlines():
        if line.startswith("IMAGE_CONTEXT_FIND="):
            declaration = line
            break
    assert declaration, "scripts/lib/_lib.sh no longer declares IMAGE_CONTEXT_FIND"
    return frozenset(re.findall(r'-name "([^"]+)"', declaration))


def _excluded_shapes(dockerignore: Path) -> frozenset[str]:
    """One `.dockerignore`'s block of credential shapes, read from the comment that marks it.

    The block ends at the first blank line past a pattern; a comment inside it is skipped, each
    explaining the entry below it.
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
