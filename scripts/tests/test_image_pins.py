"""SCRIPTS · every image this repository does not build is pinned by tag and digest, and the versions no tool compares agree.

What it compares: every image both Dockerfiles, both compose files and the listed scripts name, against the pin form; both
database test tiers' mongo against the local stack's; and each image's toolchain against the one the checkout and CI run,
the frontend's Node against `devEngines` and the lockfile, the backend's Python against `.python-version`'s series and
its uv against CI's. Each pair drifts in silence: a tag alone is a pointer its publisher can move, a hand edit can drop a
digest, and Dependabot moves each file's pin on its own, so one side ships a version the other never ran.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Final

REPO_ROOT: Final = Path(__file__).resolve().parents[2]
DOCKERFILES: Final = (REPO_ROOT / "fl_frontend" / "Dockerfile", REPO_ROOT / "fl_backend" / "Dockerfile")
COMPOSE_FILES: Final = (REPO_ROOT / "docker-compose.yml", REPO_ROOT / "docker-compose.local.yml")

# Docker reads the instruction and `AS` in any case, and takes flags such as `--platform=` ahead of
# the image, so a reader holding to one spelling passes a reference it never saw.
FROM_RE: Final = re.compile(r"^[ \t]*FROM(?:[ \t]+--\S+)*[ \t]+(\S+)(?:[ \t]+AS[ \t]+(\S+))?[ \t]*$", re.MULTILINE | re.IGNORECASE)
FROM_LINE_RE: Final = re.compile(r"^[ \t]*FROM[ \t]", re.MULTILINE | re.IGNORECASE)
# A plain or a quoted scalar: a value holding `: ` must be quoted to stay YAML.
IMAGE_RE: Final = re.compile(r"""^ +image: (["']?)(.+?)\1[ \t]*$""", re.MULTILINE)
# The two other instructions naming a source by `from`: a stage, or any image, which Docker pulls.
COPY_FROM_RE: Final = re.compile(r"^[ \t]*COPY(?:[ \t]+--\S+)*?[ \t]+--from=(\S+)", re.MULTILINE | re.IGNORECASE)
RUN_MOUNT_RE: Final = re.compile(r"^[ \t]*RUN((?:[ \t]+--\S+)+)", re.MULTILINE | re.IGNORECASE)
# A name, a tag, and the registry's digest for it: the tag for the bot to compare, the digest for the pull.
PINNED_RE: Final = re.compile(r"^[a-z0-9./-]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$")
# This repository's own images, whose tag the deploy hands Compose as `TAG`, which refuses to start without it.
OWN_IMAGE_RE: Final = re.compile(r"^ghcr\.io/felzab/frankfurtleague-(?:frontend|backend):\$\{TAG:\?[^}]+\}$")
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
        for _, image in IMAGE_RE.findall(compose.read_text(encoding="utf-8")):
            if image != CLEARED and not OWN_IMAGE_RE.match(image):
                found.append((compose.relative_to(REPO_ROOT).as_posix(), image))
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
    "scripts/gate/verify.sh:lychee": ("scripts/gate/verify.sh", "lycheeverse/lychee"),
    "fl_backend/tests/conftest.py:mongo": ("fl_backend/tests/conftest.py", "mongo"),
    ".github/workflows/verify.yml:playwright": (".github/workflows/verify.yml", "mcr.microsoft.com/playwright"),
    ".github/workflows/verify.yml:buildkit": (".github/workflows/verify.yml", "moby/buildkit"),
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


def test_the_backend_db_tier_runs_the_local_stack_s_mongo() -> None:
    """Dependabot's compose ecosystem moves the stack alone, and no ecosystem reads the conftest's string.

    The frontend's tier follows through its own case, which holds its image to this pin.
    """
    stack = [image for path, image in external_references() if path == "docker-compose.local.yml" and image.startswith("mongo:")]
    _, tier = script_references()["fl_backend/tests/conftest.py:mongo"]

    assert len(stack) == 1, f"docker-compose.local.yml names mongo {stack}, where the case reads exactly one"
    assert tier == stack[0], f"fl_backend/tests/conftest.py :: MONGO_IMAGE is {tier}, and the local stack runs {stack[0]}"


FRONTEND: Final = REPO_ROOT / "fl_frontend"
BACKEND: Final = REPO_ROOT / "fl_backend"
# Counted by the string naming the image, never by its file or the call it is handed to: a start
# moved into a helper, made under an alias or through another container class runs a server all the same.
UNREAD_DIRS: Final = frozenset({"node_modules", ".next", ".venv", "__pycache__", ".pytest_cache", ".ruff_cache"})
FRONTEND_SUFFIXES: Final = frozenset({".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"})
# A string naming the image: the bare name, a tag, a digest, a registry path ahead of it.
MONGO_LITERAL_RE: Final = re.compile(r"""(["'`])((?:[\w.-]+/)*mongo(?:[:@][^"'`\s]*)?)\1""")


def sources_under(root: Path, suffixes: frozenset[str]) -> list[Path]:
    """Every file under `root` with one of `suffixes`, the installed, built and cached trees aside."""
    found: list[Path] = []
    for directory, dirs, files in os.walk(root):
        dirs[:] = [name for name in dirs if name not in UNREAD_DIRS]
        found += [Path(directory) / name for name in files if Path(name).suffix in suffixes]
    return sorted(found)


def mongo_images(sources: list[Path]) -> list[tuple[str, str]]:
    """Every mongo image named in a string literal of `sources`, each beside its file."""
    return [
        (path.relative_to(REPO_ROOT).as_posix(), match[2])
        for path in sources
        for match in MONGO_LITERAL_RE.finditer(path.read_text(encoding="utf-8"))
    ]


def test_the_frontend_db_tier_names_the_backend_pin() -> None:
    """Another image under the frontend's tier runs its db tests against a server the backend's never meets.

    No ecosystem reads either string, so this case is what holds the two together, digest included.
    """
    _, backend = script_references()["fl_backend/tests/conftest.py:mongo"]
    images = mongo_images(sources_under(FRONTEND, FRONTEND_SUFFIXES))

    # One place, so a second server cannot run another image where no case reads it.
    assert len(images) == 1, f"the frontend names a mongo image at {images}, where the case reads exactly one"
    assert images[0][1] == backend, f"{images[0][0]} names {images[0][1]}, where it is to name `{backend}`"


def test_the_backend_names_its_mongo_image_only_where_its_pin_is_read() -> None:
    """The conftest's pin is the one the stack's case holds, so a second image elsewhere runs unheld."""
    _, pin = script_references()["fl_backend/tests/conftest.py:mongo"]

    assert mongo_images(sources_under(BACKEND, frozenset({".py"}))) == [("fl_backend/tests/conftest.py", pin)]


# --- one version of each tool across CI and the images ---------------------------------------------

BACKEND_TOOLCHAIN: Final = REPO_ROOT / ".github" / "actions" / "backend-toolchain" / "action.yml"
FRONTEND_MANIFEST: Final = REPO_ROOT / "fl_frontend" / "package.json"
FRONTEND_LOCKFILE: Final = REPO_ROOT / "fl_frontend" / "pnpm-lock.yaml"
PYTHON_VERSION_FILE: Final = REPO_ROOT / "fl_backend" / ".python-version"


def _from_tags(dockerfile: Path, image: str) -> list[str]:
    """Every tag a FROM line gives `image` in one Dockerfile, the digest and any variant aside."""
    return [
        found.split("@", 1)[0].split(":", 1)[1].split("-", 1)[0]
        for found, _ in FROM_RE.findall(dockerfile.read_text(encoding="utf-8"))
        if found.startswith(f"{image}:")
    ]


def test_ci_installs_the_uv_the_backend_image_copies_in() -> None:
    """The setup-uv step's `version` and the image's uv stage: fl_backend's `required-version` is a range both must sit inside."""
    pinned = re.findall(r'^\s+version: "([^"]+)"$', BACKEND_TOOLCHAIN.read_text(encoding="utf-8"), re.MULTILINE)
    tags = _from_tags(DOCKERFILES[1], "ghcr.io/astral-sh/uv")
    assert len(pinned) == 1 and tags, f"read setup-uv {pinned} and the image's uv {tags}, where the case reads one of each"
    assert set(tags) == set(pinned), f"CI installs uv {pinned[0]} and fl_backend/Dockerfile copies in {tags}"


def test_devengines_the_lockfile_and_the_frontend_image_name_one_exact_node_release() -> None:
    """The image's Node is the release pnpm installs for the checkout and CI: `devEngines` names one exact release, the lockfile records it."""
    runtime = json.loads(FRONTEND_MANIFEST.read_bytes())["devEngines"]["runtime"]
    # `pnpm/setup` installs from the manifest alone, so a range there resolves afresh on every CI run.
    exact = re.fullmatch(r"\d+\.\d+\.\d+", runtime["version"])
    resolved = set(re.findall(r"^  node@runtime:(\S+?):?$", FRONTEND_LOCKFILE.read_text(encoding="utf-8"), re.MULTILINE))
    tags = _from_tags(DOCKERFILES[0], "node")
    assert runtime["name"] == "node" and exact and resolved and tags, (
        f"read devEngines {runtime}, the lockfile's {resolved} and the image's {tags}, where the case reads one exact release of each"
    )
    assert set(tags) == {runtime["version"]} == resolved, (
        f"devEngines {runtime['version']}, the lockfile's Node {sorted(resolved)}, fl_frontend/Dockerfile {tags}"
    )


def test_the_backend_image_runs_the_python_series_ci_installs() -> None:
    """Every CI job's interpreter comes from the file, production's from the image's tag."""
    series = PYTHON_VERSION_FILE.read_text(encoding="utf-8").strip()
    tags = _from_tags(DOCKERFILES[1], "python")
    assert tags and all(tag == series or tag.startswith(f"{series}.") for tag in tags), (
        f"{series} in fl_backend/.python-version, {tags} in the image"
    )
