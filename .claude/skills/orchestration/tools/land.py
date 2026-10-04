"""ORCHESTRATION · an agent's commits landed one by one, through the hooks, from a recorded tip.

Each commit after `<from>` is picked with `git cherry-pick -n` and committed with `git commit -F`, so
both hooks run on every one, under the agent's authorship. The documents agents never commit are
regenerated into each commit touching `fl_backend/`, and a body's sentence deferring them is
rewritten to what the landing did. A conflict inside a markdown table resolves by row key where every
key names one row; any other stops with nothing of that commit staged. `--hold` stops before a commit,
for its body or a hub file to be read.

    uv run --project fl_backend --frozen python .claude/skills/orchestration/tools/land.py [--hold] <from> <branch>

`<from>` is the merge-base on a first landing, the recorded tip after it, and the new merge-base
after its agent's `git rebase --onto`. `EXITS` gives each exit.
"""

from __future__ import annotations

import re
import shlex
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
# Every stop from 3 up also names the tip the landings before it took.
EXITS: Final = {
    0: "landed, or held",
    2: "refused before any pick",
    3: "a conflict the merge cannot settle; nothing of that commit is staged",
    4: "a regeneration failed; the commit is left staged",
    5: "a body disagrees with its landed diff; staged, its message file and commit command named",
    6: "a hook refused the commit; staged, its message file and commit command named",
    7: "git failed past the first pick; read `git status`",
    8: "a pick staged nothing while its change is absent from the session branch",
}
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
            f"{branch} does not contain {start}.",
            f"Rebased with `git rebase --onto <session branch> {start}`: land from `git merge-base HEAD {branch}`.",
            f"Rewritten otherwise: `git range-diff {start}...{branch}` names the commits no landing took; land each as <sha>~1 <sha>.",
        )
    if _ok("show-ref", "--verify", "--quiet", f"refs/heads/{branch}"):
        for block in git("worktree", "list", "--porcelain").split("\n\n"):
            fields = dict(line.split(" ", 1) for line in block.splitlines() if " " in line)
            if fields.get("branch") == f"refs/heads/{branch}" and git("-C", fields["worktree"], "status", "--porcelain").strip():
                raise Stop(2, f"{fields['worktree']} holds uncommitted work, which no landing takes: the agent commits it first")
        # git names a stash "On <branch>:" when given a message and "WIP on <branch>:" when not.
        if re.search(rf"(?:^|: )(?:WIP on|On) {re.escape(branch)}:", git("stash", "list"), re.MULTILINE):
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
    said = ""
    try:
        for path in conflicted:
            if not path.endswith(".md"):
                said = f"{path} is no markdown table"
                break
            merge = merge_file(path, f"{commit}~1", commit)
            if merge.text is None:
                said = "; ".join(merge.conflicts)
                break
            merged += [f"{path}: {line}" for line in merge.done]
        else:
            if conflicted:
                git("add", "--", *conflicted)
                git("cherry-pick", "--quit")
                return merged
    # Whatever went wrong inside a merge, the pick is undone before the stop, so nothing is left half staged.
    except Exception as failed:
        said = f"{type(failed).__name__}: {failed}"
    git("cherry-pick", "--abort", check=False)
    raise Stop(3, f"CONFLICT landing {commit}: {', '.join(conflicted) or 'no file named'}; nothing of it is staged", said)


def holds_already(commit: str) -> bool:
    """Whether the session branch holds the commit's whole change: its patch reverses cleanly onto `HEAD`."""
    patch = subprocess.run(("git", "diff", "--binary", f"{commit}~1", commit), capture_output=True, check=True).stdout
    if not patch.strip():
        return True
    reverse = subprocess.run(("git", "apply", "--cached", "--reverse", "--check"), input=patch, capture_output=True, check=False)
    return reverse.returncode == 0


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
        # Any other wording about a moved document may still say it was not regenerated, so only the
        # fixed sentence, rewritten below, lets the commit through.
        if moved and not said:
            raise Stop(5, f"the landing moves {document}, and the body does not say so in the fixed sentence")
        for k in sorted(set(said)):
            paragraphs[k] = _rewrap(
                AT_LANDING_RE.sub(
                    lambda found, document=document: f"`{document}` is regenerated in this commit." if found["doc"] == document else found[0],
                    paragraphs[k],
                )
            )
    return "\n\n".join(paragraphs) + "\n"


def commit_command(source: str, path: Path) -> list[str]:
    """The commit of the staged pick under the source commit's authorship, through the hooks."""
    name, email, date = git("log", "-1", "--format=%an%x00%ae%x00%ad", "--date=raw", source).rstrip("\n").split("\0")
    return ["git", "commit", "-q", "-F", str(path), f"--author={name} <{email}>", f"--date={date}"]


def commit_as(source: str, message: str, scratch: Path) -> str:
    """The staged pick committed; the new commit."""
    path = scratch / f"{source[:12]}.msg"
    path.write_bytes(message.encode("utf-8"))
    command = commit_command(source, path)
    done = subprocess.run(command, capture_output=True, check=False)
    said = (done.stdout + done.stderr).decode("utf-8", "replace").strip()
    if done.returncode != 0:
        raise Stop(
            6,
            f"the commit of {source} was refused (exit {done.returncode}); its message is {path}",
            said,
            f"commit it with: {shlex.join(command)}",
        )
    if said:
        print(said)
    return git("rev-parse", "HEAD").strip()


def land(start: str, branch: str, hold: bool = False) -> int:
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
                if not holds_already(commit):
                    raise Stop(8, f"the pick of {commit} staged nothing, and its change is absent from the session branch")
                print(f"skipped {commit[:9]}: the session branch already holds its whole change")
                tip = commit
                continue
            moved = regenerate(root) if any(path.startswith(REGENERATED_FROM) for path in staged) else []
            staged = set(git("diff", "--cached", "--name-only").split())
            try:
                message = body_for(git("log", "-1", "--format=%B", commit), staged)
            except Stop as stop:
                path = scratch / f"{commit[:12]}.msg"
                path.write_bytes(git("log", "-1", "--format=%B", commit).encode("utf-8"))
                command = shlex.join(commit_command(commit, path))
                raise Stop(5, *stop.lines, f"its message is {path}: correct it, then commit with: {command}") from None
            if hold:
                path = scratch / f"{commit[:12]}.msg"
                path.write_bytes(message.encode("utf-8"))
                print(f"held {commit[:9]}: staged, its message is {path}")
                print(f"read `git diff --cached` against that message, then commit with: {shlex.join(commit_command(commit, path))}")
                print(f"then continue from: {commit}")
                return 0
            landed = commit_as(commit, message, scratch)
            notes = [f"regenerated {', '.join(Path(document).name for document in moved)}"] if moved else []
            notes += [f"merged by row key: {'; '.join(merged)}"] if merged else []
            subject = git("log", "-1", "--format=%s", landed).strip()
            print(f"landed {commit[:9]} as {landed[:9]}: {subject}" + (f" ({'; '.join(notes)})" if notes else ""))
            tip = commit
    except Stop as stop:
        # Past the preflight a failing git command leaves a landing part done, which no refusal does.
        if stop.code == 2:
            stop.code = 7
            stop.lines = (*stop.lines, "read `git status` before anything else")
        stop.lines = (*stop.lines, f"recorded tip: {tip}")
        raise
    shutil.rmtree(scratch, ignore_errors=True)
    print(f"recorded tip: {tip}")
    return 0


def main(argv: list[str]) -> int:
    hold = argv[:1] == ["--hold"]
    args = argv[1:] if hold else argv
    if len(args) != 2:
        print(__doc__, file=sys.stderr)
        print("\n".join(f"  exit {code}: {meaning}" for code, meaning in EXITS.items()), file=sys.stderr)
        return 2
    try:
        return land(*args, hold=hold)
    except Stop as stop:
        for line in stop.lines:
            print(line, file=sys.stderr)
        return stop.code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
