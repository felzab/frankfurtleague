"""ORCHESTRATION · an agent's commits landed one by one, through the hooks, from a recorded tip.

Each commit after `<from>` is picked with `git cherry-pick -n` and committed with `git commit -F`, so
`.githooks/pre-commit` and `commit-msg` run on every one, under the agent's authorship. The generated
documents agents never commit are regenerated into each commit touching `fl_backend/`, and a body's
sentence deferring them to landing is rewritten to what the landing did. A spec-sheet table conflict
resolves by row key; any other conflict stops the landing with nothing of that commit staged.

    uv run --project fl_backend --frozen python .claude/skills/orchestration/tools/land.py <from> <branch>

`<from>` is the merge-base on a first landing and the recorded tip after it. Exit 0 landed, 2 refused
before any pick, 3 a conflict, 4 a regeneration failed, 5 a body disagrees with its landed diff, 6 a
hook refused the commit. 4 to 6 leave that commit staged, 5 and 6 naming its message file, and every
exit from 3 up names the tip the landings before it took.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
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

# The sentence `.claude/agents/implementer.md` section 5 gives an agent for a document it moved and
# did not commit, and the longer form a brief may still ask for.
AT_LANDING_RE: Final = re.compile(
    r"`(?P<doc>fl_backend/[a-z_]+\.json)`\s+(?:is\s+regenerated\s+at\s+landing"
    r"|is\s+not\s+moved\s+here;\s+it\s+needs\s+regenerating\s+at\s+landing)\."
)
BODY_WIDTH: Final = 76
LIST_LINE_RE: Final = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s|^\s")


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


def preflight(start: str, branch: str) -> list[str]:
    """The commits to land, oldest first, once every state that would land the wrong thing is ruled out."""
    if git("status", "--porcelain").strip():
        raise Stop(2, "this checkout holds changes: -n picks onto whatever the index holds, so land from a clean tree")
    if not _ok("merge-base", "--is-ancestor", start, branch):
        raise Stop(
            2,
            f"{branch} does not contain {start}: its agent rewrote it.",
            f"`git range-diff {start}...{branch}` names the commits no landing took; land each as <sha>~1 <sha>.",
        )
    if _ok("show-ref", "--verify", "--quiet", f"refs/heads/{branch}"):
        for block in git("worktree", "list", "--porcelain").split("\n\n"):
            fields = dict(line.split(" ", 1) for line in block.splitlines() if " " in line)
            if fields.get("branch") == f"refs/heads/{branch}" and git("-C", fields["worktree"], "status", "--porcelain").strip():
                raise Stop(2, f"{fields['worktree']} holds uncommitted work, which no landing takes: the agent commits it first")
        if f"On {branch}:" in git("stash", "list"):
            raise Stop(2, f"a stash entry is on {branch}, and a stashed edit lands nowhere: the agent commits or drops it first")
    commits = git("rev-list", "--reverse", f"{start}..{branch}").split()
    if git("rev-list", "--merges", f"{start}..{branch}").split():
        raise Stop(2, f"{start}..{branch} holds a merge commit, which a pick cannot land whole: the agent rebases it away")
    return commits


def pick(commit: str) -> list[str]:
    """One commit applied to the index and tree, its table conflicts merged by row key; the merges it made."""
    if _ok("cherry-pick", "-n", f"{commit}~1..{commit}"):
        return []
    conflicted = git("diff", "--name-only", "--diff-filter=U").split()
    merged: list[str] = []
    for path in conflicted:
        if not path.endswith(".md"):
            break
        merge = merge_file(path, f"{commit}~1", commit)
        if merge.text is None:
            break
        merged += [f"{path}: {line}" for line in merge.done]
    else:
        if conflicted:
            git("add", "--", *conflicted)
            git("cherry-pick", "--quit")
            return merged
    git("cherry-pick", "--abort", check=False)
    raise Stop(3, f"CONFLICT landing {commit}: {', '.join(conflicted) or 'no file named'}; nothing of it is staged")


def regenerate(root: Path) -> list[str]:
    """Each generated document rewritten and staged; the ones whose content moved."""
    for module, document in GENERATED:
        done = subprocess.run((sys.executable, "-m", module, "--write"), cwd=root / "fl_backend", capture_output=True, check=False)
        if done.returncode != 0:
            said = (done.stderr or done.stdout).decode("utf-8", "replace").strip().splitlines()[-5:]
            raise Stop(4, f"{module} --write exited {done.returncode}:", *said)
        git("add", "--", document)
    staged = set(git("diff", "--cached", "--name-only").split())
    return [document for _, document in GENERATED if document in staged]


def _rewrap(paragraph: str) -> str:
    # A list or an indented block keeps its lines: joining them would turn its items into prose.
    if any(LIST_LINE_RE.match(line) for line in paragraph.splitlines()):
        return paragraph
    return textwrap.fill(" ".join(paragraph.split()), BODY_WIDTH, break_long_words=False, break_on_hyphens=False)


def body_for(message: str, staged: set[str]) -> str:
    """The commit's message with each deferred-document sentence made true of the landed diff."""
    paragraphs = message.rstrip("\n").split("\n\n")
    for document in (document for _, document in GENERATED):
        said = [k for k, paragraph in enumerate(paragraphs) for found in AT_LANDING_RE.finditer(paragraph) if found["doc"] == document]
        moved = document in staged
        if said and not moved:
            raise Stop(5, f"the body says {document} is regenerated at landing, and the landing leaves it unchanged")
        if moved and not said and document not in message:
            raise Stop(5, f"the landing moves {document}, and the body does not say so")
        for k in sorted(set(said)):
            paragraphs[k] = _rewrap(
                AT_LANDING_RE.sub(
                    lambda found, document=document: f"`{document}` is regenerated in this commit." if found["doc"] == document else found[0],
                    paragraphs[k],
                )
            )
    return "\n\n".join(paragraphs) + "\n"


def commit_as(source: str, message: str, scratch: Path) -> str:
    """The staged pick committed under the source commit's author, through the hooks; the new commit."""
    name, email, date = git("log", "-1", "--format=%an%x00%ae%x00%ad", "--date=raw", source).rstrip("\n").split("\0")
    path = scratch / f"{source[:12]}.msg"
    path.write_bytes(message.encode("utf-8"))
    env = {**os.environ, "GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": email, "GIT_AUTHOR_DATE": date}
    done = subprocess.run(("git", "commit", "-q", "-F", str(path)), capture_output=True, check=False, env=env)
    said = (done.stdout + done.stderr).decode("utf-8", "replace").strip()
    if done.returncode != 0:
        raise Stop(6, f"the commit of {source} was refused (exit {done.returncode}); its message is {path}", said)
    if said:
        print(said)
    return git("rev-parse", "HEAD").strip()


def land(start: str, branch: str) -> int:
    root = Path(git("rev-parse", "--show-toplevel").strip())
    commits = preflight(start, branch)
    if not commits:
        print(f"nothing to land: {branch} holds no commit after {start}")
        return 0
    scratch = Path(tempfile.mkdtemp(prefix="land-"))
    tip = start
    try:
        for commit in commits:
            merged = pick(commit)
            staged = set(git("diff", "--cached", "--name-only").split())
            if not staged:
                print(f"skipped {commit[:9]}: the session branch already holds its change")
                tip = commit
                continue
            moved = regenerate(root) if any(path.startswith(REGENERATED_FROM) for path in staged) else []
            staged = set(git("diff", "--cached", "--name-only").split())
            try:
                message = body_for(git("log", "-1", "--format=%B", commit), staged)
            except Stop as stop:
                path = scratch / f"{commit[:12]}.msg"
                path.write_bytes(git("log", "-1", "--format=%B", commit).encode("utf-8"))
                raise Stop(5, *stop.lines, f"its message is {path}: correct it, then `git commit -F` it") from None
            landed = commit_as(commit, message, scratch)
            notes = [f"regenerated {', '.join(Path(document).name for document in moved)}"] if moved else []
            notes += [f"merged by row key: {'; '.join(merged)}"] if merged else []
            subject = git("log", "-1", "--format=%s", landed).strip()
            print(f"landed {commit[:9]} as {landed[:9]}: {subject}" + (f" ({'; '.join(notes)})" if notes else ""))
            tip = commit
    except Stop as stop:
        stop.lines = (*stop.lines, f"recorded tip: {tip}")
        raise
    shutil.rmtree(scratch, ignore_errors=True)
    print(f"recorded tip: {tip}")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        return land(*argv)
    except Stop as stop:
        for line in stop.lines:
            print(line, file=sys.stderr)
        return stop.code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
