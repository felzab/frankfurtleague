"""SCRIPTS · does this gate run cover what the branch actually changed?

A comment-only edit is a documentation change whatever file holds it, but the carve-out stops at
what a parser can prove: anything unproven counts as code, and only a missed images scope fails.
Two shapes a parser calls a comment are excluded by name, because a tool downstream reads them --
`TOOLCHAIN_DIRECTIVE`, and a docstring under `DOCSTRINGS_ARE_PUBLISHED`. The path mapping is
`scripts/gate/scope_map.sh`, whose scope names are verify.sh's flags, so nothing here translates between
them.
"""

from __future__ import annotations

import argparse
import ast
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Final

# `scripts/lib/` is a sibling of this directory, and a script's sys.path opens with this one.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import (  # noqa: E402 -- the insert above is what resolves it
    DEFAULT_BASE,
    EXIT_OK,
    EXIT_REFUSED,
    REPO_ROOT,
    Finding,
    git,
    report_findings,
    resolve_base,
    run,
)

# In the order verify.sh runs them. The set is `scripts/gate/scope_map.sh`'s to change: a scope it emits
# and this does not is a surface nobody is told about, the one drift a second list can still cause.
SCOPES: Final[tuple[str, ...]] = ("scripts", "docs", "backend", "format", "frontend", "ops", "db", "images")

# Suffixes a real parser can answer for. Anything absent from here is code.
TYPESCRIPT: Final[frozenset[str]] = frozenset({".ts", ".tsx", ".mts", ".cts"})
PARSEABLE: Final[frozenset[str]] = TYPESCRIPT | frozenset({".py", ".toml"})

# Windows refuses a command line past 32,767 bytes, the ceiling `.githooks/pre-commit` batches
# under for the same reason. Over it the spawn raises instead of answering, and a whole diff's
# worth of pairs would degrade to code at once.
ARGV_BUDGET: Final = 24_000

MAX_NAMED_FILES: Final = 8  # a finding names the files; past this it says "and N more"

# A comment a tool READS, so adding, deleting or moving one changes what runs while the syntax tree
# a parser compares stays identical. Every match here is code, whatever the parser then answers.
TOOLCHAIN_DIRECTIVE: Final = re.compile(
    r"^#!"  # a shebang picks the interpreter, and nothing downstream re-reads the file to notice
    r"|#\s*(?:type|ruff|fmt|isort|pyright|pragma):"
    r"|#\s*noqa"  # written bare, carrying no codes, it suppresses every rule on its line
    r"|(?://|/\*)\s*(?:@ts-|eslint\b|prettier-ignore|global\b)"
)

# FastAPI publishes an endpoint's docstring as the OpenAPI `description` (INC-4), so under here a
# docstring is response text rather than a comment and `fl_backend/openapi.json` goes stale with it.
DOCSTRINGS_ARE_PUBLISHED: Final = "fl_backend/app/"

# Named rather than spelled in the `except` line, so this module PARSES below the floor: the
# kernel's message cannot print from a file that will not compile, and a SyntaxError exits 1.
CANNOT_PROVE: Final = (SyntaxError, ValueError, RuntimeError, OSError)
UNREADABLE: Final = (OSError, UnicodeDecodeError)


@dataclass(frozen=True)
class Changes:
    """What the branch changed, and which of those paths exist in two versions at once."""

    paths: list[str]
    two_versions: frozenset[str]


def _listed(answer: str) -> set[str]:
    return {line.strip() for line in answer.split("\n") if line.strip()}


def changed_files(base: str) -> Changes | None:
    """Everything the branch changed against `base`, or None where git refused.

    `git diff <base>` compares against the WORKING TREE, the gate running before the commit. A
    refused listing is not an empty one: it leaves every complaint below unread.
    """
    # `core.quotepath=false` for `scripts/gate/scope_map.sh`'s reason: an escaped non-ASCII path matches
    # no arm there and turns every scope on, naming a spelling nobody can re-run against.
    quoting = ("-c", "core.quotepath=false")

    # `--no-renames` because a detected rename prints its DESTINATION alone, and every scope the
    # source path selected vanishes with it -- fl_frontend/Dockerfile renamed away asks for none.
    listing = (*quoting, "diff", "--no-renames", "--name-only")
    tracked = git(*listing, base)
    # `git commit` commits the INDEX, which `git diff <base>` never reads: a hunk staged and then
    # reverted in the working tree reaches the commit and neither listing beside this one.
    staged = git(*listing, "--cached", base)
    # Index against working tree. Alone this is every unstaged edit, so it decides nothing until
    # it is intersected with `staged` below.
    unstaged = git(*listing)
    untracked = git(*quoting, "ls-files", "--others", "--exclude-standard")
    if tracked is None or staged is None or unstaged is None or untracked is None:
        return None
    in_index, differing = _listed(staged), _listed(unstaged)
    return Changes(
        paths=sorted(_listed(tracked) | in_index | _listed(untracked)),
        # In both listings means the index carries one version of the change and the working tree
        # another. `git commit` takes the first and `git commit -a` the second, so proving either
        # comment-only proves nothing about the one that lands.
        two_versions=frozenset(in_index & differing),
    )


# --- the classifier ---------------------------------------------------------------------------------


def strip_docstrings(tree: ast.AST) -> ast.AST:
    """Docstrings are ast nodes, so a docstring-only edit would otherwise read as a code change."""
    for node in ast.walk(tree):
        if not isinstance(node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef):
            continue
        body = node.body
        if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
            # A body that was nothing but its docstring still needs one statement to stay valid.
            node.body = body[1:] if len(body) > 1 else [ast.Pass()]
    return tree


def python_same(old: str, new: str, *, keep_docstrings: bool = False) -> bool:
    # include_attributes defaults to False, so line numbers are not part of the comparison - moving
    # a statement down by a comment's worth of lines is not a change.
    before, after = ast.parse(old), ast.parse(new)
    if not keep_docstrings:
        before, after = strip_docstrings(before), strip_docstrings(after)
    return ast.dump(before) == ast.dump(after)


def toml_values_same(old: object, new: object) -> bool:
    """Equality that will not read a retyped value as unchanged.

    `tomllib` answers python objects, and python grades `True == 1` and `30 == 30.0` as equal --
    so the document's own types have to be compared beside its values.
    """
    if type(old) is not type(new):
        return False
    if isinstance(old, dict) and isinstance(new, dict):
        return old.keys() == new.keys() and all(toml_values_same(old[key], new[key]) for key in old)
    if isinstance(old, list) and isinstance(new, list):
        return len(old) == len(new) and all(toml_values_same(a, b) for a, b in zip(old, new, strict=True))
    return old == new


def toml_same(old: str, new: str) -> bool:
    return toml_values_same(tomllib.loads(old), tomllib.loads(new))


def directives_differ(old: str, new: str) -> bool:
    """Whether the two versions disagree over any line carrying a `TOOLCHAIN_DIRECTIVE`.

    Counted rather than set-compared: a file holding the same `# noqa` twice loses one, and a set
    would call the remaining copy proof that nothing moved.
    """
    before = Counter(line.strip() for line in old.splitlines())
    after = Counter(line.strip() for line in new.splitlines())
    return any(TOOLCHAIN_DIRECTIVE.search(line) for line in (before - after) + (after - before))


def normalizer_batch(paths: list[str]) -> list[bool]:
    """One `ts_normalize.mjs --batch` process, one verdict per pair of `paths`, in order.

    Every failure is False for the pairs it covers: a crash, or answers this cannot match to its
    pairs. One unparseable pair degrades alone, through its own `error` line.
    """
    pairs = len(paths) // 2
    try:
        result = subprocess.run(
            ["node", "scripts/checks/ts_normalize.mjs", "--batch", *paths],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except OSError:
        return [False] * pairs
    if result.returncode != 0:
        return [False] * pairs
    answers = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if len(answers) != pairs:
        return [False] * pairs
    return [answer == "same" for answer in answers]


def typescript_same_many(items: list[tuple[str, str, str]]) -> list[bool]:
    """A verdict per `(suffix, old, new)` pair, over as few node processes as ARGV_BUDGET allows.

    Nothing here raises. With no node every pair is False, the answer that counts as code.
    """
    if not items:
        return []
    if shutil.which("node") is None:
        return [False] * len(items)
    verdicts: list[bool] = []
    with tempfile.TemporaryDirectory() as tmp:
        batch: list[str] = []
        used = 0
        for index, (suffix, old, new) in enumerate(items):
            # The real suffix, because ts_normalize.mjs picks its script kind from the extension -- a
            # .tsx written out as .ts parses its JSX as syntax errors and the answer degrades to "code".
            old_path = Path(tmp) / f"old{index}{suffix}"
            new_path = Path(tmp) / f"new{index}{suffix}"
            # newline="" because a Windows text stream rewrites every \n as \r\n (CLAUDE.md §6), and what
            # the parser must see is the bytes git handed over -- a line ending is a token to a scanner.
            old_path.write_text(old, encoding="utf-8", newline="")
            new_path.write_text(new, encoding="utf-8", newline="")
            pair = [str(old_path), str(new_path)]
            cost = sum(len(argument) + 1 for argument in pair)
            # A pair is never split across two spawns: the verdicts are matched to the pairs by
            # position, so half a pair in each batch would shift every answer after it.
            if batch and used + cost > ARGV_BUDGET:
                verdicts += normalizer_batch(batch)
                batch, used = [], 0
            batch += pair
            used += cost
        if batch:
            verdicts += normalizer_batch(batch)
    return verdicts


def typescript_same(suffix: str, old: str, new: str) -> bool:
    """Delegated to TypeScript's own parser - see scripts/checks/ts_normalize.mjs for why not a regex."""
    return typescript_same_many([(suffix, old, new)])[0]


def same_but_for_comments(suffix: str, old: str, new: str, *, keep_docstrings: bool = False) -> bool:
    """True only when a parser proves it. Every other answer, including every error, is False.

    `keep_docstrings` defaults off, so `--compare` answers for the language; a path decides it
    only in `material_paths`.
    """
    if suffix not in PARSEABLE:
        return False
    if directives_differ(old, new):
        return False
    try:
        if suffix == ".py":
            return python_same(old, new, keep_docstrings=keep_docstrings)
        if suffix == ".toml":
            return toml_same(old, new)
        return typescript_same(suffix, old, new)
    except CANNOT_PROVE:
        # A version that does not parse, or a toolchain that is absent: neither is proof, so the
        # change counts as code.
        return False


def old_versions(base: str, paths: list[str]) -> dict[str, str | None]:
    """Every earlier version in one `git cat-file --batch`, None where a path has none.

    A path git answers `missing` for, an undecodable payload, or a listing git refused: each
    stays None, and a path with no earlier version counts as code.
    """
    versions: dict[str, str | None] = dict.fromkeys(paths)
    if not paths:
        return versions
    request = "".join(f"{base}:{path}\n" for path in paths).encode("utf-8")
    try:
        result = subprocess.run(("git", "cat-file", "--batch"), cwd=REPO_ROOT, input=request, capture_output=True)
    except OSError:
        return versions
    if result.returncode != 0:
        return versions
    out = result.stdout
    pos = 0
    for path in paths:
        newline = out.find(b"\n", pos)
        if newline < 0:
            break
        header = out[pos:newline].split(b" ")
        pos = newline + 1
        # `<oid> <type> <size>`, then the payload and one LF. Anything else -- `missing`,
        # `ambiguous` -- carries no payload, so the cursor is already on the next header.
        if len(header) != 3 or not header[2].isdigit():
            continue
        size = int(header[2])
        payload = out[pos : pos + size]
        pos += size + 1
        if len(payload) != size:
            break
        try:
            versions[path] = payload.decode("utf-8")
        except UnicodeDecodeError:
            # A binary in the diff must not take the scope step down before any check runs.
            pass
    return versions


def material_paths(base: str, files: list[str], two_versions: frozenset[str] = frozenset()) -> list[str]:
    """Everything not PROVEN comment-only, in the input's order.

    One git process fetches every earlier version and the TypeScript pairs answer together. A
    suffix no parser reads is code without either, and so is a path in `two_versions`.
    """
    candidates = [path for path in files if Path(path).suffix in PARSEABLE and path not in two_versions]
    olds = old_versions(base, candidates)
    comment_only: set[str] = set()
    ts_paths: list[str] = []
    ts_items: list[tuple[str, str, str]] = []
    for path in candidates:
        old = olds[path]
        if old is None:  # added on this branch: there is no earlier version to compare against
            continue
        try:
            new = (REPO_ROOT / path).read_text(encoding="utf-8")
        except UNREADABLE:
            continue
        suffix = Path(path).suffix
        # The TypeScript pairs alone are held back, so one process can answer them together. Every
        # other suffix goes through the single dispatch that --compare and selfcheck.sh also drive.
        if suffix in TYPESCRIPT:
            # Restated here because the batch below reaches the parser without passing through
            # `same_but_for_comments`, which is where the same refusal sits for every other suffix.
            if directives_differ(old, new):
                continue
            ts_paths.append(path)
            ts_items.append((suffix, old, new))
        elif same_but_for_comments(suffix, old, new, keep_docstrings=path.startswith(DOCSTRINGS_ARE_PUBLISHED)):
            comment_only.add(path)
    for path, proven_same in zip(ts_paths, typescript_same_many(ts_items), strict=True):
        if proven_same:
            comment_only.add(path)
    return [path for path in files if path not in comment_only]


# --- the mapping ------------------------------------------------------------------------------------


def scope_map(files: list[str]) -> dict[str, bool] | None:
    """scripts/gate/scope_map.sh over an explicit file list. None when it could not be run at all."""
    bash = shutil.which("bash")
    if bash is None:
        return None
    # Bytes on purpose: text mode translates "\n" to os.linesep, so on Windows a CR-suffixed name
    # reaches the shell, matches no case arm, and turns every scope on through the fallback.
    result = subprocess.run(
        [bash, "scripts/gate/scope_map.sh", "--stdin"],
        cwd=REPO_ROOT,
        input="\n".join(files).encode("utf-8"),
        capture_output=True,
    )
    if result.returncode != 0:
        return None
    scopes: dict[str, bool] = {}
    for line in result.stdout.decode("utf-8", errors="replace").split("\n"):
        if "=" in line:
            name, value = line.split("=", 1)
            scopes[name.strip()] = value.strip() == "true"
    return scopes


def images_culprits(files: list[str]) -> list[str]:
    """Which of these files is the reason the images scope is required. The failure path only.

    Concurrent: one `bash` launch per file, and in series that outran the whole gate. `map` keeps
    input order.
    """
    if not files:
        return []
    # `--stdin` mode writes nothing. The default width, `min(32, cpus + 4)`, suits waiting on processes.
    pool = ThreadPoolExecutor()
    try:
        asked = list(pool.map(lambda path: (scope_map([path]) or {}).get("images"), files))
    finally:
        # `cancel_futures`, or Ctrl-C waits out every launch already queued rather than the running ones.
        pool.shutdown(wait=True, cancel_futures=True)
    return [path for path, images in zip(files, asked, strict=True) if images]


# --- the check --------------------------------------------------------------------------------------


def named_list(paths: list[str]) -> str:
    shown = ", ".join(paths[:MAX_NAMED_FILES])
    return shown if len(paths) <= MAX_NAMED_FILES else f"{shown}, and {len(paths) - MAX_NAMED_FILES} more"


def check(base: str, ran: set[str]) -> list[Finding] | None:
    """Every scope the diff asks for and this run did not prove, or None where nothing was read."""
    changes = changed_files(base)
    if changes is None:
        return None
    files = changes.paths
    if not files:
        print(f"      no changes against {base[:7]} -- nothing to scope")
        return []

    material = material_paths(base, files, changes.two_versions)
    proven_code = set(material)
    comment_only = [path for path in files if path not in proven_code]

    required = scope_map(material)
    if required is None:
        return None

    # A comment-only edit is still a documentation change, and a comment is exactly what prettier
    # reflows, so it still asks for the formatter.
    if comment_only:
        required["docs"] = True
        required["format"] = True
        print(f"      {len(comment_only)} file(s) changed by comments alone, so they ask for --docs and --format:")
        print(f"        {named_list(comment_only)}")

    findings: list[Finding] = []

    for scope in SCOPES:
        if not required.get(scope) or scope in ran:
            continue
        if scope == "images":
            findings.append(
                Finding(
                    "fail",
                    "the image build did not run, and these files ask for it with a change\n"
                    "              that is more than comments:\n"
                    f"                {named_list(images_culprits(material))}\n"
                    f"              Re-run with:  ./scripts/gate/verify.sh --{scope}",
                )
            )
        else:
            findings.append(Finding("report", f"the diff asks for --{scope}, which did not run"))

    # A scope the mapping grows and this list does not would otherwise be read past in silence.
    if unknown := sorted(set(required) - set(SCOPES)):
        findings.append(Finding("report", f"scope_map.sh emits {', '.join(unknown)}, which this check does not know -- add it to SCOPES"))

    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Is this gate run's scope wide enough for the diff?")
    parser.add_argument("--ran", default="", help="the verify.sh scopes this run covers, space- or comma-separated")
    parser.add_argument(
        "--compare",
        nargs=2,
        metavar=("OLD", "NEW"),
        help="classify two files instead of a branch: prints comment-only or code. selfcheck.sh drives the classifier through this",
    )
    args = parser.parse_args()

    if args.compare:
        old_path, new_path = (Path(p) for p in args.compare)
        same = same_but_for_comments(new_path.suffix, old_path.read_text(encoding="utf-8"), new_path.read_text(encoding="utf-8"))
        print("comment-only" if same else "code")
        return EXIT_OK

    ran = {scope for scope in args.ran.replace(",", " ").split() if scope}

    base = resolve_base()
    if base is None:
        # Refused, not green: this checker's only question is about the diff, so with no base it
        # judged nothing. `check_docs.py` fails its branch-scoped checks instead, having a corpus
        # left to judge either way.
        print(f"      no merge base with {DEFAULT_BASE} -- this run was not checked against the diff.")
        print(f"      A single-branch clone fetches no base. Add it:  git remote set-branches --add origin {DEFAULT_BASE}")
        print(f"                                                      git fetch origin {DEFAULT_BASE}")
        return EXIT_REFUSED

    findings = check(base, ran)
    if findings is None:
        # Refused, not green: the mapping is the only thing that knows which scopes this diff asks
        # for.
        print("      the diff could not be read, or scripts/gate/scope_map.sh could not be run --")
        print("      this run was not checked against the branch. bash is what runs it;")
        print("      on Windows it ships with Git.")
        return EXIT_REFUSED

    code = report_findings(findings)
    if code != EXIT_OK:
        print("\n      The rule is CLAUDE.md, The gate.")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
