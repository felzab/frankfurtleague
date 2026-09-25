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
    references = external_references()
    # Two Dockerfiles each build from at least one image, and production names two it does not build.
    assert len(references) >= 4, f"only {references} were read: a reader went inert"
    unpinned = [f"{path}: {image}" for path, image in references if not PINNED_RE.match(image)]
    assert unpinned == [], "not pinned by tag and digest:\n" + "\n".join(unpinned)
