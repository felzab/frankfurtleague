"""SCRIPTS · the commit-msg hook, the only reader of a commit message (R578), driven through real commits.

The `Closes:` trailer is judged against the staged diff, which is the new commit's own diff for a
plain commit, a `-C` commit after `cherry-pick -n` (the landing flow) and a `-F` commit after
`reset --soft`, and is not under `--amend`. Each way of committing is driven here through the tree's
own hook, so a regression in the hook, in the checker or in what git stages reads as a failure
rather than as a pass.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Final

from conftest import REPO_ROOT, configure, copy_scripts, git, new_root, write

HOOK: Final = REPO_ROOT / ".githooks" / "commit-msg"
ENTRIES: Final = "docs/_roadmap/items.md"
TOKEN: Final = "h7k2-qm4p"
# Built rather than typed, as `scripts/tests/test_message_gates.py` builds it.
MIDDLE_DOT: Final = chr(0xB7)
BODY: Final = "The entry's work landed, and the run returned exit 0."

CLOSING: Final = f"Docs: The sample entry is retired\n\n{BODY}\n\nCloses: {TOKEN}\n"
SILENT: Final = f"Docs: The sample entry is retired\n\n{BODY}\n"
# The words each outcome is read by: a hook failing for any other reason exits non-zero too.
MISSING_TRAILER: Final = "carries no `Closes:` trailer"
SPURIOUS_TRAILER: Final = "this commit retires no roadmap entry"
AMEND_HINT: Final = "amending? redo it as git reset --soft HEAD~1, then git commit -F"


def _environment() -> dict[str, str]:
    """This interpreter's directory first, so the hook finds a python at the checkers' floor on any runner."""
    env = dict(os.environ)
    env["PATH"] = str(Path(sys.executable).parent) + os.pathsep + env.get("PATH", "")
    return env


def _repository() -> Path:
    """A fresh repository carrying the tree's hook and checker, and one roadmap entry on main."""
    root = new_root("fl-commit-msg-")
    (root / ".githooks").mkdir()
    shutil.copy2(HOOK, root / ".githooks" / "commit-msg")
    copy_scripts(root / "scripts")
    configure(root, hooks=str(root / ".githooks"))
    write(root, ENTRIES, f"# Items\n\n### `{TOKEN}` {MIDDLE_DOT} A sample claim\n")
    git(root, "add", "-A")
    git(root, "commit", "-q", "--no-verify", "-m", "Docs: The roadmap holds one entry", "-m", BODY)
    git(root, "checkout", "-q", "-b", "topic")
    return root


def _retire(root: Path) -> None:
    """Stage the entry's removal, which is what asks the message for a `Closes:` trailer."""
    write(root, ENTRIES, "# Items\n\nNothing is open.\n")
    git(root, "add", "-A")


def _message_file(root: Path, message: str) -> Path:
    path = root.parent / f"{root.name}-message.txt"
    path.write_bytes(message.encode("utf-8"))
    return path


def _git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """One git command run to its end with the hook live: a refusal is the exit code, never a raise."""
    return subprocess.run(("git", *args), cwd=root, capture_output=True, encoding="utf-8", errors="replace", env=_environment(), check=False)


def _head(root: Path) -> str:
    return git(root, "rev-parse", "HEAD")


def test_a_plain_commit_is_judged_against_its_own_diff() -> None:
    root = _repository()
    _retire(root)
    before = _head(root)
    refused = _git(root, "commit", "-F", str(_message_file(root, SILENT)))
    assert refused.returncode != 0, refused.stdout + refused.stderr
    assert MISSING_TRAILER in refused.stderr, refused.stderr
    assert _head(root) == before, "a refused commit landed"
    passed = _git(root, "commit", "-F", str(_message_file(root, CLOSING)))
    assert passed.returncode == 0, passed.stdout + passed.stderr


def test_the_landing_flow_reads_the_landed_commit_s_diff_exactly() -> None:
    """`cherry-pick -n` then `commit -C <sha>` is how a commit becomes permanent here, so this is the case that binds."""
    root = _repository()
    _retire(root)
    git(root, "commit", "-q", "--no-verify", "-F", str(_message_file(root, SILENT)))
    silent = _head(root)
    git(root, "commit", "-q", "--no-verify", "--amend", "-F", str(_message_file(root, CLOSING)))
    closing = _head(root)
    git(root, "checkout", "-q", "main")
    git(root, "checkout", "-q", "-b", "landing")
    git(root, "cherry-pick", "-n", silent)
    refused = _git(root, "commit", "-C", silent)
    assert refused.returncode != 0, refused.stdout + refused.stderr
    assert MISSING_TRAILER in refused.stderr, refused.stderr
    passed = _git(root, "commit", "-C", closing)
    assert passed.returncode == 0, passed.stdout + passed.stderr


def test_a_commit_after_a_soft_reset_is_judged_against_the_whole_change() -> None:
    """The route an amend's refusal names: the index then holds the change against its parent."""
    root = _repository()
    _retire(root)
    git(root, "commit", "-q", "--no-verify", "-F", str(_message_file(root, SILENT)))
    git(root, "reset", "-q", "--soft", "HEAD~1")
    refused = _git(root, "commit", "-F", str(_message_file(root, SILENT)))
    assert refused.returncode != 0, refused.stdout + refused.stderr
    assert MISSING_TRAILER in refused.stderr, refused.stderr
    passed = _git(root, "commit", "-F", str(_message_file(root, CLOSING)))
    assert passed.returncode == 0, passed.stdout + passed.stderr


def test_an_amend_of_a_closing_commit_is_refused_and_names_the_route_that_passes() -> None:
    """The one false refusal: under `--amend` git stages against the commit being replaced, and nothing tells the hook."""
    root = _repository()
    _retire(root)
    made = _git(root, "commit", "-F", str(_message_file(root, CLOSING)))
    assert made.returncode == 0, made.stdout + made.stderr
    amended = _git(root, "commit", "--amend", "-F", str(_message_file(root, CLOSING)))
    assert amended.returncode != 0, amended.stdout + amended.stderr
    assert SPURIOUS_TRAILER in amended.stderr, amended.stderr
    assert AMEND_HINT in amended.stderr, amended.stderr


def test_a_finding_the_checker_only_reports_prints_on_a_commit_it_lets_through() -> None:
    """Nothing reads a message after the hook, so a report is seen here or not at all."""
    root = _repository()
    write(root, "notes.txt", "a change\n")
    git(root, "add", "-A")
    subject = "Docs: " + "a subject running past the width GitHub shows in a list view of titles"
    assert len(subject) > 72
    done = _git(root, "commit", "-F", str(_message_file(root, f"{subject}\n\n{BODY}\n")))
    assert done.returncode == 0, done.stdout + done.stderr
    assert "commit-msg notice:" in done.stderr and "GitHub truncates a title" in done.stderr, done.stderr
