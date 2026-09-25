"""SCRIPTS · every image this repository does not build is named by tag and digest (`docs/ops/spec.md` §1.1).

A tag alone is a pointer its publisher can move, and no build or pull says when it has. Nothing
else reads the pin form: a reference losing its digest in a hand edit, or a service added without
one, builds and deploys as before, from an image no pull request reviewed. The frontend's db tier
is the one reference named by tag alone, for the library reason at its case.
"""

from __future__ import annotations

import re
import subprocess
import sys
import textwrap
from pathlib import Path
from typing import Final

from test_check_gate_budget import job_bodies

REPO_ROOT: Final = Path(__file__).resolve().parents[2]
DOCKERFILES: Final = (REPO_ROOT / "fl_frontend" / "Dockerfile", REPO_ROOT / "fl_backend" / "Dockerfile")
COMPOSE_FILES: Final = (REPO_ROOT / "docker-compose.yml", REPO_ROOT / "docker-compose.local.yml")

# Docker reads the instruction and `AS` in any case, and takes flags such as `--platform=` ahead of
# the image, so a reader holding to one spelling passes a reference it never saw.
FROM_RE: Final = re.compile(r"^[ \t]*FROM(?:[ \t]+--\S+)*[ \t]+(\S+)(?:[ \t]+AS[ \t]+(\S+))?[ \t]*$", re.MULTILINE | re.IGNORECASE)
FROM_LINE_RE: Final = re.compile(r"^[ \t]*FROM[ \t]", re.MULTILINE | re.IGNORECASE)
IMAGE_RE: Final = re.compile(r"^ +image: (.+)$", re.MULTILINE)
# The two other instructions naming a source by `from`: a stage, or any image, which Docker pulls.
COPY_FROM_RE: Final = re.compile(r"^[ \t]*COPY(?:[ \t]+--\S+)*?[ \t]+--from=(\S+)", re.MULTILINE | re.IGNORECASE)
RUN_MOUNT_RE: Final = re.compile(r"^[ \t]*RUN((?:[ \t]+--\S+)+)", re.MULTILINE | re.IGNORECASE)
# A name, a tag, and the registry's digest for it: the tag for the bot to compare, the digest for the pull.
PINNED_RE: Final = re.compile(r"^[a-z0-9./-]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$")
# This repository's own images, which `publish.yml` re-tags and `deploy.sh` pulls by `:latest`.
OWN_IMAGE_RE: Final = re.compile(r"^ghcr\.io/felzab/frankfurtleague-(?:frontend|backend):latest$")
# The local stack's override clearing an image the production file names.
CLEARED: Final = "!reset null"


def dockerfile_images(text: str, name: str) -> list[str]:
    """Every image one Dockerfile takes from: a FROM, a `COPY --from=` or a RUN mount's `from=`, stages apart."""
    parsed = FROM_RE.findall(text)
    assert len(parsed) == len(FROM_LINE_RE.findall(text)), f"{name}: a FROM line this reader does not parse"
    images: list[str] = []
    stages: set[str] = set()
    for image, stage in parsed:
        if image.lower() not in stages:
            images.append(image)
        if stage:
            stages.add(stage.lower())
    mounted = [
        option.removeprefix("from=")
        for flags in RUN_MOUNT_RE.findall(text)
        for mount in re.findall(r"--mount=(\S+)", flags)
        for option in mount.split(",")
        if option.startswith("from=")
    ]
    # A number names a stage by its position, and so does a name a FROM gave.
    images += [source for source in (*COPY_FROM_RE.findall(text), *mounted) if source.lower() not in stages and not source.isdigit()]
    return images


def external_references() -> list[tuple[str, str]]:
    """Every image a Dockerfile builds from or a compose file names, its file beside it, stages and own images apart."""
    found: list[tuple[str, str]] = []
    for dockerfile in DOCKERFILES:
        relative = dockerfile.relative_to(REPO_ROOT).as_posix()
        found += [(relative, image) for image in dockerfile_images(dockerfile.read_text(encoding="utf-8"), dockerfile.name)]
    for compose in COMPOSE_FILES:
        for image in IMAGE_RE.findall(compose.read_text(encoding="utf-8")):
            if image.strip() != CLEARED and not OWN_IMAGE_RE.match(image.strip()):
                found.append((compose.relative_to(REPO_ROOT).as_posix(), image.strip()))
    return found


def test_every_external_image_is_pinned_by_tag_and_digest() -> None:
    """A reference without its digest pulls whatever its tag names on the day, and nothing else notices."""
    references = external_references() + [(path, image) for path, (_, image) in script_references().items()]
    # Per file: a count across files is met by one reader alone while the others read nothing.
    silent = [path.relative_to(REPO_ROOT).as_posix() for path in (*DOCKERFILES, *COMPOSE_FILES)]
    silent = [path for path in silent if path not in {read for read, _ in references}]
    assert not silent, f"no image was read out of {silent}: a reader went inert"
    unpinned = [f"{path}: {image}" for path, image in references if not PINNED_RE.match(image)]
    assert unpinned == [], "not pinned by tag and digest:\n" + "\n".join(unpinned)


# Three numbers, a `v` ahead of them where the project spells one, and a variant after: a tag
# naming a series (`mongo:8`) is a label Dependabot compares against no single release.
EXACT_TAG_RE: Final = re.compile(r"^v?\d+\.\d+\.\d+(?:-[A-Za-z0-9._-]+)?$")


def _tag(image: str) -> str:
    return image.split("@", 1)[0].rsplit(":", 1)[1]


def test_every_external_image_tag_names_an_exact_release() -> None:
    """The digest runs the image and the tag names it to a reader and to the bot, so a series names nothing exact."""
    references = external_references() + [(path, image) for path, (_, image) in script_references().items()]
    loose = [f"{path}: {image}" for path, image in references if not EXACT_TAG_RE.match(_tag(image))]
    assert loose == [], "a tag naming no exact release:\n" + "\n".join(loose)


# The images a script runs rather than a manifest names: no Dependabot ecosystem reads a shell
# string, so these are the ones a hand edit alone keeps. Each name must be found where it is listed.
SCRIPT_IMAGES: Final = {
    "scripts/gate/selfcheck.sh:shellcheck": ("scripts/gate/selfcheck.sh", "koalaman/shellcheck"),
    "scripts/gate/selfcheck.sh:actionlint": ("scripts/gate/selfcheck.sh", "rhysd/actionlint"),
    "scripts/ops/local.sh:mongo": ("scripts/ops/local.sh", "mongo"),
    "fl_backend/tests/conftest.py:mongo": ("fl_backend/tests/conftest.py", "mongo"),
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


# Each instruction naming a source by `from`, against a stage and against an image: the two
# Dockerfiles take from stages alone, so the image arms are driven here.
PLANTED_DOCKERFILE: Final = """FROM node:26@sha256:{digest} AS base
FROM base AS builder
COPY --from=builder /app /app
COPY --chown=1:1 --from=busybox:1.36 /bin/sh /bin/sh
RUN --mount=type=cache,target=/cache true
RUN --mount=type=bind,from=alpine:3.22,target=/x --mount=type=cache,from=base,target=/y true
COPY --from=0 /a /a
""".format(digest="0" * 64)


def test_an_image_a_copy_or_a_mount_takes_from_is_read_beside_a_stage() -> None:
    """A stage is the file's own, and any other source is an image Docker pulls."""
    assert dockerfile_images(PLANTED_DOCKERFILE, "planted") == [f"node:26@sha256:{'0' * 64}", "busybox:1.36", "alpine:3.22"]


# The Control API's first release (`docs/ops/spec.md` §1.2): the edge's command passes `-l`, which an
# older nginx refuses, and it never starts.
CONTROL_API_FLOOR: Final = (1, 31, 5)
EXACT_RELEASE_RE: Final = re.compile(r"^nginx:(\d+)\.(\d+)\.(\d+)\b")


def test_the_edge_s_nginx_is_a_release_with_the_control_api() -> None:
    """Read off the tag, which names the release an update is compared against; the digest runs it."""
    edge = [image for path, image in external_references() if path == "docker-compose.yml" and image.startswith("nginx:")]
    assert len(edge) == 1, f"docker-compose.yml names nginx {edge}, where the case reads exactly one"
    release = EXACT_RELEASE_RE.match(edge[0])
    assert release, f"{edge[0]} names no exact release, so no floor can be held to it"
    assert tuple(int(part) for part in release.groups()) >= CONTROL_API_FLOOR, f"{edge[0]} predates the Control API's 1.31.5"


# The one reference with no digest: testcontainers-node's `ImageName` keeps a digest as its tag
# (`testcontainers/build/container-runtime/image-name.js`), so `MongoDBContainer.isV5OrLater` reads
# no version and waits on the `mongo` shell MongoDB 8 does not ship.
FRONTEND_SOURCE: Final = REPO_ROOT / "fl_frontend" / "src"
DB_TIER_FILE_RE: Final = re.compile(r"\.db\.test\.[cm]?[jt]sx?$")
CONTAINER_CALL_RE: Final = re.compile(r"\bMongoDBContainer\(")
CONTAINER_IMAGE_RE: Final = re.compile(r'\bMongoDBContainer\("([^"]+)"\)')


def test_the_frontend_db_tier_names_the_backend_pin_s_release_by_tag_alone() -> None:
    """A second release under the frontend's tier runs its db tests against a server the backend's never meets."""
    _, backend = script_references()["fl_backend/tests/conftest.py:mongo"]
    release = backend.split("@", 1)[0]
    files = [path for path in sorted(FRONTEND_SOURCE.rglob("*")) if DB_TIER_FILE_RE.search(path.name)]
    started = {path: path.read_text(encoding="utf-8") for path in files}
    started = {path: text for path, text in started.items() if CONTAINER_CALL_RE.search(text)}
    assert started, "no frontend db-tier file starts a MongoDBContainer: this reader went inert"
    wrong = [
        f"{path.relative_to(REPO_ROOT).as_posix()}: {len(CONTAINER_CALL_RE.findall(text))} call(s), images {CONTAINER_IMAGE_RE.findall(text)}"
        for path, text in started.items()
        if CONTAINER_IMAGE_RE.findall(text) != [release] * len(CONTAINER_CALL_RE.findall(text))
    ]
    assert wrong == [], f"each MongoDBContainer is to name `{release}` as a literal:\n" + "\n".join(wrong)


# The db job's pull step reads the pin itself and sits behind `continue-on-error`, so a pin moved
# out of its reader's shape leaves it printing an annotation and pulling nothing, with the job green.
PULL_STEP: Final = "      - name: Pull the mongod image the db tier starts\n"


def test_the_db_job_s_pull_step_reads_the_backend_tier_s_pin() -> None:
    """The step's own script, lifted out of the workflow and run over the real conftest."""
    body = job_bodies((REPO_ROOT / ".github" / "workflows" / "verify.yml").read_text(encoding="utf-8"))["db"]
    assert body.count(PULL_STEP) == 1, "the db job holds no single pull step by this name"
    step = body.split(PULL_STEP, 1)[1]
    script = textwrap.dedent(step.split("python3 -c '", 1)[1].split("' fl_backend/tests/conftest.py", 1)[0])
    conftest = REPO_ROOT / "fl_backend" / "tests" / "conftest.py"
    done = subprocess.run([sys.executable, "-c", script, str(conftest)], capture_output=True, text=True, check=False)
    _, pin = script_references()["fl_backend/tests/conftest.py:mongo"]

    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == pin, f"the pull step read {done.stdout.strip()!r}, where the conftest pins {pin}"


# The builder's whole-context COPY leaves out what `deps` installed from, whose check fails a patch
# newer than the install. The failure needs a cache-hit `deps` layer, which only CI meets.
FRONTEND_DOCKERFILE: Final = REPO_ROOT / "fl_frontend" / "Dockerfile"
STAGE_RE: Final = re.compile(r"^[ \t]*FROM[ \t]+\S+[ \t]+AS[ \t]+(\S+)[ \t]*$", re.MULTILINE | re.IGNORECASE)
COPY_RE: Final = re.compile(r"^[ \t]*COPY[ \t]+(.+?)[ \t]*$", re.MULTILINE | re.IGNORECASE)
EXCLUDE: Final = "--exclude="


def _stages(text: str) -> dict[str, str]:
    """Each named stage's instructions, up to the next FROM."""
    marks = list(STAGE_RE.finditer(text))
    ends = [mark.start() for mark in marks[1:]] + [len(text)]
    return {mark[1].lower(): text[mark.end() : end] for mark, end in zip(marks, ends, strict=True)}


def test_the_builder_leaves_out_every_path_the_deps_stage_installed_from() -> None:
    """Both sets read off the Dockerfile, so a copy added to `deps` or an exclude dropped is named."""
    stages = _stages(FRONTEND_DOCKERFILE.read_text(encoding="utf-8"))
    installed = {token for line in COPY_RE.findall(stages["deps"]) for token in line.split()[:-1] if not token.startswith("--")}
    context = [line.split() for line in COPY_RE.findall(stages["builder"]) if line.split()[-2:] == [".", "."]]
    assert installed, "no COPY was read out of the deps stage: this reader went inert"
    assert len(context) == 1, f"the builder holds {len(context)} whole-context COPY lines, where the case reads exactly one"
    excluded = {token.removeprefix(EXCLUDE) for token in context[0] if token.startswith(EXCLUDE)}

    assert excluded == installed, f"deps installs from {sorted(installed)}; the builder excludes {sorted(excluded)}"
