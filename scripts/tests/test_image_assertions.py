"""SCRIPTS · the image checks a successful build does not make, and how each answer is graded.

A `docker build` reports success over an image missing `instrumentation.js`, over one that runs as
root, and over a context its dockerignore stopped covering, so the three probes are the only things
that read any of it: in the images scope, and in the publish workflow before it pushes. Each answers
three ways, and the third -- an image that would not run at all -- is a refusal rather than a
finding (`docs/ops/spec.md` §1.6). Every case drives the gate's own `--images` scope, or the
workflow's own step text, behind a stand-in `docker`, so no daemon and no build.
"""

from __future__ import annotations

import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from conftest import BASH, base_env, run_shell, write_shell

SCRIPTS: Final = Path(__file__).resolve().parent.parent
REPO_ROOT: Final = SCRIPTS.parent
VERIFY: Final = SCRIPTS / "gate" / "verify.sh"
LIB: Final = SCRIPTS / "lib" / "_lib.sh"
PUBLISH: Final = REPO_ROOT / ".github" / "workflows" / "publish.yml"


CASE_VAR: Final = "FL_IMAGE_CASE"

# The `-c` argument -- what the container was asked to run -- tells the probes apart. An inspect
# answers in the shape the publish workflow's templates print: one layer a line, then the user.
STUB: Final = """#!/usr/bin/env bash
set -u
case "${1:-}" in
  version) printf 'stub\\n'; exit 0 ;;
  build|tag) exit 0 ;;
  image)
    if [[ "${2:-}" == "inspect" ]]; then printf 'sha256:checked\\nuser=app\\n'; fi
    exit 0 ;;
  # The build loads the image and the cache export is a run of its own; each fails on its own case.
  buildx)
    if [[ "${2:-}" == "imagetools" ]]; then
      case "${FL_IMAGE_CASE:-clean}" in
        pushed_other) printf 'sha256:rebuilt\\nuser=app\\n' ;;
        *) printf 'sha256:checked\\nuser=app\\n' ;;
      esac
      exit 0
    fi
    # One run doing both would answer one status for the two, so it is no build this stub serves.
    if [[ "$*" == *--load* && "$*" == *--cache-to* ]]; then
      printf '%s\\n' "stub: one buildx run both loads and exports"
      exit 1
    fi
    case "$* ${FL_IMAGE_CASE:-clean}" in
      *--load*cache_build_failed) printf '%s\\n' "ERROR: failed to build: failed to solve"; exit 1 ;;
      *type=cacheonly*cache_export_failed) printf '%s\\n' "ERROR: error writing layer blob: not_found"; exit 1 ;;
      *type=cacheonly*cache_export_crashed) exit 125 ;;
    esac
    exit 0 ;;
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
    # Through the Actions cache, as `VERIFY_IMAGES_CACHE=gha` asks in CI.
    cached: bool = False
    # Whether that cache's credential is set, as the job's re-export step sets it.
    credentialed: bool = True
    # Each check a unit of the step pool, the path a CI run takes; serial, it runs in place.
    pooled: bool = False


CASES: Final[tuple[Case, ...]] = (
    Case("cache_clean", 0, "Green", cached=True),
    Case("cache_uncredentialed", 2, "ACTIONS_RUNTIME_TOKEN is not set", "finding(s) in this run", cached=True, credentialed=False),
    Case("cache_build_failed", 1, "The frontend image failed to build", "layer cache", cached=True),
    Case("cache_export_failed", 2, "exporting its layer cache", "failed to build.", cached=True, pooled=True),
    Case("cache_export_crashed", 125, "exit status 125", "cache service", cached=True),
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


def _stubbed(scratch: str, environment: dict[str, str]) -> dict[str, str]:
    """`environment` with the stand-in `docker` first on its PATH."""
    stub = write_shell(Path(scratch) / "docker", STUB)
    # The execute bit is what puts this ahead of a real daemon on PATH.
    os.chmod(stub, 0o755)
    return {**environment, "PATH": scratch + os.pathsep + environment["PATH"]}


def _run(case: Case) -> tuple[int, str]:
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    environment = base_env()
    # Past `base_env`: `VERIFY_TAG` and its cache name another run's images, and a runner's own
    # credential would stand in for the one a case leaves unset.
    for inherited in ("VERIFY_TAG", "VERIFY_IMAGES_CACHE", "ACTIONS_RUNTIME_TOKEN"):
        environment.pop(inherited, None)
    environment[CASE_VAR] = case.name
    if case.cached:
        environment["VERIFY_IMAGES_CACHE"] = "gha"
    if case.cached and case.credentialed:
        # A stand-in: the gate asks only that the variable is set before it builds.
        environment["ACTIONS_RUNTIME_TOKEN"] = "stand-in"
    with tempfile.TemporaryDirectory() as scratch:
        done = run_shell(BASH, VERIFY, "--images", *(() if case.pooled else ("--serial",)), env=_stubbed(scratch, environment))
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
        # A pool that could not start falls back to the serial path, and the case would prove that one twice.
        if case.pooled and "no python at the checkers' floor" in output:
            wrong.append(f"{case.name}: no pool started, so the pooled path went unexercised")
    assert not wrong, "\n".join(wrong)


def _searched_shapes() -> frozenset[str]:
    """Every name shape `scripts/lib/_lib.sh :: IMAGE_CONTEXT_FIND` looks for.

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


# --- the publish workflow's two steps, run as the runner runs them -------------------------------------

CHECK_STEP: Final = "Check both images before either is pushed"
SAME_STEP: Final = "Refuse a pushed image other than the one checked"
STEP_NAME_RE: Final = re.compile(r"^      - name: (.+)$")
RUN_BLOCK_RE: Final = re.compile(r"^        run: \|$")
JOB_ENV_RE: Final = re.compile(r"^      ((?:FRONTEND|BACKEND)_(?:IMAGE|CHECKED)): (\S+)$", re.MULTILINE)
# What `shell: bash` expands to on the runner, less the two flags that only skip start-up files.
RUNNER_SHELL: Final = "set -eo pipefail\n"


def _run_block(workflow: str, name: str) -> str:
    """The `run: |` text of the step `name`, dedented to the margin."""
    lines = workflow.splitlines()
    starts = [i for i, line in enumerate(lines) if (found := STEP_NAME_RE.match(line)) and found[1] == name]
    assert len(starts) == 1, f"publish.yml names {len(starts)} steps {name!r}, where the case reads exactly one"
    block: list[str] = []
    opened = False
    for line in lines[starts[0] + 1 :]:
        if STEP_NAME_RE.match(line) or (line and not line.startswith("        ")):
            break
        if opened:
            block.append(line.removeprefix("          "))
        opened = opened or RUN_BLOCK_RE.match(line) is not None
    text = "\n".join(block).strip("\n") + "\n"
    # An expression would reach the runner substituted and this case unsubstituted.
    assert "${{" not in text, f"{name!r} interpolates an expression into its script"
    return text


@dataclass(frozen=True)
class StepCase:
    step: str
    name: str
    code: int
    says: str


STEP_CASES: Final[tuple[StepCase, ...]] = (
    StepCase(CHECK_STEP, "clean", 0, ""),
    StepCase(CHECK_STEP, "instrumentation_missing", 1, "has no .next/server/instrumentation.js"),
    StepCase(CHECK_STEP, "instrumentation_unreadable", 3, "would not run (exit 125)"),
    StepCase(CHECK_STEP, "user_root", 1, "runs as uid 0"),
    StepCase(CHECK_STEP, "user_unreadable", 3, "its runtime user was never read"),
    # The last of the three, so a step stopping early fails here first.
    StepCase(CHECK_STEP, "context_breach", 1, "/app/planted"),
    StepCase(CHECK_STEP, "context_unreadable", 3, "its context was never read"),
    StepCase(SAME_STEP, "clean", 0, ""),
    StepCase(SAME_STEP, "pushed_other", 1, "::error title=Publish::"),
)


def test_the_publish_workflow_checks_and_compares_the_images_it_pushes() -> None:
    """A publish pushing past a failed assertion, or moving `:latest` onto a rebuild, turns nothing else red."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    workflow = PUBLISH.read_text(encoding="utf-8")
    job_env = dict(JOB_ENV_RE.findall(workflow))
    assert set(job_env) == {"FRONTEND_IMAGE", "BACKEND_IMAGE", "FRONTEND_CHECKED", "BACKEND_CHECKED"}, job_env
    wrong: list[str] = []
    for case in STEP_CASES:
        environment = {**base_env(), **job_env, CASE_VAR: case.name, "FRONTEND_DIGEST": "sha256:f", "BACKEND_DIGEST": "sha256:b"}
        with tempfile.TemporaryDirectory() as scratch:
            script = write_shell(Path(scratch) / "step.sh", RUNNER_SHELL + _run_block(workflow, case.step))
            # The repository root, where the runner's checkout leaves a step.
            done = run_shell(BASH, script, env=_stubbed(scratch, environment), cwd=REPO_ROOT)
        output = done.stdout + done.stderr
        if done.returncode != case.code:
            wrong.append(f"{case.step} / {case.name}: exited {done.returncode}, owed {case.code}\n{output}")
        if case.says not in output:
            wrong.append(f"{case.step} / {case.name}: nothing it printed says {case.says!r}")
    assert not wrong, "\n".join(wrong)
