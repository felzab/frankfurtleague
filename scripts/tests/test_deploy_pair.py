"""SCRIPTS · `scripts/ops/deploy.sh :: compare_pulled_pair`, the one check that the two pulled images are one build.

Nothing downstream sees a mismatched pair: each service is healthy against its own half. So each of
the comparison's endings is driven here, `:: published_tag` and `:: put_latest_back` lifted beside
it and a stand-in `docker` answering the label and recording each re-tag, rather than read.

Invariants:
  Every case runs with no daemon: the stand-in answers `image inspect` and `tag` and nothing else.
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
if [[ "${1:-}" == "tag" ]]; then
  printf '%s %s\\n' "$2" "$3" >> "${FL_PAIR_TAGS}"
  exit "${FL_PAIR_TAG_RC:-0}"
fi
[[ "${1:-} ${2:-}" == "image inspect" ]] || { echo "stand-in docker: unexpected $*" >&2; exit 9; }
last=""
for arg in "$@"; do last="$arg"; done
case ":${FL_PAIR_INSPECT_FAILS:-}:" in *":${last}:"*) exit 1 ;; esac
var="FL_PAIR_LABEL_${last}"
printf '%s\\n' "${!var:-<no value>}"
"""

# What a bare run read `:latest` naming before its pull, which a refused pair is put back to.
BEFORE: Final = {"LATEST_BEFORE_FE": "id-frontend-before", "LATEST_BEFORE_BE": "id-backend-before"}
PUT_BACK: Final = ["id-frontend-before ghcr.io/x/frontend:latest", "id-backend-before ghcr.io/x/backend:latest"]


def _run(
    frontend: str, backend: str, pin: str = "", fails: str = "", before: dict[str, str] | None = None, tag_rc: str = "0"
) -> tuple[int, str, list[str]]:
    """The lifted comparison over two images labelled `frontend` and `backend` ('' for none), and the re-tags it made."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    before = before or {}
    root = new_root("fl-deploy-pair-")
    stubs = root / "stubs"
    stubs.mkdir()
    os.chmod(write_shell(stubs / "docker", STUB), 0o755)
    tags = root / "tags.txt"
    environment = base_env()
    environment["PATH"] = str(stubs) + os.pathsep + environment["PATH"]
    environment["FL_PAIR_TAGS"] = tags.as_posix()
    if frontend:
        environment["FL_PAIR_LABEL_fe"] = frontend
    if backend:
        environment["FL_PAIR_LABEL_be"] = backend
    environment["FL_PAIR_INSPECT_FAILS"] = fails
    environment["FL_PAIR_TAG_RC"] = tag_rc
    lines = (
        "#!/usr/bin/env bash",
        f'source "{LIB.as_posix()}"',
        "IMAGE_FRONTEND=ghcr.io/x/frontend:latest",
        "IMAGE_BACKEND=ghcr.io/x/backend:latest",
        f'PIN="{pin}"',
        *(f'{name}="{before.get(name, "")}"' for name in ("LATEST_BEFORE_FE", "LATEST_BEFORE_BE")),
        f"LATEST_BEFORE_RC={before.get('LATEST_BEFORE_RC', '0')}",
        lift_function(DEPLOY, "published_tag"),
        lift_function(DEPLOY, "put_latest_back"),
        lift_function(DEPLOY, "compare_pulled_pair"),
        "compare_pulled_pair fe be",
        'echo "the pair was accepted"',
        "",
    )
    done = run_shell(BASH, write_shell(root / "parent.sh", "\n".join(lines)), env=environment, cwd=root)
    retagged = tags.read_text(encoding="utf-8").splitlines() if tags.exists() else []
    return done.returncode, done.stdout + done.stderr, retagged


def test_a_matched_latest_pair_is_accepted_and_moves_no_tag() -> None:
    code, output, retagged = _run("sha-abc1234", "sha-abc1234", before=BEFORE)

    assert code == 0, output
    assert "the pair was accepted" in output, output
    assert retagged == [], retagged


def test_an_unlabelled_latest_image_is_refused_with_both_tags_put_back() -> None:
    """Either half, or both: refused at 2 and never passed as unverified, with the way on named.

    Put back because the next `up` of any service recreates the application from whatever `:latest` names.
    """
    for frontend, backend in (("", "sha-abc1234"), ("sha-abc1234", ""), ("", "")):
        code, output, retagged = _run(frontend, backend, before=BEFORE)

        assert code == 2, (frontend, backend, output)
        assert "the pair was accepted" not in output, output
        assert "gh workflow run publish.yml --ref main" in output, output
        assert "./scripts/ops/deploy.sh <tag>" in output, output
        assert retagged == PUT_BACK, retagged


def test_two_different_latest_builds_are_a_finding_naming_the_tag_to_deploy() -> None:
    code, output, retagged = _run("sha-abc1234", "sha-def5678", before=BEFORE)

    assert code == 1, output
    assert "The two :latest tags are different builds" in output, output
    assert "./scripts/ops/deploy.sh sha-def5678" in output, output
    assert retagged == PUT_BACK, retagged


def test_two_different_builds_under_one_pin_are_named_by_the_pin_and_move_no_tag() -> None:
    """A pinned run moves `:latest` only once the pair is accepted, so there is nothing to put back and no `:latest` to blame."""
    code, output, retagged = _run("sha-abc1234", "sha-def5678", pin="sha-abc1234")

    assert code == 1, output
    assert "The two images tagged sha-abc1234 carry different build labels" in output, output
    assert ":latest tags are different builds" not in output, output
    assert retagged == [], retagged


def test_a_label_that_could_not_be_read_is_refused() -> None:
    """A failed read is not an absent label, so a pin does not excuse it either."""
    code, output, _ = _run("sha-abc1234", "sha-abc1234", pin="sha-abc1234", fails="be")

    assert code == 2, output
    assert "could not be read" in output, output


def test_a_label_that_could_not_be_read_on_a_bare_run_puts_both_tags_back() -> None:
    code, output, retagged = _run("sha-abc1234", "sha-abc1234", fails="fe", before=BEFORE)

    assert code == 2, output
    assert retagged == PUT_BACK, retagged


def test_tags_nobody_could_read_before_the_pull_are_named_rather_than_guessed_at() -> None:
    code, output, retagged = _run("", "sha-abc1234", before={**BEFORE, "LATEST_BEFORE_RC": "1"})

    assert code == 2, output
    assert "cannot be put back" in output, output
    assert retagged == [], retagged


def test_a_put_back_that_fails_says_the_pair_may_be_the_refused_one() -> None:
    code, output, _ = _run("", "sha-abc1234", before=BEFORE, tag_rc="1")

    assert code == 2, output
    assert "could not both be put back" in output, output


def test_a_pinned_pair_passes_without_a_label() -> None:
    """Both images came from the one tag, which is how an older unlabelled build stays a rollback target."""
    code, output, _ = _run("", "", pin="sha-abc1234")

    assert code == 0, output
    assert "which names the pair" in output, output
    assert "the pair was accepted" in output, output


def test_a_pinned_run_judges_the_pair_before_it_moves_either_tag() -> None:
    text = DEPLOY.read_text(encoding="utf-8")
    judged = text.index('compare_pulled_pair "${REPO_FRONTEND}:${PIN}" "${REPO_BACKEND}:${PIN}"')

    assert judged < text.index('quietly docker tag "${REPO_FRONTEND}:${PIN}" "$IMAGE_FRONTEND"'), (
        "a pinned run moves :latest before judging the pair"
    )
