"""SCRIPTS · `scripts/ops/deploy.sh :: compare_pulled_pair`, the one check that the two pulled images are one build.

Nothing downstream sees a mismatched pair: each service is healthy against its own half. So each of
the comparison's endings is driven here, `:: published_tag` lifted beside it and a stand-in
`docker` answering the label, rather than read.

Invariants:
  Every case runs with no daemon: the stand-in answers `image inspect` and nothing else.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Final

from conftest import BASH, base_env, lift_function, new_root, run_shell, write_shell

SCRIPTS: Final = Path(__file__).resolve().parent.parent
LIB: Final = SCRIPTS / "lib" / "_lib.sh"
DEPLOY: Final = SCRIPTS / "ops" / "deploy.sh"

# The label each image carries, from the environment; `<no value>` is what `docker image inspect`
# prints for a label the image lacks, and FL_PAIR_INSPECT_FAILS makes the read itself fail.
STUB: Final = """#!/usr/bin/env bash
set -u
[[ "${1:-} ${2:-}" == "image inspect" ]] || { echo "stand-in docker: unexpected $*" >&2; exit 9; }
last=""
for arg in "$@"; do last="$arg"; done
case ":${FL_PAIR_INSPECT_FAILS:-}:" in *":${last}:"*) exit 1 ;; esac
var="FL_PAIR_LABEL_${last}"
printf '%s\\n' "${!var:-<no value>}"
"""


def _run(frontend: str, backend: str, pin: str = "", fails: str = "") -> tuple[int, str]:
    """The lifted comparison over two images labelled `frontend` and `backend` ('' for none)."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root = new_root("fl-deploy-pair-")
    stubs = root / "stubs"
    stubs.mkdir()
    os.chmod(write_shell(stubs / "docker", STUB), 0o755)
    environment = base_env()
    environment["PATH"] = str(stubs) + os.pathsep + environment["PATH"]
    if frontend:
        environment["FL_PAIR_LABEL_fe"] = frontend
    if backend:
        environment["FL_PAIR_LABEL_be"] = backend
    environment["FL_PAIR_INSPECT_FAILS"] = fails
    lines = (
        "#!/usr/bin/env bash",
        f'source "{LIB.as_posix()}"',
        "IMAGE_FRONTEND=fe",
        "IMAGE_BACKEND=be",
        f'PIN="{pin}"',
        lift_function(DEPLOY, "published_tag"),
        lift_function(DEPLOY, "compare_pulled_pair"),
        "compare_pulled_pair",
        'echo "the pair was accepted"',
        "",
    )
    done = run_shell(BASH, write_shell(root / "parent.sh", "\n".join(lines)), env=environment, cwd=root)
    return done.returncode, done.stdout + done.stderr


def test_a_matched_latest_pair_is_accepted() -> None:
    code, output = _run("sha-abc1234", "sha-abc1234")

    assert code == 0, output
    assert "the pair was accepted" in output, output


def test_an_unlabelled_latest_image_is_refused_before_anything_is_recreated() -> None:
    """Either half, or both: refused at 2 and never passed as unverified, with the way on named."""
    for frontend, backend in (("", "sha-abc1234"), ("sha-abc1234", ""), ("", "")):
        code, output = _run(frontend, backend)

        assert code == 2, (frontend, backend, output)
        assert "the pair was accepted" not in output, output
        assert "gh workflow run publish.yml --ref main" in output, output
        assert "./scripts/ops/deploy.sh <tag>" in output, output


def test_two_different_builds_are_a_finding_naming_the_tag_to_deploy() -> None:
    code, output = _run("sha-abc1234", "sha-def5678")

    assert code == 1, output
    assert "./scripts/ops/deploy.sh sha-def5678" in output, output


def test_a_label_that_could_not_be_read_is_refused() -> None:
    """A failed read is not an absent label, so a pin does not excuse it either."""
    code, output = _run("sha-abc1234", "sha-abc1234", pin="sha-abc1234", fails="be")

    assert code == 2, output
    assert "could not be read" in output, output


def test_a_pinned_pair_passes_without_a_label() -> None:
    """Both images came from the one tag, which is how an older unlabelled build stays a rollback target."""
    code, output = _run("", "", pin="sha-abc1234")

    assert code == 0, output
    assert "which names the pair" in output, output
    assert "the pair was accepted" in output, output
