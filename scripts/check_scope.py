"""
SCRIPTS · does this gate run cover what the branch actually changed?

Run by verify.sh as its first step, because the scope flags are chosen by whoever types them and
nothing else reads the diff back. The rule held is CLAUDE.md's gate section: the scope covers
every surface the branch touched, and a comment-only edit is a documentation change whatever
file holds it. Only a missed images scope fails; every other gap is reported, and anything a
parser cannot prove counts as code.

Invariants:
- The classifier suppresses the scope complaints and adds the documentation and formatter ones; it
  removes no CI job.
- Parsers, never a `#` rule: TypeScript via ts_normalize.mjs, `ast` with docstrings stripped, tomllib.
- The path mapping is scripts/ci_scopes.sh — the one copy; a second here would drift silently.
- One vocabulary: that mapping emits a line per verify.sh flag, so a required scope and the flag
  that proves it are the same word and nothing here translates between them.

See:
- scripts/checker_kernel.py — git, the base, and the exit code this answers with
"""

from __future__ import annotations

import argparse
import ast
import shutil
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path
from typing import Final

from checker_kernel import DEFAULT_BASE, EXIT_OK, EXIT_REFUSED, REPO_ROOT, Finding, git, report_findings, resolve_base, run

# In the order verify.sh runs them. The set is `scripts/ci_scopes.sh`'s to change: a scope it emits
# and this does not is a surface nobody is told about, the one drift a second list can still cause.
SCOPES: Final[tuple[str, ...]] = ("scripts", "docs", "backend", "format", "frontend", "ops", "db", "images")

# Suffixes a real parser can answer for. Anything absent from here is code.
PARSEABLE: Final[frozenset[str]] = frozenset({".ts", ".tsx", ".mts", ".cts", ".py", ".toml"})

MAX_NAMED_FILES: Final = 8  # a finding names the files; past this it says "and N more"

# Named rather than spelled in the `except` line, so this module PARSES below the floor: the
# kernel's message cannot print from a file that will not compile, and a SyntaxError exits 1 --
# the code a finding uses.
CANNOT_PROVE: Final = (SyntaxError, ValueError, RuntimeError, OSError)
UNREADABLE: Final = (OSError, UnicodeDecodeError)


def changed_files(base: str) -> list[str] | None:
    """Everything the branch changed against `base`, or None where git could not answer.

    `git diff <base>` compares that commit to the WORKING TREE, so an edit the author has not staged
    counts - which is the point, since the gate is usually run before the commit.

    None is not an empty list: no changed file is a clean branch, while a refused listing is every
    scope complaint below passing unread.
    """
    tracked = git("diff", "--name-only", base)
    untracked = git("ls-files", "--others", "--exclude-standard")
    if tracked is None or untracked is None:
        return None
    return sorted({line.strip() for line in f"{tracked}\n{untracked}".split("\n") if line.strip()})


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


def python_same(old: str, new: str) -> bool:
    # include_attributes defaults to False, so line numbers are not part of the comparison - moving
    # a statement down by a comment's worth of lines is not a change.
    return ast.dump(strip_docstrings(ast.parse(old))) == ast.dump(strip_docstrings(ast.parse(new)))


def toml_same(old: str, new: str) -> bool:
    return tomllib.loads(old) == tomllib.loads(new)


def typescript_same(suffix: str, old: str, new: str) -> bool:
    """Delegated to TypeScript's own parser - see scripts/ts_normalize.mjs for why not a regex."""
    if shutil.which("node") is None:
        raise RuntimeError("node is not on PATH")
    with tempfile.TemporaryDirectory() as tmp:
        # The real suffix, because ts_normalize.mjs picks its script kind from the extension -- a
        # .tsx written out as .ts parses its JSX as syntax errors and the answer degrades to "code".
        old_path, new_path = Path(tmp) / f"old{suffix}", Path(tmp) / f"new{suffix}"
        # newline="" because a Windows text stream rewrites every \n as \r\n (CLAUDE.md §6), and what
        # the parser must see is the bytes git handed over -- a line ending is a token to a scanner.
        old_path.write_text(old, encoding="utf-8", newline="")
        new_path.write_text(new, encoding="utf-8", newline="")
        result = subprocess.run(
            ["node", "scripts/ts_normalize.mjs", str(old_path), str(new_path)],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "ts_normalize.mjs failed")
    return result.stdout.strip() == "same"


def same_but_for_comments(suffix: str, old: str, new: str) -> bool:
    """True only when a parser proves it. Every other answer, including every error, is False."""
    if suffix not in PARSEABLE:
        return False
    try:
        if suffix == ".py":
            return python_same(old, new)
        if suffix == ".toml":
            return toml_same(old, new)
        return typescript_same(suffix, old, new)
    except CANNOT_PROVE:
        # A version that does not parse, or a toolchain that is not installed: neither is proof of
        # anything, so the change counts as code.
        return False


def is_comment_only(base: str, path: str) -> bool:
    old = git("show", f"{base}:{path}")
    if old is None:  # added on this branch: there is no earlier version to compare against
        return False
    try:
        new = (REPO_ROOT / path).read_text(encoding="utf-8")
    # A binary in the diff is not comment-only, and decoding one must not take the scope step down
    # before any check runs.
    except UNREADABLE:
        return False
    return same_but_for_comments(Path(path).suffix, old, new)


# --- the mapping ------------------------------------------------------------------------------------


def ci_scopes(files: list[str]) -> dict[str, bool] | None:
    """scripts/ci_scopes.sh over an explicit file list. None when it could not be run at all."""
    bash = shutil.which("bash")
    if bash is None:
        return None
    # Bytes on purpose: text mode translates "\n" to os.linesep, so on Windows every path but the
    # last reaches the shell with a trailing "\r" -- and a CR-suffixed name matches no case arm,
    # turning every scope on through the fallback.
    result = subprocess.run(
        [bash, "scripts/ci_scopes.sh", "--stdin"],
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
    """Which of these files is the reason the images scope is required. The failure path only."""
    return [path for path in files if (ci_scopes([path]) or {}).get("images")]


# --- the check --------------------------------------------------------------------------------------


def named_list(paths: list[str]) -> str:
    shown = ", ".join(paths[:MAX_NAMED_FILES])
    return shown if len(paths) <= MAX_NAMED_FILES else f"{shown}, and {len(paths) - MAX_NAMED_FILES} more"


def check(base: str, ran: set[str]) -> list[Finding] | None:
    """Every scope the diff asks for and this run did not prove, or None where nothing was read."""
    files = changed_files(base)
    if files is None:
        return None
    if not files:
        print(f"      no changes against {base[:7]} -- nothing to scope")
        return []

    material = [path for path in files if not is_comment_only(base, path)]
    proven_code = set(material)
    comment_only = [path for path in files if path not in proven_code]

    required = ci_scopes(material)
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
                    f"              Re-run with:  ./scripts/verify.sh --{scope}",
                )
            )
        else:
            findings.append(Finding("report", f"the diff asks for --{scope}, which did not run"))

    # The drift the header names, made visible: a scope the mapping grows and this list does not
    # would otherwise be read past in silence.
    if unknown := sorted(set(required) - set(SCOPES)):
        findings.append(Finding("report", f"ci_scopes.sh emits {', '.join(unknown)}, which this check does not know -- add it to SCOPES"))

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
        # Refused, not green: this checker's only question is about the diff, so with no
        # base it judged nothing. `check_docs.py` answers an advisory instead, because its
        # branch-scoped checks are one slice of a run that judged the corpus anyway.
        print(f"      no merge base with {DEFAULT_BASE} -- this run was not checked against the diff.")
        print(f"      A single-branch clone fetches no base. Add it:  git remote set-branches --add origin {DEFAULT_BASE}")
        print(f"                                                      git fetch origin {DEFAULT_BASE}")
        return EXIT_REFUSED

    findings = check(base, ran)
    if findings is None:
        # Refused, not green: the mapping is the only thing that knows which scopes this
        # diff asks for, so a run that could not read the diff or launch it judged nothing.
        print("      the diff could not be read, or scripts/ci_scopes.sh could not be run --")
        print("      this run was not checked against the branch. bash is what runs it;")
        print("      on Windows it ships with Git.")
        return EXIT_REFUSED

    code = report_findings(findings)
    if code != EXIT_OK:
        print("\n      The rule is CLAUDE.md, The gate.")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
