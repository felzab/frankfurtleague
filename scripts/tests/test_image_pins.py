"""SCRIPTS · every image this repository does not build is named by tag and digest (`docs/ops/spec.md` §1.1).

A tag alone is a pointer its publisher can move, and no build or pull says when it has. Nothing
else reads the pin form: a reference losing its digest in a hand edit, or a service added without
one, builds and deploys as before, from an image no pull request reviewed.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Final

REPO_ROOT: Final = Path(__file__).resolve().parents[2]
DOCKERFILES: Final = (REPO_ROOT / "fl_frontend" / "Dockerfile", REPO_ROOT / "fl_backend" / "Dockerfile")
COMPOSE_FILES: Final = (REPO_ROOT / "docker-compose.yml", REPO_ROOT / "docker-compose.local.yml")

FROM_RE: Final = re.compile(r"^FROM (\S+)(?: AS (\S+))?$", re.MULTILINE)
IMAGE_RE: Final = re.compile(r"^ +image: (.+)$", re.MULTILINE)
# A name, a tag, and the registry's digest for it: the tag for the bot to compare, the digest for the pull.
PINNED_RE: Final = re.compile(r"^[a-z0-9./-]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$")
# This repository's own images, which `publish.yml` re-tags and `deploy.sh` pulls by `:latest`.
OWN_IMAGE_RE: Final = re.compile(r"^ghcr\.io/felzab/frankfurtleague-(?:frontend|backend):latest$")
# The local stack's override clearing an image the production file names.
CLEARED: Final = "!reset null"


def external_references() -> list[tuple[str, str]]:
    """Every image a Dockerfile builds from or a compose file names, its file beside it, stages and own images apart."""
    found: list[tuple[str, str]] = []
    for dockerfile in DOCKERFILES:
        stages: set[str] = set()
        for image, stage in FROM_RE.findall(dockerfile.read_text(encoding="utf-8")):
            if image not in stages:
                found.append((dockerfile.relative_to(REPO_ROOT).as_posix(), image))
            if stage:
                stages.add(stage)
    for compose in COMPOSE_FILES:
        for image in IMAGE_RE.findall(compose.read_text(encoding="utf-8")):
            if image.strip() != CLEARED and not OWN_IMAGE_RE.match(image.strip()):
                found.append((compose.relative_to(REPO_ROOT).as_posix(), image.strip()))
    return found


def test_every_external_image_is_pinned_by_tag_and_digest() -> None:
    """A reference without its digest pulls whatever its tag names on the day, and nothing else notices."""
    references = external_references() + [(path, image) for path, (_, image) in script_references().items()]
    # Two Dockerfiles each build from at least one image, and production names two it does not build.
    assert len(references) >= 4, f"only {references} were read: a reader went inert"
    unpinned = [f"{path}: {image}" for path, image in references if not PINNED_RE.match(image)]
    assert unpinned == [], "not pinned by tag and digest:\n" + "\n".join(unpinned)


# The images a script runs rather than a manifest names: no Dependabot ecosystem reads a shell
# string, so these are the ones a hand edit alone keeps. Each name must be found where it is listed.
SCRIPT_IMAGES: Final = {
    "scripts/gate/selfcheck.sh:shellcheck": ("scripts/gate/selfcheck.sh", "koalaman/shellcheck"),
    "scripts/gate/selfcheck.sh:actionlint": ("scripts/gate/selfcheck.sh", "rhysd/actionlint"),
    "scripts/ops/local.sh:mongo": ("scripts/ops/local.sh", "mongo"),
}
ASSIGNMENT_RE: Final = re.compile(r'^([A-Z_]+)="([^"$]*)"$', re.MULTILINE)
REFERENCE_RE: Final = r"(?<![\w/]){name}:[^\s\"']+"


def _filled(reference: str, values: dict[str, str]) -> str:
    """`reference` with each `${NAME}` it holds replaced by that name's value, an unknown name left standing."""
    return re.sub(r"\$\{([A-Z_]+)\}", lambda part: values.get(part[1], part[0]), reference)


def script_references() -> dict[str, tuple[str, str]]:
    """Each script image, its `${NAME}` parts filled from the script's own top-level assignments."""
    found: dict[str, tuple[str, str]] = {}
    for key, (relative, name) in SCRIPT_IMAGES.items():
        text = (REPO_ROOT / relative).read_text(encoding="utf-8")
        spelled = set(re.findall(REFERENCE_RE.format(name=re.escape(name)), text))
        assert len(spelled) == 1, f"{relative} spells {name} as {sorted(spelled)}, where the case reads exactly one"
        found[key] = (relative, _filled(spelled.pop(), dict(ASSIGNMENT_RE.findall(text))))
    return found


def test_the_copy_of_the_local_database_runs_the_local_stack_s_mongo() -> None:
    """A dump taken by one build and restored into another is the version skew the digest exists to remove."""
    stack = [image for path, image in external_references() if path == "docker-compose.local.yml" and image.startswith("mongo:")]
    _, dump = script_references()["scripts/ops/local.sh:mongo"]

    assert len(stack) == 1, f"docker-compose.local.yml names mongo {stack}, where the case reads exactly one"
    assert dump == stack[0], f"scripts/ops/local.sh copies with {dump}, and the local stack runs {stack[0]}"
