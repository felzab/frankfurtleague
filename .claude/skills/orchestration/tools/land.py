"""ORCHESTRATION · one finished agent branch merged into the session branch.

`git merge --no-ff` brings the branch in whole: the agent's commits keep the hooks they ran in its
worktree, and the merge commit takes git's own message, which `commit-msg` leaves to git. A conflict
in a generated document is answered by regenerating it from the merged code, one inside a markdown
table by row key where a column names one row, and any other aborts the merge and goes back to the
agent. A merge touching `fl_backend/` regenerates both documents either way: two branches each
carrying a current document can merge cleanly into one that is not.

    uv run --project fl_backend --frozen python .claude/skills/orchestration/tools/land.py <branch>

`EXITS` gives each exit; every stop past the refusals leaves the merge aborted and the tree clean.
"""

from __future__ import annotations

import io
import re
import subprocess
import sys
from pathlib import Path
from typing import Final

# Run as a script, python seeds this file's own directory on the path.
from merge_rows import merge_file

# Each document beside the module that writes it, run from `fl_backend` by the interpreter running
# this tool: the backend's virtualenv, which `uv run --project fl_backend` selects.
GENERATED: Final = (
    ("tests.openapi_document", "fl_backend/openapi.json"),
    ("tests.einwilligung_document", "fl_backend/einwilligung.json"),
)
REGENERATED_FROM: Final = "fl_backend/"
EXITS: Final = {
    0: "merged, or nothing to merge",
    2: "refused before the merge",
    3: "a conflict the tool cannot settle; the merge is aborted, for the agent to rebase",
    4: "a regeneration failed; the merge is aborted",
    6: "a hook refused the merge commit; the merge is aborted",
    7: "git failed during the merge; read `git status`",
}


class Stop(Exception):
    """A landing that cannot go on: its exit code and the lines the coordinator reads."""

    def __init__(self, code: int, *lines: str) -> None:
        super().__init__(lines[0] if lines else "")
        self.code = code
        self.lines = lines


def git(*args: str, check: bool = True) -> str:
    done = subprocess.run(("git", *args), capture_output=True, check=False)
    out = done.stdout.decode("utf-8", "replace")
    if check and done.returncode != 0:
        raise Stop(2, f"git {' '.join(args)} exited {done.returncode}: {done.stderr.decode('utf-8', 'replace').strip()}")
    return out


def _ok(*args: str) -> bool:
    return subprocess.run(("git", *args), capture_output=True, check=False).returncode == 0


def preflight(branch: str) -> None:
    """Every state in which a merge would take the wrong thing, ruled out before it starts."""
    if not _ok("show-ref", "--verify", "--quiet", f"refs/heads/{branch}"):
        raise Stop(2, f"{branch} is no local branch")
    if git("status", "--porcelain").strip():
        raise Stop(2, "this checkout holds changes, which the merge commit would take in: land from a clean tree")
    for block in git("worktree", "list", "--porcelain").split("\n\n"):
        fields = dict(line.split(" ", 1) for line in block.splitlines() if " " in line)
        if fields.get("branch") == f"refs/heads/{branch}" and git("-C", fields["worktree"], "status", "--porcelain").strip():
            raise Stop(2, f"{fields['worktree']} holds uncommitted work, which no merge takes: the agent commits it first")
    # git names a stash "On <branch>:" when given a message and "WIP on <branch>:" when not.
    if re.search(rf"(?:^|: )(?:WIP on|On) {re.escape(branch)}:", git("stash", "list"), re.MULTILINE):
        raise Stop(2, f"a stash entry is on {branch}, and a stashed edit lands nowhere: the agent commits or drops it first")
    # A patch landed twice merges clean as text, and a later edit to one copy doubled a hunk unseen;
    # a rebase drops the copy, a merge of the session branch keeps it.
    twins = [line[2:] for line in git("cherry", "-v", "HEAD", branch).splitlines() if line.startswith("- ")]
    if twins:
        raise Stop(
            2,
            f"{branch} carries {len(twins)} commit(s) whose patch the session branch already holds under another hash:",
            *twins,
            "the agent rebases onto the session branch, which drops them",
        )


def resolve(conflicted: list[str], written: list[str]) -> list[str]:
    """Each conflict settled and staged, a generated document left to the regeneration; the merges made."""
    generated = {document for _, document in GENERATED}
    merged: list[str] = []
    for path in conflicted:
        if path in generated:
            continue
        if not path.endswith(".md"):
            raise Stop(3, f"CONFLICT in {path}, which is no markdown table")
        # The merge-base's version, and the agent branch's, from the index's conflict stages. Whatever
        # goes wrong inside the row merge stops like a conflict, so no traceback leaves it half done.
        written.append(path)
        try:
            merge = merge_file(path, ":1", ":3")
        except Exception as failed:
            raise Stop(3, f"CONFLICT in {path}", f"{type(failed).__name__}: {failed}") from None
        if merge.text is None:
            raise Stop(3, f"CONFLICT in {path}", *merge.conflicts)
        git("add", "--", path)
        merged += [f"{path}: {line}" for line in merge.done]
    return merged


def regenerate(root: Path, written: list[str]) -> list[str]:
    """Each generated document rewritten and staged; the ones whose merged content the regeneration changed."""
    before = {document: git("ls-files", "--stage", "--", document) for _, document in GENERATED}
    for module, document in GENERATED:
        written.append(document)
        done = subprocess.run((sys.executable, "-m", module, "--write"), cwd=root / "fl_backend", capture_output=True, check=False)
        if done.returncode != 0:
            said = (done.stderr or done.stdout).decode("utf-8", "replace").strip().splitlines()[-5:]
            raise Stop(4, f"{module} --write exited {done.returncode}:", *said)
        git("add", "--", document)
    return [document for _, document in GENERATED if git("ls-files", "--stage", "--", document) != before[document]]


def land(branch: str) -> int:
    root = Path(git("rev-parse", "--show-toplevel").strip())
    preflight(branch)
    if _ok("merge-base", "--is-ancestor", branch, "HEAD"):
        print(f"nothing to land: the session branch already holds {branch}")
        return 0
    written: list[str] = []
    try:
        merged: list[str] = []
        if not _ok("merge", "--no-ff", "--no-commit", branch):
            conflicted = git("diff", "--name-only", "--diff-filter=U").split()
            if not conflicted:
                raise Stop(7, f"git merge --no-ff --no-commit {branch} failed with no file in conflict")
            merged = resolve(conflicted, written)
        touched = git("diff", "--cached", "--name-only", "HEAD").split()
        moved = regenerate(root, written) if any(path.startswith(REGENERATED_FROM) for path in touched) else []
        if git("diff", "--name-only", "--diff-filter=U").split():
            raise Stop(3, "a conflict is still unresolved after the regeneration")
        done = subprocess.run(("git", "commit", "-q", "--no-edit"), capture_output=True, check=False)
        if done.returncode != 0:
            raise Stop(
                6, f"the merge commit was refused (exit {done.returncode})", (done.stdout + done.stderr).decode("utf-8", "replace").strip()
            )
    except Stop as stop:
        if stop.code == 2:
            stop.code = 7
        git("merge", "--abort", check=False)
        # The abort keeps unstaged edits, and the preflight found the tree clean, so every file still
        # dirty that this run wrote is this run's own, put back to `HEAD`.
        dirty = {line[3:] for line in git("status", "--porcelain", check=False).splitlines()}
        mine = sorted(dirty & set(written))
        if mine:
            git("restore", "--source=HEAD", "--staged", "--worktree", "--", *mine, check=False)
        stop.lines = (
            *stop.lines,
            "the merge is aborted" if not git("status", "--porcelain").strip() else "read `git status` before anything else",
        )
        raise
    notes = [f"regenerated {', '.join(Path(document).name for document in moved)}"] if moved else []
    notes += [f"merged by row key: {'; '.join(merged)}"] if merged else []
    print(f"landed {branch} as {git('rev-parse', '--short', 'HEAD').strip()}" + (f" ({'; '.join(notes)})" if notes else ""))
    return 0


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(__doc__, file=sys.stderr)
        print("\n".join(f"  exit {code}: {meaning}" for code, meaning in EXITS.items()), file=sys.stderr)
        return 2
    try:
        return land(argv[0])
    except Stop as stop:
        for line in stop.lines:
            print(line, file=sys.stderr)
        return stop.code


if __name__ == "__main__":
    # A Windows pipe takes the console's codepage, which cannot encode every character git prints.
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
