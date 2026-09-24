"""SCRIPTS · what the commit hook formats, and what it leaves the author, driven through a real `git commit`.

`.githooks/pre-commit` writes the index and the working copy of a fully staged file, so a regression
either commits bytes the author never staged or overwrites bytes nobody saved anywhere else. A
stand-in prettier package, run by a real node through `.githooks/format-staged.mjs`, makes one
rewrite, so each case reads the exact bytes that land rather than whatever a real formatter would
choose.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Final

from conftest import REPO_ROOT, base_env, configure, git, new_root, write

HOOK: Final = REPO_ROOT / ".githooks" / "pre-commit"
HELPER: Final = REPO_ROOT / ".githooks" / "format-staged.mjs"

# Not a skip condition, as `scripts/tests/conftest.py :: BASH` is not: the hook formats nothing
# without one, and every case below would then pass by asserting on an unformatted commit.
NODE: Final = shutil.which("node")

# The stand-in's one rewrite, and the marker it refuses as prettier refuses a file that will not
# parse.
RAW: Final = "export const v = {a:1};"
FORMATTED: Final = "export const v = { a: 1 };"
UNPARSEABLE: Final = "SYNTAX-ERROR"

# Refuses the options the hook must pass as `pnpm format` would, and reports a file named
# `ignored*` as `.prettierignore` would.
STAND_IN: Final = r"""const fs = require("node:fs");
const path = require("node:path");

exports.getFileInfo = async (file, options) => {
  if (options.ignorePath !== path.resolve("../.prettierignore")) throw new Error(`ignorePath ${options.ignorePath}`);
  return { ignored: path.basename(file).startsWith("ignored"), inferredParser: "typescript" };
};

exports.resolveConfig = async (file, options) => {
  if (options?.editorconfig !== true) throw new Error("resolveConfig without editorconfig");
  return {};
};

exports.format = async (text, options) => {
  if (!path.isAbsolute(options.filepath)) throw new Error(`relative filepath ${options.filepath}`);
  if (text.includes("SYNTAX-ERROR")) {
    const error = new SyntaxError("Unexpected token (1:1)");
    error.loc = { start: { line: 1, column: 1 } };
    throw error;
  }
  // A second writer: each directive appends a line to, respaces or removes the file it names, once.
  for (const [, verb, target] of text.matchAll(/(WRITE-TO|RESPACE|REMOVE):(\S+)/g)) {
    const file = path.resolve("..", target);
    if (!fs.existsSync(file)) continue;
    const now = fs.readFileSync(file, "utf8");
    if (verb === "WRITE-TO" && !now.includes("writer")) fs.appendFileSync(file, "export const writer = 1;\n");
    if (verb === "RESPACE") fs.writeFileSync(file, now.replaceAll("{a:1}", "{a:1 }"));
    if (verb === "REMOVE") fs.rmSync(file);
  }
  return text.replace(/\r\n/g, "\n").replaceAll("{a:1 }", "{a:1}").replaceAll("{a:1}", "{ a: 1 }");
};
"""

WRITER_LINE: Final = b"export const writer = 1;\n"

# The words the race report is found by.
RACED: Final = "while the hook ran"


def _lines(*middle: str, last: str = "export const last = 3;", eol: str = "\n") -> str:
    """A module whose first and last lines sit far enough apart for `git add -p` to offer them as two hunks."""
    gap = [f"export const gap{n} = {n};" for n in range(8)]
    return eol.join(("export const first = 1;", *middle, *gap, last, ""))


def _repository() -> Path:
    """A repository off main with the stand-in prettier installed, committing through the tree's hook.

    The hook and its helper sit in a directory of their own, as when `core.hooksPath` names another
    checkout.
    """
    hooks = new_root("fl-pre-commit-hooks-")
    shutil.copy2(HOOK, hooks / "pre-commit")
    shutil.copy2(HELPER, hooks / "format-staged.mjs")
    root = new_root("fl-pre-commit-format-")
    configure(root, hooks=str(hooks))
    # Off main, where the hook's own refusal would answer every case below before any formatting.
    git(root, "symbolic-ref", "HEAD", "refs/heads/work")
    write(root, ".gitignore", "node_modules/\n")
    write(root, "fl_frontend/node_modules/prettier/package.json", '{"name": "prettier", "main": "index.cjs"}\n')
    write(root, "fl_frontend/node_modules/prettier/index.cjs", STAND_IN)
    write(root, "a.ts", _lines("export const middle = 0;"))
    write(root, "u.ts", "export const u = 1;\n")
    git(root, "add", "-A")
    git(root, "commit", "--no-verify", "-m", "base")
    return root


def _commit(root: Path, *args: str, stdin: str | None = None, index: Path | None = None) -> subprocess.CompletedProcess[str]:
    """`git commit` run to its end, on `index` in place of the repository's own where one is given."""
    assert NODE is not None, "no node on PATH -- the hook formats through one"
    env = base_env()
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


def test_a_working_copy_differing_from_its_staged_copy_by_formatting_alone_is_left_as_it_is() -> None:
    """Both copies format to the same bytes, so only the file's being staged in part keeps the hook off its working copy."""
    root = _repository()
    # So the CRLF copy reads as changed on every platform, as it does wherever git keeps line endings.
    git(root, "config", "core.autocrlf", "false")
    write(root, "a.ts", _lines(RAW))
    git(root, "add", "a.ts")
    write(root, "a.ts", _lines(RAW, eol="\r\n"))
    before = _on_disk(root, "a.ts")
    done = _commit(root)
    assert done.returncode == 0, done.stdout + done.stderr
    assert _committed(root, "a.ts") == _lines(FORMATTED).strip()
    assert _on_disk(root, "a.ts") == before


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


def test_a_file_that_will_not_parse_refuses_the_commit_and_writes_nothing() -> None:
    """Beside a partly staged file and a fully staged one needing formatting, so a refusal after either write shows."""
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
    # The hook's own refusal, not a later step tripping over the files a refused run never wrote.
    assert "bad.ts" in done.stderr and "the commit is refused and nothing was staged" in done.stderr, done.stderr
    assert git(root, "rev-parse", "HEAD") == head
    assert git(root, "ls-files", "-s") == index
    assert _on_disk(root, "a.ts") == in_part
    assert _on_disk(root, "whole.ts") == _lines(RAW).encode()
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
    assert RACED not in done.stderr, done.stderr
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


def test_a_write_landing_while_the_hook_runs_is_kept_and_reported() -> None:
    """Both windows: the formatting of `a.ts`'s own staged copy, and the one between reading `whole.ts` and writing it back.

    `a.ts`'s staged copy is already formatted, so its report must not hang on a restage.
    """
    root = _repository()
    write(root, "a.ts", _lines(FORMATTED, "// WRITE-TO:a.ts"))
    write(root, "whole.ts", _lines(RAW))
    write(root, "z.ts", _lines(RAW, "// WRITE-TO:whole.ts"))
    git(root, "add", "a.ts", "whole.ts", "z.ts")
    done = _commit(root)
    assert done.returncode == 0, done.stdout + done.stderr
    assert _committed(root, "a.ts") == _lines(FORMATTED, "// WRITE-TO:a.ts").strip()
    assert _committed(root, "whole.ts") == _lines(FORMATTED).strip()
    assert _on_disk(root, "a.ts") == _lines(FORMATTED, "// WRITE-TO:a.ts").encode() + WRITER_LINE
    assert _on_disk(root, "whole.ts") == _lines(RAW).encode() + WRITER_LINE
    raced = done.stderr.partition(RACED)[2]
    assert "      a.ts\n" in raced and "      whole.ts\n" in raced, done.stderr


def test_a_file_prettier_ignores_is_committed_as_staged() -> None:
    root = _repository()
    write(root, "ignored.ts", _lines(RAW))
    git(root, "add", "ignored.ts")
    done = _commit(root)
    assert done.returncode == 0, done.stdout + done.stderr
    assert RAW in _committed(root, "ignored.ts")
    assert _on_disk(root, "ignored.ts") == _lines(RAW).encode()


def test_the_helper_is_found_beside_the_hook_and_not_in_the_committing_tree() -> None:
    """The session's shape: `core.hooksPath` names another checkout, and the committing tree holds no helper, or an older one."""
    root = _repository()
    assert not (root / ".githooks").exists()
    write(root, "a.ts", _lines(RAW))
    git(root, "add", "a.ts")
    done = _commit(root)
    assert done.returncode == 0, done.stdout + done.stderr
    assert FORMATTED in _committed(root, "a.ts")


def test_a_refusal_after_formatting_leaves_the_fully_staged_working_copy_unformatted() -> None:
    """`git hash-object` refuses the formatted copy: a clean filter the path now names fails, after git listed the file clean."""
    root = _repository()
    write(root, "whole.ts", _lines(RAW))
    # Older than the index git writes next, so git trusts the file's stat and runs no filter over it.
    past = time.time() - 60
    os.utime(root / "whole.ts", (past, past))
    git(root, "add", "whole.ts")
    git(root, "config", "filter.boom.clean", "false")
    git(root, "config", "filter.boom.required", "true")
    write(root, ".gitattributes", "whole.ts filter=boom\n")
    index = git(root, "ls-files", "-s")
    done = _commit(root)
    assert done.returncode != 0, done.stdout + done.stderr
    assert "could not store the formatted whole.ts" in done.stderr, done.stderr
    assert git(root, "ls-files", "-s") == index
    assert _on_disk(root, "whole.ts") == _lines(RAW).encode()


def test_a_working_copy_edited_or_removed_after_git_listed_it_is_left_and_reported() -> None:
    """`c.ts` is formatted first and plays the writer: `whole.ts` gains an edit changing formatting alone, and `gone.ts` goes."""
    root = _repository()
    write(root, "gone.ts", _lines(RAW))
    write(root, "whole.ts", _lines(RAW))
    write(root, "c.ts", _lines(RAW, "// RESPACE:whole.ts REMOVE:gone.ts"))
    git(root, "add", "c.ts", "gone.ts", "whole.ts")
    done = _commit(root)
    assert done.returncode == 0, done.stdout + done.stderr
    assert _committed(root, "whole.ts") == _lines(FORMATTED).strip()
    assert _committed(root, "gone.ts") == _lines(FORMATTED).strip()
    assert _on_disk(root, "whole.ts") == _lines(RAW.replace("{a:1}", "{a:1 }")).encode()
    assert not (root / "gone.ts").exists()
    raced = done.stderr.partition(RACED)[2]
    assert "      whole.ts\n" in raced and "      gone.ts\n" in raced, done.stderr
