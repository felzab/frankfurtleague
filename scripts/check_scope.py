"""
SCRIPTS · does this gate run cover what the branch actually changed?

Run by verify.sh as its first step, because the scope flags are chosen by whoever types them and
nothing else reads the diff back. The rule held is CLAUDE.md's gate section: the scope covers
every surface the branch touched, and a comment-only edit is a documentation change whatever
file holds it. Only a missed images scope refuses; every other gap is reported — the reasoning,
and why anything a parser cannot prove counts as code, is ADR-0037.

Invariants:
- The classifier only ever suppresses a complaint, and it removes no CI job.
- Parsers, never a `#` rule: TypeScript via ts_normalize.mjs, `ast` with docstrings stripped, tomllib.
- The path mapping is scripts/ci_scopes.sh — the one copy; a second here would drift silently.
- CI's `backend` means `--backend` plus `--db`; `format` is `--frontend`'s prettier step, or
  `pnpm format` from fl_frontend/ when the frontend scope does not run.
"""

from __future__ import annotations

import argparse
import ast
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Final

REPO_ROOT: Final = Path(__file__).resolve().parent.parent

# A CI scope name, mapped to the verify.sh scopes that stand for it.
SCOPE_TRANSLATION: Final[dict[str, tuple[str, ...]]] = {
    "scripts": ("scripts",),
    "docs": ("docs",),
    "backend": ("backend", "db"),
    "frontend": ("frontend",),
    "ops": ("ops",),
    "images": ("images",),
}

# Suffixes a real parser can answer for. Anything absent from here is code.
PARSEABLE: Final[frozenset[str]] = frozenset({".ts", ".tsx", ".mts", ".cts", ".py", ".toml"})

MAX_NAMED_FILES: Final = 8  # a finding names the files; past this it says "and N more"


@dataclass(frozen=True)
class Finding:
    severity: str  # "fail" | "report"
    detail: str


def git(*args: str) -> str | None:
    result = subprocess.run(["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return result.stdout if result.returncode == 0 else None


def resolve_base(base: str) -> str | None:
    """The merge base with `base`, so a local main that has moved on does not read as the diff."""
    for ref in (base, f"origin/{base}"):
        merge_base = git("merge-base", ref, "HEAD")
        if merge_base is not None and merge_base.strip():
            return merge_base.strip()
    return None


def changed_files(base: str) -> list[str]:
    """Everything the branch changed against `base`, including what is not committed yet.

    `git diff <base>` compares that commit to the WORKING TREE, so an edit the author has not staged
    counts - which is the point, since the gate is usually run before the commit.
    """
    tracked = git("diff", "--name-only", base) or ""
    untracked = git("ls-files", "--others", "--exclude-standard") or ""
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
    import tomllib  # 3.11+; the caller treats an ImportError as "cannot prove it"

    return tomllib.loads(old) == tomllib.loads(new)


def typescript_same(suffix: str, old: str, new: str) -> bool:
    """Delegated to TypeScript's own parser - see scripts/ts_normalize.mjs for why not a regex."""
    if shutil.which("node") is None:
        raise RuntimeError("node is not on PATH")
    with tempfile.TemporaryDirectory() as tmp:
        # The real suffix, because ts_normalize.mjs picks its script kind from the extension -- a
        # .tsx written out as .ts parses its JSX as syntax errors and the answer degrades to "code".
        old_path, new_path = Path(tmp) / f"old{suffix}", Path(tmp) / f"new{suffix}"
        old_path.write_text(old, encoding="utf-8")
        new_path.write_text(new, encoding="utf-8")
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
    except SyntaxError, ValueError, ImportError, RuntimeError, OSError:
        # A version that does not parse, a missing toolchain, a tomllib that is not there: none of
        # these is proof of anything, so the change counts as code.
        return False


def is_comment_only(base: str, path: str) -> bool:
    old = git("show", f"{base}:{path}")
    if old is None:  # added on this branch: there is no earlier version to compare against
        return False
    try:
        new = (REPO_ROOT / path).read_text(encoding="utf-8")
    except OSError:  # deleted, or unreadable
        return False
    return same_but_for_comments(Path(path).suffix, old, new)


# --- the mapping ------------------------------------------------------------------------------------


def ci_scopes(files: list[str]) -> dict[str, bool] | None:
    """scripts/ci_scopes.sh over an explicit file list. None when it could not be run at all."""
    bash = shutil.which("bash")
    if bash is None:
        return None
    # Bytes on purpose: text mode translates "\n" to os.linesep on the way in, so on Windows every
    # path but the last reaches the shell with a trailing "\r" -- and a CR-suffixed name matches no
    # exact-name case arm, which turns every scope on via the conservative fallback.
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


def check(base: str, ran: set[str]) -> list[Finding]:
    files = changed_files(base)
    if not files:
        print(f"      no changes against {base[:7]} -- nothing to scope")
        return []

    material = [path for path in files if not is_comment_only(base, path)]
    comment_only = [path for path in files if path not in set(material)]

    required = ci_scopes(material)
    if required is None:
        return [Finding("report", "could not run scripts/ci_scopes.sh -- this run was not checked against the diff")]

    # A comment-only edit is still a documentation change, and still passes through prettier.
    if comment_only:
        required["docs"] = True
        required["format"] = True
        print(f"      {len(comment_only)} file(s) changed by comments alone, so they ask only for --docs:")
        print(f"        {named_list(comment_only)}")

    findings: list[Finding] = []

    for ci_scope, verify_scopes in SCOPE_TRANSLATION.items():
        if not required.get(ci_scope):
            continue
        missing = [scope for scope in verify_scopes if scope not in ran]
        if not missing:
            continue
        flags = " ".join(f"--{scope}" for scope in missing)
        if ci_scope == "images":
            findings.append(
                Finding(
                    "fail",
                    "the image build did not run, and these files ask for it with a change\n"
                    "              that is more than comments:\n"
                    f"                {named_list(images_culprits(material))}\n"
                    f"              Re-run with:  ./scripts/verify.sh {flags}",
                )
            )
        else:
            findings.append(Finding("report", f"the diff asks for {flags}, which did not run"))

    # `format` has no verify.sh flag of its own: the frontend scope's first step is prettier in write
    # mode, and without that scope the formatter is the manual step CLAUDE.md names.
    if required.get("format") and "frontend" not in ran:
        findings.append(Finding("report", "the diff asks for the formatter:  cd fl_frontend && pnpm format  -- then commit what it rewrites"))

    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Is this gate run's scope wide enough for the diff? (ADR-0037)")
    parser.add_argument("--ran", default="", help="the verify.sh scopes this run covers, space- or comma-separated")
    parser.add_argument("--base", default="main", help="base ref for the branch range (default: main)")
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
        return 0

    ran = {scope for scope in args.ran.replace(",", " ").split() if scope}

    base = resolve_base(args.base)
    if base is None:
        print(f"      no merge base with {args.base} -- this run was not checked against the diff")
        return 0

    findings = check(base, ran)
    failures = [finding for finding in findings if finding.severity == "fail"]

    # One stream, failures first. verify.sh prints this straight through rather than capturing it,
    # so interleaving stdout and stderr here would reorder the findings on the terminal.
    for finding in failures:
        print(f"      FAIL    {finding.detail}")
    for finding in findings:
        if finding.severity != "fail":
            print(f"      report  {finding.detail}")

    if failures:
        print("\n      The rule is CLAUDE.md, The gate. Why images fails where the rest report: ADR-0037.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
