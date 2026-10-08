"""ORCHESTRATION · one finished agent branch merged into the session branch.

`git merge --no-ff` brings the branch in whole: the agent's commits keep the hooks they ran in its
worktree, and the merge commit takes git's own message, which `commit-msg` leaves to git. A conflict
in a generated document is answered by regenerating it from the merged code, one inside a markdown
table by row key where a column names one row, and any other aborts the merge and goes back to the
agent. A merge touching `fl_backend/` regenerates both documents either way: two branches each
carrying a current document can merge cleanly into one that is not. A row a merged body names in its
`Rows fixed:` line closes as FIXED by the merge where it is ROUTED to the branch's agent.

    uv run --project fl_backend --frozen python .claude/skills/orchestration/tools/land.py <register> <branch>

`EXITS` gives each exit; every stop past the refusals leaves the merge aborted and the tree clean.
"""

from __future__ import annotations

import io
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Final

# Run as a script, python seeds this file's own directory on the path.
import ledger
import reg
from merge_rows import merge_file

# Each document beside the module that writes it, run from `fl_backend` by the interpreter running
# this tool: the backend's virtualenv, which `uv run --project fl_backend` selects.
GENERATED: Final = (
    ("tests.openapi_document", "fl_backend/openapi.json"),
    ("tests.einwilligung_document", "fl_backend/einwilligung.json"),
)
REGENERATED_FROM: Final = "fl_backend/"
# Run where the merge touches the package: two branches can merge clean as text and still fail
# together, one cutting an import the other's new case uses. The frontend's runs `next typegen` first.
TYPE_CHECKS: Final = (
    (("fl_frontend/",), ("pnpm", "typecheck"), "fl_frontend"),
    (("fl_backend/",), (sys.executable, "-m", "pyright"), "fl_backend"),
    (("scripts/", ".claude/skills/orchestration/tools/"), (sys.executable, "-m", "pyright"), "scripts"),
)
# A merge moving a manifest or a lockfile is checked against the install it implies rather than this
# checkout's stale one; each runs from the root.
INSTALLS: Final = (
    (("fl_frontend/package.json", "fl_frontend/pnpm-lock.yaml"), ("pnpm", "--dir", "fl_frontend", "install", "--frozen-lockfile")),
    (("fl_backend/pyproject.toml", "fl_backend/uv.lock"), ("uv", "sync", "--project", "fl_backend", "--dev", "--frozen")),
)
ROWS_FIXED_RE: Final = re.compile(r"^Rows fixed:\s*(?P<rows>.+)$", re.MULTILINE)
STANDING_HEADING: Final = "## Standing actions"
EXITS: Final = {
    0: "merged, or nothing to merge",
    2: "refused before the merge",
    3: "a conflict the tool cannot settle; the merge is aborted, for the agent to rebase",
    4: "a regeneration failed; the merge is aborted",
    5: "the merged tree fails a touched package's type check, or the check could not run; the merge is aborted",
    6: "a hook refused the merge commit; the merge is aborted",
    7: "git failed during the merge; read `git status`",
    8: "the session branch fails that type check before the merge; the merge is aborted and the branch was not judged",
}


class Stop(Exception):
    """A landing that cannot go on: its exit code and the lines the coordinator reads."""

    def __init__(self, code: int, *lines: str, recheck: tuple[tuple[str, ...], Path] | None = None) -> None:
        super().__init__(lines[0] if lines else "")
        self.code = code
        self.lines = lines
        # A failed check's command and directory, run again at `HEAD` once the merge is aborted.
        self.recheck = recheck


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


def _run(command: tuple[str, ...], cwd: Path) -> subprocess.CompletedProcess[bytes]:
    program = shutil.which(command[0])
    if program is None:
        raise Stop(5, f"{command[0]} is not on PATH, so the merged tree could not be checked")
    # The release lookup pyright makes on every run, which the gate's own pyright units skip too.
    env = {**os.environ, "PYRIGHT_PYTHON_IGNORE_WARNINGS": "1"}
    return subprocess.run((program, *command[1:]), cwd=cwd, capture_output=True, check=False, env=env)


def _tail(done: subprocess.CompletedProcess[bytes]) -> list[str]:
    return (done.stdout + done.stderr).decode("utf-8", "replace").strip().splitlines()[-15:]


def type_check(root: Path, touched: list[str]) -> list[str]:
    """Each touched package's type checker run over the merged tree, after any install it moved; the packages checked."""
    for manifests, command in INSTALLS:
        if any(path in manifests for path in touched) and (done := _run(command, root)).returncode != 0:
            raise Stop(5, f"`{' '.join(command)}` exited {done.returncode} for the merged manifests:", *_tail(done))
    checked: list[str] = []
    for prefixes, command, where in TYPE_CHECKS:
        if not any(path.startswith(prefixes) for path in touched):
            continue
        done = _run(command, root / where)
        if done.returncode != 0:
            said = (f"the merged tree fails `{' '.join(command)}` in {where} (exit {done.returncode}):", *_tail(done))
            raise Stop(5, *said, recheck=(command, root / where))
        checked.append(where)
    # A checker writing a tracked file would leave it out of the merge commit and the tree dirty.
    if wrote := git("diff", "--name-only").split():
        raise Stop(5, f"a type check wrote tracked files: {', '.join(wrote)}")
    return checked


def owners(register: str, branch: str) -> set[str]:
    """The agent a `worktree-agent-<id>` branch belongs to, by its id and by its live-agent row's name."""
    found = re.fullmatch(r"worktree-agent-(?P<id>[A-Za-z0-9]+)", branch)
    if found is None:
        return set()
    name = reg.agent_name(register, found["id"])
    return {found["id"], name} if name else {found["id"]}


def standing(register: str, names: set[str]) -> list[str]:
    """The trigger of each undispatched standing action naming the landed branch or its agent."""
    lines = register.split("\n")
    at = next((k for k, line in enumerate(lines) if line.startswith(STANDING_HEADING)), None)
    said: list[str] = []
    for line in lines[at + 1 :] if at is not None else []:
        if line.startswith("## "):
            break
        cells = [cell.strip() for cell in line.strip().split("|")[1:-1]]
        # The third cell is ticked only on evidence the action went out (`register-template.md`).
        pending = len(cells) == 3 and (not cells[2] or cells[2].lower().startswith("no"))
        if pending and any(re.search(rf"(?<![\w-]){re.escape(name)}(?![\w-])", cells[0]) for name in names):
            said.append(cells[0])
    return said


def land(register: Path, branch: str) -> int:
    root = Path(git("rev-parse", "--show-toplevel").strip())
    try:
        ledger.open_rows(register)
        held = register.read_bytes().decode("utf-8")
    except (ValueError, OSError) as unreadable:
        raise Stop(2, f"the register's findings ledger cannot be read: {unreadable}") from None
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
        checked = type_check(root, touched)
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
        clean = not git("status", "--porcelain").strip()
        stop.lines = (*stop.lines, "the merge is aborted" if clean else "read `git status` before anything else")
        # A red already at `HEAD` is no fault of the branch, and no rebase of it can clear it.
        if clean and stop.recheck is not None and _run(*stop.recheck).returncode != 0:
            stop.code = 8
            head = f"the session branch already fails `{' '.join(stop.recheck[0])}` before this merge, so {branch} was not judged:"
            stop.lines = (head, "route the red at HEAD to its owner and land again once it clears", *stop.lines)
        raise
    notes = [f"regenerated {', '.join(Path(document).name for document in moved)}"] if moved else []
    notes += [f"merged by row key: {'; '.join(merged)}"] if merged else []
    notes += [f"type-checked {', '.join(checked)}"] if checked else []
    merge = git("rev-parse", "--short", "HEAD").strip()
    print(f"landed {branch} as {merge}" + (f" ({'; '.join(notes)})" if notes else ""))
    # Only a `Rows fixed:` line closes, and only a row routed to this branch's agent: a mention, or a
    # row another fixer holds, stays for the coordinator to judge.
    bodies = git("log", "--format=%B", "HEAD^1..HEAD^2")
    named = sorted({row.rstrip(".") for found in ROWS_FIXED_RE.findall(bodies) for row in re.split(r"[,\s]+", found) if row.rstrip(".")})
    agent = owners(held, branch)
    closed = ledger.close(register, named, merge, agent)
    for row in closed:
        print(f"FIXED {row} by {merge}")
    if unclosed := sorted(set(named) - set(closed)):
        who = ", ".join(sorted(agent)) or "an agent this tool can name"
        print(f"named fixed by the merged commits and not ROUTED to {who}, so left as they stand: {', '.join(unclosed)}")
    for trigger in standing(held, agent | {branch}):
        print(f"a standing action waits on this landing: {trigger}")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        print("\n".join(f"  exit {code}: {meaning}" for code, meaning in EXITS.items()), file=sys.stderr)
        return 2
    try:
        return land(Path(argv[0]), argv[1])
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
