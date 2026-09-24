"""SCRIPTS · what the commit hook formats, and what it leaves the author, driven through a real `git commit`.

`.githooks/pre-commit` writes the index and, for a file staged in part, a working copy holding work
nobody has committed, so a regression either commits bytes the author never staged or loses bytes
nobody saved anywhere else. A stand-in `node` plays prettier with one rewrite, so each case reads the
exact bytes that land rather than whatever a real formatter would choose.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Final

from conftest import BASH, REPO_ROOT, base_env, configure, git, new_root, write, write_shell

HOOK: Final = REPO_ROOT / ".githooks" / "pre-commit"


# The stand-in's one rewrite, and the marker it refuses as prettier refuses a file that will not
# parse, with its exit 2.
RAW: Final = "export const v = {a:1};"
FORMATTED: Final = "export const v = { a: 1 };"
UNPARSEABLE: Final = "SYNTAX-ERROR"

STAND_IN: Final = r"""#!/usr/bin/env bash
set -u
shift
mode=write
files=()
while [ $# -gt 0 ]; do
  case $1 in
    --stdin-filepath | --log-level | --ignore-path) [ "$1" = --stdin-filepath ] && mode=stdin; shift 2 ;;
    --*) shift ;;
    *) files+=("$1"); shift ;;
  esac
done
if [ "$mode" = stdin ]; then
  input="$(mktemp)"
  cat > "$input"
  if grep -q SYNTAX-ERROR "$input"; then exit 2; fi
  exec sed 's/{a:1}/{ a: 1 }/g' "$input"
fi
rc=0
for f in "${files[@]}"; do
  if grep -q SYNTAX-ERROR "$f"; then rc=2; continue; fi
  sed -i 's/{a:1}/{ a: 1 }/g' "$f"
done
exit "$rc"
"""


def _lines(*middle: str) -> str:
    """A five-line module whose first and last lines stay apart, so an edit to one never touches the other."""
    return "\n".join(("export const first = 1;", *middle, "export const gap = 2;", "export const last = 3;", ""))


def _repository() -> Path:
    """A repository off main whose only hook is the tree's `pre-commit`, with the stand-in prettier installed."""
    root = new_root("fl-pre-commit-format-")
    (root / ".githooks").mkdir()
    shutil.copy2(HOOK, root / ".githooks" / "pre-commit")
    configure(root, hooks=str(root / ".githooks"))
    # Off main, where the hook's own refusal would answer every case below before any formatting.
    git(root, "symbolic-ref", "HEAD", "refs/heads/work")
    write(root, ".gitignore", "node_modules/\n")
    write(root, "fl_frontend/node_modules/prettier/bin/prettier.cjs", "")
    write(root, "a.ts", _lines("export const middle = 0;"))
    write(root, "u.ts", "export const u = 1;\n")
    git(root, "add", "-A")
    git(root, "commit", "--no-verify", "-m", "base")
    return root


def _commit(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """`git commit` run to its end with the stand-in first on PATH."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    stand_in = root / "bin"
    stand_in.mkdir(exist_ok=True)
    os.chmod(write_shell(stand_in / "node", STAND_IN), 0o755)
    env = base_env()
    env["PATH"] = str(stand_in) + os.pathsep + env["PATH"]
    return subprocess.run(
        ("git", "commit", "-m", "probe", *args), cwd=root, env=env, capture_output=True, encoding="utf-8", errors="replace", check=False
    )


def _committed(root: Path, rel: str) -> str:
    return git(root, "show", f"HEAD:{rel}")


def _on_disk(root: Path, rel: str) -> bytes:
    return (root / rel).read_bytes()


def test_a_fully_staged_file_is_committed_formatted_and_left_formatted_on_disk() -> None:
    root = _repository()
    write(root, "a.ts", _lines(RAW))
    git(root, "add", "a.ts")
    done = _commit(root)
    assert done.returncode == 0, done.stdout + done.stderr
    assert FORMATTED in _committed(root, "a.ts")
    assert _on_disk(root, "a.ts") == _lines(FORMATTED).encode()


def test_a_partly_staged_file_commits_only_its_staged_half_and_keeps_the_rest_on_disk() -> None:
    root = _repository()
    write(root, "a.ts", _lines(RAW))
    git(root, "add", "a.ts")
    write(root, "a.ts", _lines(RAW).replace("last = 3", "last = 4000"))
    done = _commit(root)
    assert done.returncode == 0, done.stdout + done.stderr
    assert _committed(root, "a.ts") == _lines(FORMATTED).strip()
    assert _on_disk(root, "a.ts") == _lines(FORMATTED).replace("last = 3", "last = 4000").encode()


def test_an_unstaged_edit_the_formatting_overlaps_is_left_byte_for_byte() -> None:
    """The re-apply conflict: a tool that stashes or resets here is the one that loses the edit."""
    root = _repository()
    write(root, "a.ts", _lines(RAW))
    git(root, "add", "a.ts")
    edited = _lines(RAW.replace("{a:1}", "{a:1, b:2}")).encode()
    (root / "a.ts").write_bytes(edited)
    done = _commit(root)
    assert done.returncode == 0, done.stdout + done.stderr
    assert FORMATTED in _committed(root, "a.ts")
    assert _on_disk(root, "a.ts") == edited


def test_a_file_staged_then_deleted_on_disk_is_committed_formatted_and_stays_deleted() -> None:
    root = _repository()
    write(root, "a.ts", _lines(RAW))
    git(root, "add", "a.ts")
    (root / "a.ts").unlink()
    done = _commit(root)
    assert done.returncode == 0, done.stdout + done.stderr
    assert FORMATTED in _committed(root, "a.ts")
    assert not (root / "a.ts").exists()


def test_a_path_commit_leaves_the_real_index_holding_what_it_committed() -> None:
    """`git commit -- <path>` formats a temporary index; left there alone, the next commit is refused over a split nobody made."""
    root = _repository()
    write(root, "a.ts", _lines(RAW))
    done = _commit(root, "--", "a.ts")
    assert done.returncode == 0, done.stdout + done.stderr
    assert git(root, "diff", "--cached", "--name-only") == ""
    assert git(root, "diff", "--name-only") == ""


def test_a_file_that_will_not_parse_refuses_the_commit_and_leaves_other_work_alone() -> None:
    root = _repository()
    head = git(root, "rev-parse", "HEAD")
    write(root, "bad.ts", UNPARSEABLE + "\n")
    write(root, "a.ts", _lines(RAW))
    git(root, "add", "bad.ts", "a.ts")
    write(root, "u.ts", "export const u = 2;\n")
    done = _commit(root)
    assert done.returncode != 0, done.stdout + done.stderr
    assert git(root, "rev-parse", "HEAD") == head
    assert _on_disk(root, "u.ts") == b"export const u = 2;\n"
