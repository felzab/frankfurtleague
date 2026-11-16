"""Every image this repository does not build is pinned by tag and digest, and the versions no tool compares agree.

What it compares: every image the three Dockerfiles, both compose files and the listed scripts name, against the pin
form; both database test tiers against a mongo image of their own, and the backend tier's containers against the
local stack's pin; the gate's scripts against a linter image of their own; and each image's toolchain against the one the checkout and CI run,
the frontend's Node against `devEngines` and the lockfile, the backend's Python against `.python-version`'s series and
its uv against CI's, and the journeys' Playwright image against the lockfile's Playwright. Each pair drifts in silence:
a tag alone is a pointer its publisher can move, a hand edit can drop a digest, and Dependabot moves each file's pin on
its own, so one side ships a version the other never ran.
"""

from __future__ import annotations

import ast
import json
import os
import re
import tomllib
from pathlib import Path
from typing import Final

from conftest import REPO_ROOT

# The third is never built: it is where the gate's linters are pinned, for Dependabot's `docker` ecosystem to move.
TOOLS_FILE: Final = REPO_ROOT / "scripts" / "gate" / "tools.Dockerfile"
DOCKERFILES: Final = (REPO_ROOT / "fl_frontend" / "Dockerfile", REPO_ROOT / "fl_backend" / "Dockerfile", TOOLS_FILE)
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


# The images a workflow's step names in a string rather than a manifest: no Dependabot ecosystem
# reads one, so these are the ones a hand edit alone keeps. Each name must be found where it is listed.
SCRIPT_IMAGES: Final = {
    ".github/workflows/verify.yml:playwright": (".github/workflows/verify.yml", "mcr.microsoft.com/playwright"),
    ".github/workflows/verify.yml:buildkit": (".github/workflows/verify.yml", "moby/buildkit"),
}
REFERENCE_RE: Final = r"(?<![\w/]){name}:[^\s\"']+"


def script_references() -> dict[str, tuple[str, str]]:
    """Each image a workflow's step names, read where `SCRIPT_IMAGES` lists it."""
    found: dict[str, tuple[str, str]] = {}
    for key, (relative, name) in SCRIPT_IMAGES.items():
        text = (REPO_ROOT / relative).read_text(encoding="utf-8")
        spelled = set(re.findall(REFERENCE_RE.format(name=re.escape(name)), text))
        assert len(spelled) == 1, f"{relative} spells {name} as {sorted(spelled)}, where the case reads exactly one"
        found[key] = (relative, spelled.pop())
    return found


FRONTEND: Final = REPO_ROOT / "fl_frontend"
BACKEND: Final = REPO_ROOT / "fl_backend"
UNREAD_DIRS: Final = frozenset({"node_modules", ".next", ".venv", "__pycache__", ".pytest_cache", ".ruff_cache"})
FRONTEND_SUFFIXES: Final = frozenset({".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"})
# The image's name, a registry path allowed ahead of it, and the tag or digest after it that makes a string an image
# reference rather than the local stack's database service, which a host names bare.
MONGO_TAGGED_RE: Final = re.compile(r"""(["'`])((?:[\w.-]+/)*mongo[:@][^"'`\s]+)\1""")
# The backend tier's copy of the local stack's server, read off its one `image:` line.
BACKEND_PIN: Final = "MONGO_IMAGE"


def sources_under(root: Path, suffixes: frozenset[str] | None = None) -> list[Path]:
    """Every file under `root` with one of `suffixes`, or any where None, the installed, built and cached trees aside."""
    found: list[Path] = []
    for directory, dirs, files in os.walk(root):
        dirs[:] = [name for name in dirs if name not in UNREAD_DIRS]
        found += [Path(directory) / name for name in files if suffixes is None or Path(name).suffix in suffixes]
    return sorted(found)


def mongo_images(sources: list[Path]) -> list[tuple[str, str]]:
    """Every mongo image a string of `sources` names, each beside its file."""
    return [
        (path.relative_to(REPO_ROOT).as_posix(), match[2])
        for path in sources
        for match in MONGO_TAGGED_RE.finditer(path.read_text(encoding="utf-8"))
    ]


def test_neither_db_tier_names_a_mongo_image_of_its_own() -> None:
    """Both tiers read the local stack's one `image:` line, the one Dependabot moves, so an image typed here runs unheld.

    Each tier's reader refuses anything but exactly one such line, so the stack's pin is all that is left to hold.
    """
    sources = sources_under(FRONTEND, FRONTEND_SUFFIXES) + sources_under(BACKEND, frozenset({".py"}))

    assert mongo_images(sources) == [], "a mongo image typed outside docker-compose.local.yml"


def _callee(call: ast.Call) -> str:
    """The name a call is made by, a bare one or an attribute's."""
    return call.func.id if isinstance(call.func, ast.Name) else call.func.attr if isinstance(call.func, ast.Attribute) else ""


def _image(call: ast.Call) -> ast.expr | None:
    """The image a container class is handed: testcontainers takes it first, or as `image`."""
    return call.args[0] if call.args else next((keyword.value for keyword in call.keywords if keyword.arg == "image"), None)


def test_every_backend_container_starts_from_the_local_stack_s_pin() -> None:
    """A container class handed any image but the tier's copy of the pin, or none, runs a server no bump proposed.

    Judged at each construction, by the parser: a name held in a variable reaches a container as surely as a string, and
    testcontainers' `MongoDbContainer()` runs `mongo:latest` with no string naming it. The frontend tier's constructions
    are its lint's, which holds each to `localStackMongo()`.
    """
    constructions = [
        (path.relative_to(REPO_ROOT).as_posix(), node)
        for path in sources_under(BACKEND, frozenset({".py"}))
        for node in ast.walk(ast.parse(path.read_bytes(), filename=str(path)))
        if isinstance(node, ast.Call) and _callee(node).endswith("Container")
    ]
    assert constructions, "no container construction was read out of fl_backend: the reader went inert"
    unpinned = [
        f"{path}:{call.lineno}: {ast.unparse(call)}"
        for path, call in constructions
        if not (isinstance(image := _image(call), ast.Name) and image.id == BACKEND_PIN)
    ]
    assert unpinned == [], f"a container started from anything but {BACKEND_PIN}:\n" + "\n".join(unpinned)


# The gate's linters, each pinned in the tools file alone: its stage name is what a caller reads.
GATE_TOOLS: Final = {"shellcheck": "koalaman/shellcheck", "actionlint": "rhysd/actionlint", "lychee": "lycheeverse/lychee"}
# Where a caller of one could type a copy: the gate, the checkers, the operations scripts and CI.
TOOL_CALLERS: Final = (REPO_ROOT / "scripts", REPO_ROOT / ".github")


def test_each_gate_linter_is_pinned_in_the_tools_file_alone() -> None:
    """Dependabot moves the tools file's `FROM` line, so an image a script types beside it runs a release no bump proposed."""
    stages = {stage: image for image, stage in FROM_RE.findall(TOOLS_FILE.read_text(encoding="utf-8"))}
    assert {stage: image.split(":", 1)[0] for stage, image in stages.items()} == GATE_TOOLS, (
        f"{TOOLS_FILE.relative_to(REPO_ROOT).as_posix()} names {stages}, where each caller reads one stage of {sorted(GATE_TOOLS)}"
    )
    # A reference is a name with a tag or a digest after it, which a mention in prose never carries.
    reference = re.compile(rf"(?<![\w/])(?:{'|'.join(map(re.escape, GATE_TOOLS.values()))})[:@][^\s\"'`]*")
    copies = [
        f"{path.relative_to(REPO_ROOT).as_posix()}: {match}"
        for root in TOOL_CALLERS
        for path in sources_under(root)
        if path != TOOLS_FILE
        for match in reference.findall(path.read_text(encoding="utf-8", errors="replace"))
    ]
    assert copies == [], "a gate linter's image typed outside the tools file:\n" + "\n".join(copies)


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


def test_the_journeys_image_carries_the_lockfile_s_playwright() -> None:
    """The image's browsers are the builds one Playwright release finds, so another release fails every journeys leg at launch."""
    _, image = script_references()[".github/workflows/verify.yml:playwright"]
    tag = re.fullmatch(r"v(\d+\.\d+\.\d+)-[a-z]+", _tag(image))
    resolved = set(re.findall(r"^  '@playwright/test@([^']+)':$", FRONTEND_LOCKFILE.read_text(encoding="utf-8"), re.MULTILINE))
    assert tag and len(resolved) == 1, (
        f"read the image's tag {_tag(image)} and the lockfile's {sorted(resolved)}, where the case reads one of each"
    )
    assert {tag[1]} == resolved, f"PLAYWRIGHT_IMAGE carries Playwright {tag[1]}, and fl_frontend/pnpm-lock.yaml resolves {sorted(resolved)}"


def test_the_backend_image_runs_the_python_series_ci_installs() -> None:
    """Every CI job's interpreter comes from the file, production's from the image's tag."""
    series = PYTHON_VERSION_FILE.read_text(encoding="utf-8").strip()
    tags = _from_tags(DOCKERFILES[1], "python")
    assert tags and all(tag == series or tag.startswith(f"{series}.") for tag in tags), (
        f"{series} in fl_backend/.python-version, {tags} in the image"
    )


BACKEND_MANIFEST: Final = REPO_ROOT / "fl_backend" / "pyproject.toml"
SCRIPTS_PYRIGHT: Final = REPO_ROOT / "scripts" / "pyrightconfig.json"


def test_every_python_series_the_checks_read_is_the_file_s() -> None:
    """pyright judges each tree as its pinned Python and ruff targets `requires-python`, so a copy a bump misses checks another series."""
    series = PYTHON_VERSION_FILE.read_text(encoding="utf-8").strip()
    backend = tomllib.loads(BACKEND_MANIFEST.read_text(encoding="utf-8"))
    # JSON with comments, which no parser of the standard library reads: the one key, by its line.
    scripts = re.findall(r'^\s*"pythonVersion": "([^"]*)"\s*,?\s*$', SCRIPTS_PYRIGHT.read_text(encoding="utf-8"), re.MULTILINE)
    copies = {
        "fl_backend/pyproject.toml :: project.requires-python": backend["project"]["requires-python"],
        "fl_backend/pyproject.toml :: tool.pyright.pythonVersion": backend["tool"]["pyright"]["pythonVersion"],
        "scripts/pyrightconfig.json :: pythonVersion": scripts[0] if len(scripts) == 1 else scripts,
    }
    expected = {
        "fl_backend/pyproject.toml :: project.requires-python": f">={series}",
        "fl_backend/pyproject.toml :: tool.pyright.pythonVersion": series,
        "scripts/pyrightconfig.json :: pythonVersion": series,
    }
    assert copies == expected, f"fl_backend/.python-version names {series}"
