"""SCRIPTS · the scope mapping's decisions: which scopes a path selects, and what a branch is read from.

`scripts/gate/scope_map.sh` is the one copy of the path-to-scope mapping, and a pull request's CI
jobs run exactly what it emits, so a wrong arm is a scope no job proves.
"""

from __future__ import annotations

import ast
import functools
import itertools
import json
import posixpath
import re
import subprocess
import sys
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from conftest import BASH, REPO_ROOT, configure, copy_scripts, git, new_root, run_shell, write, write_shell

MAPPING: Final = REPO_ROOT / "scripts" / "gate" / "scope_map.sh"
VERIFY: Final = REPO_ROOT / "scripts" / "gate" / "verify.sh"

CONFIG_TS: Final = "fl_frontend/src/core/config.ts"
PYPROJECT: Final = "fl_backend/pyproject.toml"
PYTHON_VERSION: Final = "fl_backend/.python-version"


def _mapped(paths: list[str]) -> dict[str, bool]:
    """`scope_map.sh --stdin` over an explicit list, the mode every path case below asks."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    # Bytes on purpose: text mode writes "\n" as os.linesep, and a CR-suffixed name matches no arm,
    # turning every scope on through the fallback.
    done = subprocess.run(
        [BASH, MAPPING.as_posix(), "--stdin"], cwd=REPO_ROOT, input="\n".join(paths).encode("utf-8"), capture_output=True, check=False
    )
    assert done.returncode == 0, "scripts/gate/scope_map.sh could not be run: " + done.stderr.decode("utf-8", errors="replace")
    return {
        name: value == "true" for name, _, value in (line.partition("=") for line in done.stdout.decode("utf-8").splitlines() if "=" in line)
    }


def _on(answered: dict[str, bool]) -> set[str]:
    return {name for name, selected in answered.items() if selected}


# --- the mapping itself --------------------------------------------------------------------------------

SELECTED: Final[tuple[tuple[str, tuple[str, ...]], ...]] = (
    # Every scope running the virtualenv this file pins, and COPY . . carries it to where the image's
    # uv sync --locked reads it. A job handing it to the step pool alone is held out.
    (PYTHON_VERSION, ("scripts", "docs", "backend", "ops", "db", "images")),
    # scripts/ruff.toml extends this file, and the gate's own ruff and the ops scope's zizmor come out
    # of the venv it pins.
    (PYPROJECT, ("scripts", "images", "backend", "ops", "db", "docs")),
    ("fl_backend/uv.lock", ("scripts", "images", "backend", "ops", "db", "docs")),
    # The ops scope runs it over the real compose files, which nothing in the scripts scope reads.
    ("scripts/checks/check_compose_model.py", ("scripts", "docs", "ops")),
    # The docs gate's line-endings check and its binary-byte exemption both read .gitattributes.
    (".gitattributes", ("scripts", "docs")),
    # .gitignore decides which paths that same gate scans, and which citations it excuses; a
    # frontend suite reads it through a name `_frontend_reaches` cannot follow.
    (".gitignore", ("docs", "frontend")),
    # knip reads the one from a JSON configuration and a frontend suite the other through a name,
    # neither a read `_frontend_reaches` finds.
    (".prettierrc.json", ("format", "frontend")),
    (".prettierignore", ("format", "frontend")),
    # `scripts/gate/selfcheck.sh` compares this file's uv tag against the manifest's pin, and runs
    # in the scripts scope alone; a bot's base-image bump touches this file and nothing else.
    ("fl_backend/Dockerfile", ("images", "docs", "scripts")),
    # The image assertions hold both ignore files' excluded shapes to the ones the context search
    # looks for, and run in the scripts scope.
    ("fl_backend/.dockerignore", ("images", "docs", "scripts")),
    # `scripts/tests/test_check_gate_budget.py` parses this table itself and drives every budgeted
    # row red and green, so an edit to it is proved in the scripts scope and nowhere else.
    (".github/gate-wall-clock.tsv", ("scripts", "docs")),
    # The configuration walk declared in `UNNAMEABLE` reads this file, which no read names.
    ("nginx/prod/prod.conf", ("ops", "docs", "frontend")),
    # The ops scope's zizmor reads the Dependabot configuration, and nothing else in the gate does.
    (".github/dependabot.yml", ("ops", "docs")),
)


def test_a_path_selects_every_scope_that_would_check_it() -> None:
    """A file governing a scope it does not select is a change that runs everything but its own check."""
    missed: list[str] = []
    for path, wanted in SELECTED:
        answered = _mapped([path])
        missed += [path + " selected no " + name for name in wanted if not answered.get(name)]
    assert not missed, "\n".join(missed)


# One arm's patterns: a line's text up to the `)` closing them, continuation lines joined first.
ARM_PATTERNS_RE: Final = re.compile(r"^[ \t]*([^\s#()][^()\n]*)\)", re.MULTILINE)
GLOB_CHARACTERS: Final = frozenset("*?[")


def _arm_paths(mapping: Path) -> list[str]:
    """Every glob-free pattern of the path arms, read out of the second `case` the mapping opens."""
    text = mapping.read_text(encoding="utf-8")
    first = text.index('case "$f" in')
    body = text[text.index('case "$f" in', first + 1) :]
    body = body[: body.index("\n    esac")].replace("\\\n", " ")
    patterns = (pattern.strip() for arm in ARM_PATTERNS_RE.findall(body) for pattern in arm.split("|"))
    return sorted(pattern for pattern in patterns if pattern and not GLOB_CHARACTERS & set(pattern))


def test_every_path_an_arm_or_the_table_names_exists() -> None:
    """A renamed file leaves its arm and its row green, each asking about a path no change can touch.

    Globs are left out, a pattern rather than a path; the floor keeps an arm reader gone inert from passing.
    """
    named = _arm_paths(MAPPING)
    assert len(named) > len(SELECTED), f"only {named} were read out of the mapping's arms: that reader went inert"
    gone = [path for path in (*named, *(path for path, _ in SELECTED)) if not (REPO_ROOT / path).exists()]
    assert not gone, "these name no file in the tree:\n" + "\n".join(sorted(set(gone)))


def test_the_notice_file_selects_its_two_readers_scopes_and_nothing_else() -> None:
    """The derived reads ask for `frontend` alone, and the documentation gate reads the file too.

    An arm that stopped matching would turn every scope on through the conservative default, and
    only a set comparison catches that.
    """
    assert _on(_mapped(["NOTICE"])) == {"docs", "frontend"}


def test_the_hook_registrations_select_the_scripts_scope() -> None:
    """The self-check looks for each script this file registers; `format` rides along, the file being prettier's."""
    assert _on(_mapped([".claude/settings.json"])) == {"scripts", "docs", "format"}


def test_the_wall_clock_table_selects_the_scripts_scope_and_stops_there() -> None:
    """`SELECTED` reads its scopes as a subset, so its row here passes with every scope left true.

    Only a set comparison catches the arm widening to the conservative default the fallback gives.
    """
    assert _on(_mapped([".github/gate-wall-clock.tsv"])) == {"scripts", "docs"}


def test_the_packaging_files_stop_short_of_the_application_scopes() -> None:
    """`SELECTED` reads its scopes as a subset, so a packaging arm widened to a suite tier passes it.

    Only a set comparison holds each of the four to the build, its comments and the scripts suites reading it.
    """
    for path in ("fl_frontend/Dockerfile", "fl_frontend/.dockerignore", "fl_backend/Dockerfile", "fl_backend/.dockerignore"):
        assert _on(_mapped([path])) == {"images", "docs", "scripts"}, path


def test_a_module_the_other_package_reads_selects_that_package_s_scopes() -> None:
    """A set comparison rather than a `SELECTED` row, whose scopes are read as a subset.

    An arm widened to `images` would build both images for every pull request touching it; one
    below its own package's arm is shadowed.
    """
    read_by_a_frontend_suite = {"backend", "db", "frontend", "docs"}
    for path, expected in (
        ("fl_backend/app/core/recording.py", read_by_a_frontend_suite),
        ("fl_backend/app/shared/schemas/custom.py", read_by_a_frontend_suite),
        ("fl_backend/app/api/bewerbungen/admin_router.py", read_by_a_frontend_suite),
        ("fl_backend/app/api/bewerbungen/services.py", read_by_a_frontend_suite),
        ("fl_backend/app/api/saisons/schemas.py", read_by_a_frontend_suite),
        ("fl_backend/app/api/saisons/services.py", read_by_a_frontend_suite),
    ):
        assert _on(_mapped([path])) == expected, path


def _mapping_for_base(root: Path, base: str) -> dict[str, bool]:
    """`scope_map.sh` in its base-ref mode, the one CI runs and no case above reaches."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    done = run_shell(BASH, root / "scripts" / "gate" / "scope_map.sh", base, cwd=root)
    assert done.returncode == 0, "scope_map.sh refused the base ref: " + done.stderr
    return {name: value == "true" for name, _, value in (line.partition("=") for line in done.stdout.splitlines() if "=" in line)}


def test_the_base_ref_mode_reads_a_rename_by_both_of_its_paths() -> None:
    """A detected rename is one filepair printing the DESTINATION alone, and the scopes go with the source.

    `config.ts` selects the image build and `settings.ts` does not, so without `--no-renames` the
    recipe moves and CI proves nothing about it.
    """
    root = new_root("scope-base-ref-")
    copy_scripts(root / "scripts")
    write(root, CONFIG_TS, "export const total = 3;\n")
    configure(root, str(root / ".no-hooks"))
    git(root, "add", "-A")
    git(root, "commit", "--no-verify", "-m", "Frontend: the environment module")
    git(root, "mv", CONFIG_TS, "fl_frontend/src/core/settings.ts")
    git(root, "commit", "--no-verify", "-m", "Frontend: the environment module is renamed")
    answered = _mapping_for_base(root, "HEAD~1")
    assert answered.get("images"), "a renamed image path asked for no image build: " + repr(answered)


# A scope's name as `verify.sh` spells it, hyphen included: a class stopping at one reads
# `frontend-units` as `frontend`, a name the mapping does emit.
SCOPE_NAME: Final = r"[a-z][a-z-]*"

# Declared by `verify.sh` and emitted by no arm: CI runs its shards wherever the frontend job runs
# (`docs/ops/spec.md` §1.6).
UNMAPPED_SCOPES: Final = frozenset({"frontend-units"})


def test_the_two_lists_of_scope_names_agree() -> None:
    """A scope the mapping emits and verify.sh takes no flag for is a CI job with nothing to run.

    The option parser's arms are read beside `add_scope`, being what a job's `--<scope>` reaches.
    """
    gate = VERIFY.read_text(encoding="utf-8")
    declared = set(re.findall(rf"^add_scope\s+({SCOPE_NAME})", gate, flags=re.MULTILINE))
    flags = set(re.findall(rf"^\s+--({SCOPE_NAME})\)", gate, flags=re.MULTILINE))
    emitted = set(_mapped([]))
    assert declared, "no add_scope line was read out of scripts/gate/verify.sh: that reader went inert"
    assert flags, "no option arm was read out of scripts/gate/verify.sh: that reader went inert"
    assert emitted <= declared & flags, f"emitted with no scope and flag in verify.sh: {sorted(emitted - (declared & flags))}"
    assert declared - emitted == UNMAPPED_SCOPES, f"declared by verify.sh and emitted by no arm: {sorted(declared - emitted)}"


def test_a_push_to_main_turns_every_scope_on() -> None:
    """`--all` is the mode `.github/workflows/verify.yml` runs for every push to main, and no other case runs it.

    The mapping prints every scope it knows on every run, so one it gains and `all` leaves off comes out false here.
    """
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    done = run_shell(BASH, MAPPING, "--all", cwd=REPO_ROOT)
    assert done.returncode == 0, "scope_map.sh --all could not be run: " + done.stderr
    answered = {name: value for name, _, value in (line.partition("=") for line in done.stdout.splitlines() if "=" in line)}
    assert answered, "scope_map.sh --all printed no scope at all"
    assert [name for name, value in answered.items() if value != "true"] == [], "scope_map.sh --all left these scopes off"


# --- the arms that reach across the package boundary -------------------------------------------------

FRONTEND: Final = "fl_frontend"
BACKEND: Final = "fl_backend"

# A path in one package must select the scope the OTHER package's suites run in. `db` is emitted
# wherever `backend` is, so `backend` answers for that pair.
FAR_SCOPE: Final[dict[str, str]] = {BACKEND: "frontend", FRONTEND: "backend"}
# What a read owes, by the package its reader sits in: a suite reading a file outside its package
# waits for the push to main unless that file selects the scope the suite runs in.
OWN_SCOPE: Final[dict[str, str]] = {FRONTEND: "frontend", BACKEND: "backend"}

# How each language spells a path out of its package. TypeScript hands `path.resolve` one segment per
# argument, so the entry a path leaves by is a whole segment; python joins a `Path` with `/`.
TS_CALL: Final = re.compile(r"path\.(?:resolve|join)\([^()]*\)")
# A run of quoted arguments, which a variable between two of them parts.
TS_RUN: Final = re.compile(r'"[^"\\\n]+"(?:\s*,\s*"[^"\\\n]+")*')
TS_QUOTED: Final = re.compile(r'"([^"\\\n]+)"')

# Every shell token that could be a path. WHICH of them the mapping carries across is settled by
# running it below, so a token this misses narrows that question and can raise no finding of its own.
SHELL_TOKEN: Final = re.compile(r"[A-Za-z0-9_./-]+")

# An arm matches a path, so a suite walking a whole tree can be carried by none. Declared rather
# than derived: what a new row owes the mapping is a judgement, and a row here is that question.
UNNAMEABLE: Final[tuple[tuple[str, str], ...]] = (
    ("fl_backend/tests/shared/test_frontend_mirrors.py", "fl_frontend/src"),
    # Every configuration it finds, which the `nginx/*.conf` arm carries (`SELECTED`).
    ("fl_frontend/src/features/bewerbungen/publicRoutes.test.ts", "nginx"),
)


@dataclass(frozen=True)
class Crossings:
    """Each key below is a path a package reads from outside itself: the other package, or the root's own files."""

    reads: dict[str, set[str]]
    # A module against the TREE it reaches into, no file in it being named.
    reaches: set[tuple[str, str]]
    declared: set[str]
    # `declared` and every read alike, so a derived path is never missing here.
    selected: dict[str, set[str]]


def _file_or_tree(root: Path, reader: str, path: str, package: str, reads: dict[str, set[str]], reaches: set[tuple[str, str]]) -> None:
    """One reach filed by what an arm could match: the file it names, or the tree it reaches into."""
    if path and (root / path).is_file():
        reads.setdefault(path, set()).add(reader)
    elif path and (root / path).is_dir():
        reaches.add((reader, path))
    else:
        # A path composed at run time, or one spelled in a shape this reader could not resolve: its
        # directory part is as much as any arm could be held to.
        reaches.add((reader, path.rsplit("/", 1)[0] if "/" in path else package))


def _widest(reaches: set[tuple[str, str]]) -> set[tuple[str, str]]:
    """One module's reach inside another reach of its own, dropped: the wider one already covers it."""
    return {
        (reader, prefix)
        for reader, prefix in reaches
        if not any(other == reader and prefix.startswith(wider + "/") for other, wider in reaches)
    }


def _leaves_by(call: str, outside: set[str]) -> tuple[str, list[str]] | None:
    """The top-level entry one path call leaves the frontend by, and the quoted segments from it on.

    The first segment past the climb decides: one naming anything but a top-level entry stays in
    the package.
    """
    for run in TS_RUN.findall(call):
        segments = list(itertools.dropwhile(lambda segment: segment == "..", TS_QUOTED.findall(run)))
        if segments:
            entry = segments[0].split("/")[0]
            return (entry, segments) if entry in outside else None
    return None


def _frontend_reaches(root: Path, files: list[str]) -> tuple[dict[str, set[str]], set[tuple[str, str]]]:
    """Every path outside the frontend a frontend module builds, and every reach placing no file.

    A path call, never a mention: a comment citing a backend module is prose. Blind to a path held
    in a variable.
    """
    outside = {entry.name for entry in root.iterdir()} - {FRONTEND, ".git"}
    reads: dict[str, set[str]] = {}
    reaches: set[tuple[str, str]] = set()
    for rel in files:
        for call in TS_CALL.findall((root / rel).read_text(encoding="utf-8")):
            if (left := _leaves_by(call, outside)) is None:
                continue
            entry, segments = left
            # A segment carrying a slash is a spelling this reader does not place, so the entry is as
            # much as an arm could be held to.
            path = "" if "/" in segments[0] else "/".join(segments)
            _file_or_tree(root, rel, path, entry, reads, reaches)
    return reads, _widest(reaches)


def _divided(node: ast.expr) -> list[ast.expr]:
    """One `root / "a" / "b"` chain flattened, leftmost operand first."""
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
        return [*_divided(node.left), node.right]
    return [node]


def _literal(node: ast.expr) -> str | None:
    """One path segment as its source fixes it -- a string, or the fixed opening of an f-string."""
    if isinstance(node, ast.Constant):
        return node.value if isinstance(node.value, str) else None
    if isinstance(node, ast.JoinedStr) and node.values:
        return _literal(node.values[0])
    return None


def _segments(node: ast.expr, bound: dict[str, tuple[list[str], ast.expr]]) -> list[str]:
    """The literal path one `/` chain fixes.

    A leading name is followed rather than read as an opaque operand: a module that names the package
    once and then divides that binding reads a tree where it reads a file.
    """
    segments: list[str] = []
    for part in _divided(node):
        followed = bound.get(part.id) if isinstance(part, ast.Name) else None
        if followed is not None:
            if segments:
                break
            segments.extend(followed[0])
            continue
        literal = _literal(part)
        opens = literal is not None and (literal == FRONTEND or literal.startswith(FRONTEND + "/"))
        if literal is None or (not segments and not opens):
            if segments:
                break
            continue
        segments.append(literal)
    return segments


def _bindings(tree: ast.Module) -> dict[str, tuple[list[str], ast.expr]]:
    """Each name a module binds to a bare `/` chain, and that chain.

    The chain travels because a binding filed as a reach of its own would spare every file under it
    from `scripts/tests/test_scope_decisions.py :: _stale`.
    """
    bound: dict[str, tuple[list[str], ast.expr]] = {}
    for node in ast.walk(tree):
        targets = [node.target] if isinstance(node, ast.AnnAssign) else node.targets if isinstance(node, ast.Assign) else []
        value = node.value if isinstance(node, ast.AnnAssign | ast.Assign) else None
        if value is None or not isinstance(value, ast.BinOp) or not isinstance(value.op, ast.Div):
            continue
        if segments := _segments(value, bound):
            bound.update({target.id: (segments, value) for target in targets if isinstance(target, ast.Name)})
    return bound


def _backend_reaches(root: Path, files: list[str]) -> tuple[dict[str, set[str]], set[tuple[str, str]]]:
    """Every frontend path a backend module builds, and every reach that resolves to no file.

    A `/` chain rather than any string naming the package: a docstring citing a frontend module is
    prose.
    """
    reads: dict[str, set[str]] = {}
    reaches: set[tuple[str, str]] = set()
    for rel in files:
        text = (root / rel).read_text(encoding="utf-8")
        if FRONTEND not in text:
            continue
        # Named, so a module this suite cannot parse fails saying which one rather than `<unknown>`.
        tree = ast.parse(text, filename=rel)
        bound = _bindings(tree)
        divisions = [node for node in ast.walk(tree) if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div)]
        # A chain's own left operand is a division too, and read on its own it answers for a prefix
        # of the path -- `root / "fl_frontend"` where the chain names a module inside it.
        nested = {node.left for node in divisions}
        divided = [part for division in divisions for part in _divided(division)]
        # A binding nothing divides keeps its own chain filed: dropping it would lose the reach of a
        # module that walks the tree it names through anything but a `/`.
        composed = {chain for name, (_, chain) in bound.items() if any(isinstance(part, ast.Name) and part.id == name for part in divided)}
        for node in (division for division in divisions if division not in nested and division not in composed):
            if segments := _segments(node, bound):
                _file_or_tree(root, rel, "/".join(segments).rstrip("/"), FRONTEND, reads, reaches)
    return reads, _widest(reaches)


def _package_paths(mapping: Path, root: Path) -> set[str]:
    """Every path in either package the mapping names, read by token rather than from its arms.

    WHICH of them it carries across is settled by running it, so parsing the `case` would buy
    nothing and be more fragile.
    """
    return {
        token
        for token in SHELL_TOKEN.findall(mapping.read_text(encoding="utf-8"))
        # A glob arm falls out here, `fl_frontend/*` tokenising to a name no file has: swept in, it
        # would be probed as a path nothing reads.
        if token.startswith((FRONTEND + "/", BACKEND + "/")) and (root / token).is_file()
    }


def _selected(paths: Iterable[str]) -> dict[str, set[str]]:
    """One run of the mapping per path: it answers for a list and says nothing about which member asked for what."""
    ordered = sorted(paths)
    # Concurrent: one `bash` launch per path, in series, outruns the rest of the suite.
    with ThreadPoolExecutor() as pool:
        answers = list(pool.map(lambda path: _mapped([path]), ordered))
    return {path: _on(answered) for path, answered in zip(ordered, answers, strict=True)}


@functools.cache
def _crossings() -> Crossings:
    """This repository's two populations and the arms, read once.

    The mapping and the two packages are read where they live, no fixture holding any of them.
    """
    listing = git(REPO_ROOT, "-c", "core.quotepath=false", "ls-files", "--cached", "--others", "--exclude-standard")
    # A deletion git has not staged yet is listed above and reaches nothing.
    gone = set(git(REPO_ROOT, "-c", "core.quotepath=false", "ls-files", "--deleted").splitlines())
    # Subtracted rather than filtered on `is_file()`, which is False for a path this platform cannot
    # open too: such a module would leave the derived reads and shrink this run, where a read that
    # raises stops it.
    files = [rel for rel in listing.splitlines() if rel not in gone]
    frontend_modules = [rel for rel in files if rel.startswith(FRONTEND + "/") and rel.endswith((".ts", ".tsx", ".mts", ".cts"))]
    backend_modules = [rel for rel in files if rel.startswith(BACKEND + "/") and rel.endswith(".py")]
    reads, reaches = _frontend_reaches(REPO_ROOT, frontend_modules)
    further, more = _backend_reaches(REPO_ROOT, backend_modules)
    for path, readers in further.items():
        reads.setdefault(path, set()).update(readers)
    declared = _package_paths(MAPPING, REPO_ROOT)
    return Crossings(reads, reaches | more, declared, _selected(declared | set(reads)))


def _carried(crossings: Crossings) -> set[str]:
    """Every path the mapping names whose arm selects the scope the other package's suites run in."""
    return {path for path in crossings.declared if FAR_SCOPE[path.split("/")[0]] in crossings.selected[path]}


def _unarmed(crossings: Crossings) -> list[str]:
    """A file read from outside its package that no arm carries across -- the repair is to widen an arm."""
    missing: list[str] = []
    for path, readers in sorted(crossings.reads.items()):
        owed: dict[str, list[str]] = {}
        for reader in sorted(readers):
            owed.setdefault(OWN_SCOPE[reader.split("/")[0]], []).append(reader)
        missing += [
            path + " is read by " + ", ".join(by) + ", and no arm carries it into --" + scope
            for scope, by in sorted(owed.items())
            if scope not in crossings.selected[path]
        ]
    return missing


def _stale(crossings: Crossings) -> list[str]:
    """An arm carrying a file nothing reads, the repair being to narrow that arm.

    A path under a tree the far side walks whole is spared: no arm could be held to a file a walk
    never names.
    """
    walked = tuple(prefix + "/" for _, prefix in crossings.reaches)
    return [
        path + " is carried into --" + FAR_SCOPE[path.split("/")[0]] + ", and nothing there reads it"
        for path in sorted(_carried(crossings) - set(crossings.reads))
        if not path.startswith(walked)
    ]


def test_every_file_the_other_package_reads_is_carried_across_by_an_arm() -> None:
    """The arms are hand-kept lists, and this is what holds each to the reads it exists for.

    Non-emptiness first, and per direction: a set comparison whose derived side came out empty
    passes and guards nothing.
    """
    crossings = _crossings()
    for package, reader in ((BACKEND, "fl_frontend/"), (FRONTEND, "fl_backend/")):
        found = {path for path in crossings.reads if path.startswith(package + "/")}
        assert found, "no file in " + package + " was found read from " + reader + ": that reader went inert"
    beyond = {path for path in crossings.reads if not path.startswith((BACKEND + "/", FRONTEND + "/"))}
    assert beyond, "no file outside both packages was found read from fl_frontend/: that reader went inert"
    assert not (missing := _unarmed(crossings)), "name the path in its arm in scripts/gate/scope_map.sh:\n" + "\n".join(missing)


def test_every_arm_reaching_across_the_boundary_names_a_file_the_other_package_reads() -> None:
    """The other direction of the same equality: an arm carrying a file nothing on the far side reads.

    `test_a_reach_that_names_no_single_file_is_one_this_check_declares` holds the list of walked
    trees that `_stale` spares, which is why this case can rest on it.
    """
    crossings = _crossings()
    # Two inert states, and a reader acts on which: no path read out of the mapping at all, against
    # paths read out of it that no arm carries across.
    assert crossings.declared, "no path in either package was read out of scripts/gate/scope_map.sh: that reader went inert"
    assert _carried(crossings), "no arm in scripts/gate/scope_map.sh was read as reaching across the boundary"
    assert not (stale := _stale(crossings)), "drop the path from its arm in scripts/gate/scope_map.sh:\n" + "\n".join(stale)


def test_a_reach_that_names_no_single_file_is_one_this_check_declares() -> None:
    """What the equality above cannot reach: a suite that walks the far tree.

    Only a person can say what the mapping owes a walk, and every path under one is spared above,
    so this list moving is a failure.
    """
    crossings = _crossings()
    assert crossings.reaches == set(UNNAMEABLE), (
        "the trees one package's suites reach into without naming a file have changed.\n"
        "derived:  " + repr(sorted(crossings.reaches)) + "\ndeclared: " + repr(sorted(UNNAMEABLE))
    )


# --- the files the scripts scope's own suites read ------------------------------------------------------

SCRIPTS_SUITES: Final = "scripts/tests"
# The two spellings of the repository root a suite divides: the name each binds, and the parent of
# the scripts tree where it binds that instead.
ROOT_NAME: Final = "REPO_ROOT"
SCRIPTS_NAME: Final = "SCRIPTS"

# Each `/` chain off the root fixing no single file, by suite and source, against the files outside
# `scripts/` it reaches: empty for a walk no arm could be held to, or for files all under `scripts/`.
UNPLACED_SCRIPT_READS: Final[dict[tuple[str, str], tuple[str, ...]]] = {
    ("test_check_gate_budget.py", "REPO_ROOT / budget.REFERENCE"): (".github/gate-wall-clock.tsv",),
    ("test_deploy_streams.py", "REPO_ROOT / 'fl_backend'"): ("fl_backend/app/__init__.py", "fl_backend/app/core/config.py"),
    ("test_image_assertions.py", "REPO_ROOT / package / '.dockerignore'"): ("fl_frontend/.dockerignore", "fl_backend/.dockerignore"),
    ("test_image_pins.py", "REPO_ROOT / relative"): ("fl_backend/tests/conftest.py",),
    ("test_message_gates.py", "SCRIPTS.parent / commits.ROADMAP_ENTRY_PAGES[0]"): ("docs/_roadmap/items.md",),
    # The trees the documentation standard's Scope line names, walked for the kinds each holds.
    ("test_scope_agreement.py", "REPO_ROOT / tree"): (),
    ("test_scope_agreement.py", "REPO_ROOT / entry"): (),
    # This module's own walks of both packages, over every module in each.
    ("test_scope_decisions.py", "REPO_ROOT / rel"): (),
    ("test_scope_decisions.py", "REPO_ROOT / path"): (),
    ("test_scope_decisions.py", "REPO_ROOT / module"): (),
    ("test_scope_decisions.py", "REPO_ROOT / (base + suffix)"): (),
}


def _string(node: ast.expr, strings: dict[str, str]) -> str | None:
    """One path segment a module fixes: a literal, a string it binds by name, or two of those joined by `+`."""
    if isinstance(node, ast.Constant):
        return node.value if isinstance(node.value, str) else None
    if isinstance(node, ast.Name):
        return strings.get(node.id)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, right = _string(node.left, strings), _string(node.right, strings)
        return left + right if left is not None and right is not None else None
    return None


def _is_root(node: ast.expr) -> bool:
    if isinstance(node, ast.Name):
        return node.id == ROOT_NAME
    return isinstance(node, ast.Attribute) and node.attr == "parent" and isinstance(node.value, ast.Name) and node.value.id == SCRIPTS_NAME


def _anchored(node: ast.expr, strings: dict[str, str], bound: dict[str, str]) -> tuple[str, bool] | None:
    """The path one `/` chain off the root fixes, and whether every segment of it is fixed; None off the root."""
    parts = _divided(node)
    head = parts[0]
    if _is_root(head):
        segments: list[str] = []
    elif isinstance(head, ast.Name) and head.id in bound:
        segments = [bound[head.id]]
    else:
        return None
    for part in parts[1:]:
        if (segment := _string(part, strings)) is None:
            return "/".join(segments), False
        segments.append(segment)
    return "/".join(segments), True


def _bound_names(node: ast.Assign | ast.AnnAssign) -> list[str]:
    return [target.id for target in (node.targets if isinstance(node, ast.Assign) else [node.target]) if isinstance(target, ast.Name)]


def _suite_reads(root: Path, suite: str) -> tuple[set[str], set[str]]:
    """The files outside `scripts/` one suite's chains fix, and the source of every chain off the root fixing none."""
    tree = ast.parse((root / suite).read_text(encoding="utf-8"), filename=suite)
    strings: dict[str, str] = {}
    bound: dict[str, str] = {}
    # By line, so a name reaches only the bindings above it, as the module itself runs them.
    assignments = sorted((node for node in ast.walk(tree) if isinstance(node, ast.Assign | ast.AnnAssign)), key=lambda node: node.lineno)
    for node in assignments:
        if node.value is None:
            continue
        if (text := _string(node.value, strings)) is not None:
            strings.update(dict.fromkeys(_bound_names(node), text))
        elif (fixed := _anchored(node.value, strings, bound)) is not None and fixed[1]:
            bound.update(dict.fromkeys(_bound_names(node), fixed[0]))
    divisions = [node for node in ast.walk(tree) if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div)]
    nested = {node.left for node in divisions}
    # A binding divided further is read through the chains that divide it, never as a tree of its own.
    heads = {parts[0].id for node in divisions if isinstance((parts := _divided(node))[0], ast.Name)}
    through = {node.value for node in assignments if node.value is not None and heads.intersection(_bound_names(node))}
    files: set[str] = set()
    unplaced: set[str] = set()
    for node in divisions:
        if node in nested or node in through or (fixed := _anchored(node, strings, bound)) is None:
            continue
        path, complete = fixed
        if path == "scripts" or path.startswith("scripts/"):
            continue
        if complete and (root / path).is_file():
            files.add(path)
        else:
            unplaced.add(ast.unparse(node))
    return files, unplaced


@functools.cache
def _scripts_reads() -> tuple[dict[str, set[str]], set[tuple[str, str]]]:
    """Every file outside `scripts/` a suite of the scripts scope names, against its suites, and every chain that names none."""
    files: dict[str, set[str]] = {}
    unplaced: set[tuple[str, str]] = set()
    for suite in sorted((REPO_ROOT / SCRIPTS_SUITES).glob("*.py")):
        read, opaque = _suite_reads(REPO_ROOT, suite.relative_to(REPO_ROOT).as_posix())
        for path in read:
            files.setdefault(path, set()).add(suite.name)
        unplaced |= {(suite.name, source) for source in opaque}
    for (suite, _), reached in UNPLACED_SCRIPT_READS.items():
        for path in reached:
            files.setdefault(path, set()).add(suite)
    return files, unplaced


def test_every_file_a_scripts_suite_reads_selects_the_scripts_scope() -> None:
    """A file those suites read that selects no `scripts` changes on a pull request that runs none of them, and main goes red.

    The frontend's and the backend's reads are held above; these are the scripts scope's own.
    """
    files, _ = _scripts_reads()
    assert len(files) >= 10, f"only {sorted(files)} were read out of {SCRIPTS_SUITES}: that reader went inert"
    missing = [path for path in sorted(files) if not (REPO_ROOT / path).is_file()]
    assert not missing, f"UNPLACED_SCRIPT_READS names files this repository does not hold: {missing}"
    selected = _selected(files)
    unarmed = [f"{path} is read by {', '.join(sorted(files[path]))}" for path in sorted(files) if "scripts" not in selected[path]]
    assert not unarmed, "give the path's arm in scripts/gate/scope_map.sh the scripts scope:\n" + "\n".join(unarmed)


def test_a_scripts_suite_read_no_chain_places_is_one_this_check_declares() -> None:
    """A chain the reader cannot place would drop out of the case above in silence, so each one is declared with what it reads."""
    _, unplaced = _scripts_reads()
    assert unplaced == set(UNPLACED_SCRIPT_READS), (
        "the scripts suites' unplaced reads have changed.\n"
        "derived:  " + repr(sorted(unplaced)) + "\ndeclared: " + repr(sorted(UNPLACED_SCRIPT_READS))
    )


# How far above its own file a suite stands at the repository root: `tests/`, then `scripts/`, then it.
ROOT_CLIMB: Final = 3


def _climb(node: ast.expr, climbs: dict[str, int]) -> int | None:
    """How many directories above a suite's own file an expression stands, None off `Path(__file__)`."""
    if isinstance(node, ast.Name):
        return climbs.get(node.id)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "Path":
        return 0 if len(node.args) == 1 and isinstance(node.args[0], ast.Name) and node.args[0].id == "__file__" else None
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "resolve":
        return _climb(node.func.value, climbs)
    if isinstance(node, ast.Attribute) and node.attr == "parent":
        below = _climb(node.value, climbs)
        return None if below is None else below + 1
    if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Attribute) and node.value.attr == "parents":
        below, step = _climb(node.value.value, climbs), node.slice
        return None if below is None or not isinstance(step, ast.Constant) or not isinstance(step.value, int) else below + step.value + 1
    return None


def _root_spellings(tree: ast.Module) -> list[str]:
    """Every reach of the root `_suite_reads` does not follow, and every `joinpath`, by its source.

    That reader follows `REPO_ROOT` and `SCRIPTS.parent` down `/` chains; any other spelling reads a
    file no arm is held to.
    """
    climbs: dict[str, int] = {}
    kept: set[ast.expr] = set()
    for node in sorted((node for node in ast.walk(tree) if isinstance(node, ast.Assign | ast.AnnAssign)), key=lambda node: node.lineno):
        if node.value is not None and (climb := _climb(node.value, climbs)) is not None:
            climbs.update(dict.fromkeys(_bound_names(node), climb))
            if climb == ROOT_CLIMB and _bound_names(node) == [ROOT_NAME]:
                kept.add(node.value)
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "joinpath":
            found.append(ast.unparse(node))
        elif isinstance(node, ast.expr) and not isinstance(node, ast.Name) and node not in kept and not _is_root(node):
            if _climb(node, climbs) == ROOT_CLIMB:
                found.append(ast.unparse(node))
    return found


def test_every_scripts_suite_reaches_the_root_by_a_spelling_the_reads_follow() -> None:
    """Enforced rather than assumed: a read the derivation cannot see selects no scope and fails nothing."""
    found = [
        f"{suite.name}: {source}"
        for suite in sorted((REPO_ROOT / SCRIPTS_SUITES).glob("*.py"))
        for source in _root_spellings(ast.parse(suite.read_text(encoding="utf-8"), filename=suite.name))
    ]
    assert found == [], "reach the root as REPO_ROOT or SCRIPTS.parent, and join with `/`:\n" + "\n".join(found)


# Every spelling the reader answers for, the three it refuses beside the three it follows.
PLANTED_ROOTS: Final = """
REPO_ROOT: Final = Path(__file__).resolve().parents[2]
SCRIPTS = Path(__file__).resolve().parents[1]
FOLLOWED = SCRIPTS.parent / "docs" / "a.md"
JOINED = REPO_ROOT.joinpath("docs", "a.md")
ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).parent.parent
CLIMBED = HERE.parent / "docs" / "a.md"
"""


def test_the_root_reader_refuses_each_spelling_the_reads_cannot_follow() -> None:
    """The case above holds a tree that spells none, so each refusal is driven here."""
    assert _root_spellings(ast.parse(PLANTED_ROOTS)) == [
        "REPO_ROOT.joinpath('docs', 'a.md')",
        "Path(__file__).resolve().parents[2]",
        "HERE.parent",
    ]


# The suites that retype a frontend module's own constants and compare them, which is the reach
# `UNNAMEABLE` above spares from the equality: each names its modules as plain strings.
MIRROR_REGISTERS: Final[tuple[str, ...]] = ("fl_backend/tests/shared/test_frontend_mirrors.py",)

# The comment opening the arm those modules sit in, so the block is found without a line number.
MIRROR_ARM_OPENER: Final = "# The bounds and patterns `fl_backend/tests/shared/test_frontend_mirrors.py` compares are"

FRONTEND_SRC: Final = FRONTEND + "/src/"

MODULE_SUFFIXES: Final = (".ts", ".tsx")
TEST_SUFFIXES: Final = (".test.ts", ".test.tsx")

FRONTEND_MODULE_RE: Final = re.compile(re.escape(FRONTEND_SRC) + r"[\w/.-]+\.tsx?")


def _mirrored_modules() -> set[str]:
    """Every frontend module a register names, read out of its source rather than listed here.

    A test module is not one: a register naming one names where a pairing is held rather than a
    mirror.
    """
    found: set[str] = set()
    for rel in MIRROR_REGISTERS:
        tree = ast.parse((REPO_ROOT / rel).read_text(encoding="utf-8"), filename=rel)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Constant) or not isinstance(node.value, str):
                continue
            module = node.value if node.value.startswith(FRONTEND_SRC) else FRONTEND_SRC + node.value
            if module.endswith(MODULE_SUFFIXES) and not module.endswith(TEST_SUFFIXES) and (REPO_ROOT / module).is_file():
                found.add(module)
    return found


def _mirror_arm(mapping: Path) -> set[str]:
    """The paths of the arm carrying those modules, read off the mapping's own text."""
    text = mapping.read_text(encoding="utf-8")
    opened = text.find(MIRROR_ARM_OPENER)
    assert opened != -1, "the mirror arm's opening comment is gone, so this reader found no block at all"

    return set(FRONTEND_MODULE_RE.findall(text[opened : text.index(")\n", opened)]))


def test_every_module_a_mirror_register_names_selects_the_backend_scope() -> None:
    """Drop one from the mirror arm and this fails: the comparison over it then waits for the push to main."""
    crossings = _crossings()
    mirrored = _mirrored_modules()

    assert mirrored, "no frontend module was read out of the mirror registers: that reader went inert"
    unarmed = sorted(module for module in mirrored if FAR_SCOPE[FRONTEND] not in crossings.selected.get(module, set()))
    assert unarmed == [], "name each in scripts/gate/scope_map.sh's mirror arm:\n" + "\n".join(unarmed)


def test_every_path_in_the_mirror_arm_is_one_a_register_names() -> None:
    """The other direction: an arm naming a module no register reads buys the backend and database tiers for nothing."""
    carried = _mirror_arm(MAPPING)

    assert carried, "no path was read out of the mirror arm: that reader went inert"
    assert carried <= (mirrored := _mirrored_modules()), f"{sorted(carried - mirrored)} sits in the mirror arm and is named by no register"


# Two packages in miniature, shaped like the real reads. The real trees are no place to plant one,
# and neither is `scripts/gate/scope_map.sh`, which this suite does not own.
PLANTED_TREE: Final[dict[str, str]] = {
    "fl_backend/app/core/domain.py": "RULES = ()\n",
    "fl_backend/tests/test_mirror.py": (
        "from pathlib import Path\n\nROOT = Path(__file__).resolve().parents[2]\n"
        'ACTIONS = (ROOT / "fl_frontend" / "src" / "actions.ts").read_text(encoding="utf-8")\n'
        # The same read spelled through a binding, which a reader taking a name for an opaque
        # operand files as the whole tree while the module names one file in it.
        'SRC = ROOT / "fl_frontend" / "src"\n'
        'REGISTER = (SRC / "register.ts").read_text(encoding="utf-8")\n'
        'EVERY = sorted((ROOT / "fl_frontend" / "src").rglob("*.ts"))\n'
    ),
    "fl_frontend/src/actions.ts": "export const total = 1;\n",
    "fl_frontend/src/register.ts": 'const RULES = readFileSync(path.resolve(ROOT, "fl_backend", "app", "core", "domain.py"), "utf8");\n',
    "fl_frontend/src/opaque.ts": 'const RULES = readFileSync(path.resolve(ROOT, "fl_backend/app/core/domain.py"), "utf8");\n',
    # A file at the root, reached by climbing, and a climb landing back inside the frontend.
    "NOTICE": "Sample Notice\n",
    "fl_frontend/src/notice.ts": (
        'const NOTICE = readFileSync(path.resolve(import.meta.dirname, "..", "..", "NOTICE"), "utf8");\n'
        'const OWN = readFileSync(path.resolve(import.meta.dirname, "..", "src", "actions.ts"), "utf8");\n'
    ),
}

# The mapping's own shape: a continuation, a comment between arms, a glob arm and a literal one.
PLANTED_MAPPING: Final = (
    '    case "$f" in\n'
    "      # A comment naming fl_backend/app/core/domain.py, which is an arm's path either way.\n"
    "      fl_backend/app/core/domain.py|fl_backend/tests/test_mirror.py| \\\n"
    "      fl_frontend/src/actions.ts) backend=true; frontend=true ;;\n"
    "      fl_frontend/*) frontend=true ;;\n"
    "      */.prettierignore) format=true ;;\n"
    "      *) all ;;\n"
    "    esac\n"
)


def _planted() -> Path:
    root = new_root("cross-boundary-fixture-")
    for rel, text in PLANTED_TREE.items():
        write(root, rel, text)
    return root


def test_each_reader_finds_a_file_the_other_package_reads_and_a_reach_it_cannot_place() -> None:
    """Both directions over a planted tree, carrying the spellings this repository does not.

    A reader taking `opaque.ts`'s one string for a named file passes every case over the tree, which
    holds no module spelling a path that way.
    """
    root = _planted()
    # The second module of each pair is the shape that must not read as a named file.
    reads, reaches = _frontend_reaches(root, ["fl_frontend/src/register.ts", "fl_frontend/src/opaque.ts", "fl_frontend/src/notice.ts"])
    assert reads == {"fl_backend/app/core/domain.py": {"fl_frontend/src/register.ts"}, "NOTICE": {"fl_frontend/src/notice.ts"}}, repr(reads)
    assert reaches == {("fl_frontend/src/opaque.ts", BACKEND)}, repr(reaches)

    reads, reaches = _backend_reaches(root, ["fl_backend/tests/test_mirror.py"])
    assert reads == {
        "fl_frontend/src/actions.ts": {"fl_backend/tests/test_mirror.py"},
        "fl_frontend/src/register.ts": {"fl_backend/tests/test_mirror.py"},
    }, repr(reads)
    assert reaches == {("fl_backend/tests/test_mirror.py", "fl_frontend/src")}, repr(reaches)


def test_the_arm_reader_takes_a_literal_path_and_leaves_a_glob() -> None:
    """A glob is no cross-boundary arm, and swept in as one it would be probed as a path nothing reads."""
    root = _planted()
    mapping = write_shell(root / "scope_map.sh", PLANTED_MAPPING)
    assert _package_paths(mapping, root) == {
        "fl_backend/app/core/domain.py",
        "fl_backend/tests/test_mirror.py",
        "fl_frontend/src/actions.ts",
    }, repr(_package_paths(mapping, root))


# One population carrying every shape at once, the repository holding only the shape that passes.
PLANTED_CROSSINGS: Final = Crossings(
    reads={
        "fl_backend/app/core/domain.py": {"fl_frontend/src/register.ts"},
        "fl_frontend/src/actions.ts": {"fl_backend/tests/test_mirror.py"},
        # Outside both packages, so only its reader's package says which scope it owes.
        "NOTICE": {"fl_frontend/src/notice.ts"},
    },
    reaches={("fl_backend/tests/test_mirror.py", "fl_frontend/src")},
    # `recording.py` and `next.config.ts` are a stale arm, one per direction; `constants.ts` is the
    # arm a walked tree spares, which must not swallow `next.config.ts` with it.
    declared={
        "fl_backend/app/core/domain.py",
        "fl_backend/app/core/recording.py",
        "fl_frontend/src/actions.ts",
        "fl_frontend/src/constants.ts",
        "fl_frontend/next.config.ts",
    },
    selected={
        "fl_backend/app/core/domain.py": {"backend", "db", "docs"},
        "fl_backend/app/core/recording.py": {"backend", "db", "frontend", "docs"},
        "fl_frontend/src/actions.ts": {"frontend", "backend", "db", "docs"},
        "fl_frontend/src/constants.ts": {"frontend", "backend", "db", "docs"},
        "fl_frontend/next.config.ts": {"frontend", "backend", "db", "docs"},
        "NOTICE": {"docs"},
    },
)


def test_the_two_repairs_are_reported_apart() -> None:
    """Widening an arm and narrowing one are different edits, and a reader acts on which it was told.

    Planted because the repository is in neither state, and the arm one would name is not this
    suite's to edit.
    """
    assert _unarmed(PLANTED_CROSSINGS) == [
        "NOTICE is read by fl_frontend/src/notice.ts, and no arm carries it into --frontend",
        "fl_backend/app/core/domain.py is read by fl_frontend/src/register.ts, and no arm carries it into --frontend",
    ], repr(_unarmed(PLANTED_CROSSINGS))
    assert _stale(PLANTED_CROSSINGS) == [
        "fl_backend/app/core/recording.py is carried into --frontend, and nothing there reads it",
        "fl_frontend/next.config.ts is carried into --backend, and nothing there reads it",
    ], repr(_stale(PLANTED_CROSSINGS))


# --- the frontend's db tier ---------------------------------------------------------------------------

DB_TIER_SCRIPT: Final = "test:db"
UNIT_TIER_SCRIPT: Final = "test"
DB_TIER_FILE_RE: Final = re.compile(r"\.db\.test\.[cm]?[jt]s$")

# A script's command line up to its first quoted file pattern, which is where the two tiers part. A
# flag written after a pattern is compared by nothing, so every launcher flag goes ahead of them.
LAUNCHER_RE: Final = re.compile(r'^([^"]*)"')

# A tier handing its patterns to another script, which carries the launcher both tiers share.
RUNS_BASE_RE: Final = re.compile(r"^pnpm run ([\w:-]+) ")


def _launched(scripts: dict[str, str], name: str) -> str:
    """A tier's command line as it runs, the base script it hands its patterns to spelled in."""
    command = scripts[name]
    base = RUNS_BASE_RE.match(command)
    return command if base is None else scripts[base[1]] + " " + command[base.end() :]


def test_both_test_tiers_start_under_one_launcher() -> None:
    """A hook one tier loads and the other does not runs the two under different loaders.

    Read as each tier runs, so a tier spelling a launcher of its own is compared with the base the other runs.
    """
    scripts = json.loads((REPO_ROOT / FRONTEND / "package.json").read_text(encoding="utf-8"))["scripts"]
    launchers = {name: LAUNCHER_RE.match(_launched(scripts, name)) for name in (UNIT_TIER_SCRIPT, DB_TIER_SCRIPT)}
    assert all(launchers.values()), f"a tier's script names no quoted file pattern to part the launcher at: {launchers}"
    unit, db = (match[1] for match in launchers.values() if match is not None)
    assert unit == db, f"`{UNIT_TIER_SCRIPT}` starts under\n  {unit}\nand `{DB_TIER_SCRIPT}` under\n  {db}"


# A module named by string after `from`, a bare `import`, a dynamic `import(`, or
# `import.meta.resolve(`, which a db-tier file loads the production client through. A package falls
# out at resolution, the manifests' own arm carrying every one.
IMPORTED_RE: Final = re.compile(r"""(?:\bfrom|\bimport(?:\.meta\.resolve)?)\s*\(?\s*["']([^"'\n]+)["']""")

# A hook or a reporter `node` loads ahead of every test file. A reporter named bare is built in.
LOADED_RE: Final = re.compile(r"--(?:import|require|test-reporter)[= ](\./[^\s\"]+)")

# Read out of the hook rather than copied, so an extension it learns reaches this resolver too.
ALIAS_HOOK: Final = FRONTEND + "/tsconfig-alias-hook.mjs"
CANDIDATES_RE: Final = re.compile(r"CANDIDATE_SUFFIXES = (\[[^\]]*\])")

BY_PATTERN: Final = "the `" + DB_TIER_SCRIPT + "` file pattern"
BY_COMMAND: Final = "the `" + DB_TIER_SCRIPT + "` command line"


def _resolved(importer: str, specifier: str, candidates: list[str]) -> str | None:
    """The file one local specifier names, tried as the alias hook tries it; None for a package."""
    if specifier.startswith("@/"):
        base = FRONTEND + "/src/" + specifier.removeprefix("@/")
    elif specifier.startswith(("./", "../")):
        base = posixpath.normpath(posixpath.join(posixpath.dirname(importer), specifier))
    else:
        return None
    found = next((base + suffix for suffix in candidates if (REPO_ROOT / (base + suffix)).is_file()), None)
    # Loud rather than skipped: a specifier this cannot place is a load the check below never asks about.
    assert found is not None, f"{importer} imports {specifier!r}, which no candidate of {ALIAS_HOOK} resolves"
    return found


def _db_tier_loads() -> dict[str, str]:
    """Each file the frontend's db tier loads directly, against what loads it.

    Direct alone: a module one of these imports in turn is left to the push to main, as the arm in
    `scripts/gate/scope_map.sh` carrying these says.
    """
    listing = git(REPO_ROOT, "-c", "core.quotepath=false", "ls-files", "--cached", "--others", "--exclude-standard", "--", FRONTEND)
    tiers = sorted(rel for rel in listing.splitlines() if DB_TIER_FILE_RE.search(rel) and (REPO_ROOT / rel).is_file())
    loads = dict.fromkeys(tiers, BY_PATTERN)
    manifest = json.loads((REPO_ROOT / FRONTEND / "package.json").read_text(encoding="utf-8"))
    for loaded in LOADED_RE.findall(_launched(manifest["scripts"], DB_TIER_SCRIPT)):
        loads[FRONTEND + "/" + loaded.removeprefix("./")] = BY_COMMAND
    declared = CANDIDATES_RE.search((REPO_ROOT / ALIAS_HOOK).read_text(encoding="utf-8"))
    assert declared is not None, ALIAS_HOOK + " no longer declares CANDIDATE_SUFFIXES as a list this reads"
    candidates: list[str] = json.loads(declared[1])
    for rel in tiers:
        for specifier in IMPORTED_RE.findall((REPO_ROOT / rel).read_text(encoding="utf-8")):
            if (found := _resolved(rel, specifier, candidates)) is not None:
                loads.setdefault(found, rel)
    return loads


def test_every_file_the_frontend_db_tier_loads_directly_selects_the_db_scope() -> None:
    """A change to one of them alone reaches the replica-set tests no earlier than the push to main.

    One non-emptiness check per source, so a reader gone inert fails rather than asking nothing.
    """
    loads = _db_tier_loads()
    assert BY_PATTERN in loads.values(), "no db-tier file was found under " + FRONTEND + ": that listing went inert"
    assert BY_COMMAND in loads.values(), f"`{DB_TIER_SCRIPT}` was read as loading nothing ahead of its files: that reader went inert"
    assert set(loads.values()) - {BY_PATTERN, BY_COMMAND}, "no db-tier file was read as importing a local module: that reader went inert"
    chosen = _selected(loads)
    unselected = sorted(f"{path}, loaded by {by}" for path, by in loads.items() if "db" not in chosen[path])
    assert not unselected, "name each in scripts/gate/scope_map.sh's db-tier arm:\n" + "\n".join(unselected)


# What the db-tier arm selects, `format` riding along for a suffix prettier reads, and no other arm
# naming a single frontend file does: the arms that also select `db` carry `images` or `backend`.
DB_TIER_ARM: Final = frozenset({"frontend", "db", "docs", "format"})


def test_every_file_the_db_tier_arm_names_is_one_the_tier_loads_directly() -> None:
    """The other direction: a file moved or deleted leaves its name in the arm, selecting a scope for nothing.

    Read by token and never filtered on existence, so a name no file answers to is what fails.
    """
    mapping = MAPPING.read_text(encoding="utf-8")
    named = {token for token in SHELL_TOKEN.findall(mapping) if token.startswith(FRONTEND + "/")}
    chosen = _selected(named)
    armed = {path for path in named if chosen[path] == DB_TIER_ARM}
    assert armed, "no path in scripts/gate/scope_map.sh was read as the db-tier arm's: that reader went inert"
    stale = sorted(armed - set(_db_tier_loads()))
    assert not stale, "drop each from scripts/gate/scope_map.sh's db-tier arm, or restore the load:\n" + "\n".join(stale)


# Run by both package scopes too (`scripts/gate/verify.sh :: crossing_cases`): a pull request
# changing a read across the boundary selects one of them and not this suite's, and the frontend
# job holds no pytest.
CROSSING_CASES: Final = (
    test_every_file_the_other_package_reads_is_carried_across_by_an_arm,
    test_every_arm_reaching_across_the_boundary_names_a_file_the_other_package_reads,
    test_a_reach_that_names_no_single_file_is_one_this_check_declares,
    test_every_module_a_mirror_register_names_selects_the_backend_scope,
    test_every_path_in_the_mirror_arm_is_one_a_register_names,
)


def _crossing_run() -> int:
    """Every crossing case, each failure printed with its own message, and the checkers' exit code."""
    failed = 0
    for case in CROSSING_CASES:
        try:
            case()
        except AssertionError as refused:
            print(f"{case.__name__}:\n{refused}\n")
            failed = 1
    return failed


if __name__ == "__main__":
    sys.path.insert(0, str(REPO_ROOT / "scripts" / "lib"))
    import checker_kernel

    raise SystemExit(checker_kernel.run(_crossing_run))
