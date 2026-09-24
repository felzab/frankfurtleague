"""SCRIPTS · what the commit hook formats, and what it leaves the author, driven through a real `git commit`.

`.githooks/pre-commit` writes the index and the working copy of a fully staged file, so a regression
either commits bytes the author never staged or overwrites bytes nobody saved anywhere else. A
stand-in `node` plays prettier with one rewrite, so each case reads the exact bytes that land rather
than whatever a real formatter would choose.
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

# Line endings go to LF, as the repository's `endOfLine` sends them.
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
  exec sed 's/\r$//; s/{a:1}/{ a: 1 }/g' "$input"
fi
rc=0
for f in "${files[@]}"; do
  if grep -q SYNTAX-ERROR "$f"; then rc=2; continue; fi
  sed -i 's/\r$//; s/{a:1}/{ a: 1 }/g' "$f"
done
exit "$rc"
"""


def _lines(*middle: str, last: str = "export const last = 3;", eol: str = "\n") -> str:
    """A module whose first and last lines sit far enough apart for `git add -p` to offer them as two hunks."""
    gap = [f"export const gap{n} = {n};" for n in range(8)]
    return eol.join(("export const first = 1;", *middle, *gap, last, ""))


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


def _commit(root: Path, *args: str, stdin: str | None = None, index: Path | None = None) -> subprocess.CompletedProcess[str]:
    """`git commit` run to its end with the stand-in first on PATH, on `index` in place of the repository's own where one is given."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    stand_in = root / "bin"
    stand_in.mkdir(exist_ok=True)
    os.chmod(write_shell(stand_in / "node", STAND_IN), 0o755)
    env = base_env()
    env["PATH"] = str(stand_in) + os.pathsep + env["PATH"]
    if index is not None:
        # Spelled with `/` on every platform, as git spells the paths it builds itself.
        env["GIT_INDEX_FILE"] = index.as_posix()
    return subprocess.run(
        ("git", "commit", "-m", "probe", *args),
        cwd=root,
        env=env,
        input=stdin,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def _committed(root: Path, rel: str) -> str:
    return git(root, "show", f"HEAD:{rel}")


def _on_disk(root: Path, rel: str) -> bytes:
    return (root / rel).read_bytes()


def _stage_in_part(root: Path, rel: str = "a.ts", eol: str = "\n") -> bytes:
    """`rel` staged holding `RAW`, with an unstaged edit to its last line; answers the working copy's bytes."""
    write(root, rel, _lines(RAW, eol=eol))
    git(root, "add", rel)
    write(root, rel, _lines(RAW, last="export const last = 4000;", eol=eol))
    return _on_disk(root, rel)


def test_a_fully_staged_file_is_committed_formatted_and_left_formatted_on_disk() -> None:
    root = _repository()
    write(root, "a.ts", _lines(RAW))
    git(root, "add", "a.ts")
    done = _commit(root)
    assert done.returncode == 0, done.stdout + done.stderr
    assert FORMATTED in _committed(root, "a.ts")
    assert _on_disk(root, "a.ts") == _lines(FORMATTED).encode()


def test_a_partly_staged_file_commits_its_staged_half_formatted_and_its_working_copy_is_never_written() -> None:
    root = _repository()
    before = _stage_in_part(root)
    done = _commit(root)
    assert done.returncode == 0, done.stdout + done.stderr
    assert _committed(root, "a.ts") == _lines(FORMATTED).strip()
    assert _on_disk(root, "a.ts") == before
    assert "left as it is" in done.stderr, done.stderr


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


def test_a_staged_copy_already_formatted_is_committed_as_staged_and_its_unformatted_rest_left() -> None:
    root = _repository()
    write(root, "a.ts", _lines(FORMATTED))
    git(root, "add", "a.ts")
    staged = git(root, "ls-files", "-s", "a.ts")
    edited = _lines(FORMATTED, RAW).encode()
    (root / "a.ts").write_bytes(edited)
    done = _commit(root)
    assert done.returncode == 0, done.stdout + done.stderr
    assert git(root, "ls-files", "-s", "a.ts") == staged
    assert _on_disk(root, "a.ts") == edited
    assert "formatted from the index" not in done.stderr, done.stderr


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
    """`git commit -- <path>` formats a temporary index; left there alone, the next commit reads a split nobody made."""
    root = _repository()
    write(root, "a.ts", _lines(RAW))
    done = _commit(root, "--", "a.ts")
    assert done.returncode == 0, done.stdout + done.stderr
    assert git(root, "diff", "--cached", "--name-only") == ""
    assert git(root, "diff", "--name-only") == ""


def test_an_index_of_the_callers_own_named_like_a_lock_leaves_no_lock_behind() -> None:
    """Only git's own temporary index, beside a lock git really holds, takes the second write.

    Written unasked, the default lock is created, and every later git command is refused.
    """
    # `-a` hands the hook an index named like a lock that is not git's temporary one; the path
    # commit hands it git's temporary one while the lock git holds is on the caller's index.
    for args in (("-a",), ("--", "a.ts")):
        root = _repository()
        own = root / "own.lock"
        shutil.copy2(root / ".git" / "index", own)
        write(root, "a.ts", _lines(RAW))
        done = _commit(root, *args, index=own)
        assert done.returncode == 0, done.stdout + done.stderr
        assert not (root / ".git" / "index.lock").exists(), args


def test_a_stale_default_lock_beside_an_index_in_the_git_directory_is_left_as_it_was() -> None:
    """The case only the name test refuses.

    The index given sits in the git directory, and a lock exists at the default path, left by a git that died.
    """
    root = _repository()
    shutil.copy2(root / ".git" / "index", root / ".git" / "alt")
    stale = root / ".git" / "index.lock"
    shutil.copy2(root / ".git" / "index", stale)
    before = stale.read_bytes()
    write(root, "a.ts", _lines(RAW))
    done = _commit(root, "-a", index=root / ".git" / "alt")
    assert done.returncode == 0, done.stdout + done.stderr
    assert stale.read_bytes() == before


def test_a_file_that_will_not_parse_refuses_the_commit_and_stages_nothing() -> None:
    """Beside a partly staged file and a fully staged one needing formatting, so a restage of either shows."""
    root = _repository()
    head = git(root, "rev-parse", "HEAD")
    in_part = _stage_in_part(root)
    write(root, "whole.ts", _lines(RAW))
    write(root, "bad.ts", UNPARSEABLE + "\n")
    git(root, "add", "bad.ts", "whole.ts")
    write(root, "u.ts", "export const u = 2;\n")
    index = git(root, "ls-files", "-s")
    done = _commit(root)
    assert done.returncode != 0, done.stdout + done.stderr
    assert git(root, "rev-parse", "HEAD") == head
    assert git(root, "ls-files", "-s") == index
    assert _on_disk(root, "a.ts") == in_part
    assert _on_disk(root, "u.ts") == b"export const u = 2;\n"


def test_commit_all_formats_every_modified_file_in_the_commit_and_on_disk() -> None:
    root = _repository()
    write(root, "a.ts", _lines(RAW))
    done = _commit(root, "-a")
    assert done.returncode == 0, done.stdout + done.stderr
    assert FORMATTED in _committed(root, "a.ts")
    assert _on_disk(root, "a.ts") == _lines(FORMATTED).encode()


def test_commit_patch_commits_the_chosen_hunk_formatted_and_leaves_the_working_copy() -> None:
    """`git commit -p` answered from stdin: the first hunk taken, the second left unstaged."""
    root = _repository()
    write(root, "a.ts", _lines(RAW, last="export const last = 4000;"))
    before = _on_disk(root, "a.ts")
    done = _commit(root, "-p", stdin="y\nn\n")
    assert done.returncode == 0, done.stdout + done.stderr
    assert _committed(root, "a.ts") == _lines(FORMATTED).strip()
    assert _on_disk(root, "a.ts") == before


def test_an_amend_commits_the_staged_file_formatted() -> None:
    root = _repository()
    count = git(root, "rev-list", "--count", "HEAD")
    write(root, "a.ts", _lines(RAW))
    git(root, "add", "a.ts")
    done = _commit(root, "--amend")
    assert done.returncode == 0, done.stdout + done.stderr
    assert FORMATTED in _committed(root, "a.ts")
    assert git(root, "rev-list", "--count", "HEAD") == count


def test_a_name_with_a_space_and_one_opening_with_a_dash_are_formatted() -> None:
    root = _repository()
    for rel in ("a b.ts", "-dash.ts"):
        write(root, rel, _lines(RAW))
    git(root, "add", "--", "a b.ts", "-dash.ts")
    done = _commit(root)
    assert done.returncode == 0, done.stdout + done.stderr
    # A path read as an option fails a comparison, which reads as a writer's race.
    assert "written while" not in done.stderr, done.stderr
    for rel in ("a b.ts", "-dash.ts"):
        assert FORMATTED in _committed(root, rel), rel
        assert _on_disk(root, rel) == _lines(FORMATTED).encode(), rel


def test_a_crlf_working_copy_is_formatted_when_fully_staged_and_left_when_staged_in_part() -> None:
    """`eol=lf` stores LF and leaves the CRLF copy reading as clean, so the whole file's disk text differs from its staged text."""
    root = _repository()
    write(root, ".gitattributes", "*.ts text eol=lf\n")
    write(root, "whole.ts", _lines(RAW, eol="\r\n"))
    git(root, "add", ".gitattributes", "whole.ts")
    in_part = _stage_in_part(root, eol="\r\n")
    done = _commit(root)
    assert done.returncode == 0, done.stdout + done.stderr
    assert _committed(root, "whole.ts") == _lines(FORMATTED).strip()
    assert _on_disk(root, "whole.ts") == _lines(FORMATTED).encode()
    assert _committed(root, "a.ts") == _lines(FORMATTED).strip()
    assert _on_disk(root, "a.ts") == in_part
