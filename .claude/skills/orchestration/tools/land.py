"""ORCHESTRATION · one finished agent branch merged into the session branch.

`git merge --no-ff` brings the branch in whole: the agent's commits keep the hooks they ran in its
worktree, and the merge commit takes git's own message, running whatever hooks the checkout has. A conflict
in a generated document is answered by regenerating it from the merged code, one inside a markdown
table by row key where a column names one row, and any other aborts the merge and goes back to the
agent. A merge touching `fl_backend/` regenerates both documents either way: two branches each
carrying a current document can merge cleanly into one that is not. A `Rows fixed:` row ROUTED to an
agent whose branch the merge brought in closes as FIXED; an OPEN one is printed as a command, never closed.

    uv run --project fl_backend --frozen python .claude/skills/orchestration/tools/land.py <register> <branch> [--after-dispatch]

`EXITS` gives each exit; every stop past the refusals leaves the merge aborted and the tree clean.
"""

from __future__ import annotations

import argparse
import io
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Final

# Run as a script, python seeds this file's own directory on the path.
import ci
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
    (("scripts/",), (sys.executable, "-m", "pyright"), "scripts"),
    ((".claude/skills/orchestration/",), (sys.executable, "-m", "pyright"), ".claude/skills/orchestration"),
)
# A merge moving a manifest or a lockfile is checked against the install it implies rather than this
# checkout's stale one; each runs from the root.
INSTALLS: Final = (
    (("fl_frontend/package.json", "fl_frontend/pnpm-lock.yaml"), ("pnpm", "--dir", "fl_frontend", "install", "--frozen-lockfile")),
    (("fl_backend/pyproject.toml", "fl_backend/uv.lock"), ("uv", "sync", "--project", "fl_backend", "--dev", "--frozen")),
)
ROWS_FIXED_RE: Final = re.compile(r"^Rows fixed:\s*(?P<rows>.+)$", re.MULTILINE)
# A rebase of commits another branch already merged lands each twice under two hashes, which the
# preflight's duplicate-patch check then refuses.
MERGE_BACK: Final = "the agent merges the session branch into its own branch, rebasing only where no other branch holds its commits"
EXITS: Final = {
    0: "merged, or nothing to merge",
    2: "refused before the merge",
    3: f"a conflict the tool cannot settle; the merge is aborted, and {MERGE_BACK}",
    4: "a regeneration failed; the merge is aborted",
    5: "the merged tree fails a touched package's type check, or the check could not run; the merge is aborted",
    6: "a hook refused the merge commit; the merge is aborted",
    7: "git failed during the merge; read `git status`",
    8: "the session branch fails that type check before the merge; the merge is aborted and the branch was not judged",
    9: "refused before the merge: HEAD's verify run has concluded and a `window` standing action waits undispatched",
    10: "merged, and the ledger's bookkeeping after the merge failed: the merge stands, and its rows are closed by hand",
}
AFTER_DISPATCH: Final = "land with --after-dispatch where they went out, which ticks them"


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
    found = reg.AGENT_BRANCH_RE.match(branch)
    if found is None:
        return set()
    name = ledger.agent_name(register, found["id"])
    return {found["id"], name} if name else {found["id"]}


def carried(before: str) -> list[str]:
    """Every agent branch the merge made part of HEAD: a merge agent's branch carries others' commits."""
    branches = git("for-each-ref", "--format=%(refname:short)", "refs/heads/worktree-agent-*").split()
    return [
        name for name in branches if not _ok("merge-base", "--is-ancestor", name, before) and _ok("merge-base", "--is-ancestor", name, "HEAD")
    ]


def standing(register: str, names: set[str]) -> list[str]:
    """The trigger of each undispatched standing action naming the landed branch or its agent."""
    lines = register.split("\n")
    try:
        table, end = reg.standing_table(lines)
    except ValueError:
        return []
    rows = (ledger.cells(lines[k]) for k in range(table + 2, end + 1))
    return [row[0] for row in rows if reg.unticked(row) and any(re.search(rf"(?<![\w-]){re.escape(name)}(?![\w-])", row[0]) for name in names)]


def window(register: str) -> None:
    """Refused while HEAD's verify run has concluded and a standing action waits on that window: landing first closes it."""
    if not (waiting := reg.windows(register)):
        return
    head = git("rev-parse", "HEAD").strip()
    try:
        run = ci.run_for(head)
    except ValueError as unread:
        said = f"{len(waiting)} standing action(s) wait on the window, and HEAD's verify run could not be read: {unread}"
        raise Stop(2, said, AFTER_DISPATCH) from None
    if run is not None and run.get("status") == "completed":
        said = f"HEAD's verify run {run.get('databaseId')} has concluded, and these wait on its window:"
        raise Stop(9, said, *waiting, f"dispatch them first, or {AFTER_DISPATCH}")


def conflict_owners(conflicted: list[str], branch: str, register: str) -> list[str]:
    """Each other live worktree changing a conflicted path: the next landing to meet the same conflict."""
    found = []
    try:
        for tree in reg.worktrees():
            if tree.branch != branch and (shared := sorted(set(conflicted) & reg.touched(tree))):
                found.append(f"{', '.join(shared)} also changed by {reg.label(register, tree)}")
    except ValueError as unread:
        found.append(f"the other worktrees could not be read: {unread}")
    return found


def land(register: Path, branch: str, after_dispatch: bool = False) -> int:
    root = Path(git("rev-parse", "--show-toplevel").strip())
    try:
        ledger.open_rows(register)
        held = ledger.read(register).decode("utf-8")
    except (ValueError, OSError) as unreadable:
        raise Stop(2, f"the register's findings ledger cannot be read: {unreadable}") from None
    preflight(branch)
    if _ok("merge-base", "--is-ancestor", branch, "HEAD"):
        print(f"nothing to land: the session branch already holds {branch}")
        return 0
    if after_dispatch:
        # Unticked, the same row would refuse every later landing in the window.
        try:
            for line in reg.tick_windows(register, "`land.py --after-dispatch`"):
                print(line)
        except (ValueError, OSError) as unwritten:
            raise Stop(2, f"the standing actions could not be ticked: {unwritten}") from None
    else:
        window(held)
    before = git("rev-parse", "HEAD").strip()
    written: list[str] = []
    conflicted: list[str] = []
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
        if stop.code == 3:
            stop.lines = (*stop.lines, *conflict_owners(conflicted, branch, held), MERGE_BACK)
        raise
    notes = [f"regenerated {', '.join(Path(document).name for document in moved)}"] if moved else []
    notes += [f"merged by row key: {'; '.join(merged)}"] if merged else []
    notes += [f"type-checked {', '.join(checked)}"] if checked else []
    merge = git("rev-parse", "--short", "HEAD").strip()
    print(f"landed {branch} as {merge}" + (f" ({'; '.join(notes)})" if notes else ""))
    try:
        credit(register, held, branch, before, merge)
    # Past the merge commit no stop is a refusal, and none may leave a traceback in place of the rows.
    except (Stop, ValueError, OSError) as failed:
        why = "; ".join(failed.lines) if isinstance(failed, Stop) else str(failed)
        raise Stop(10, f"{branch} landed as {merge}, and the bookkeeping after it stopped: {why}", EXITS[10]) from None
    return 0


def credit(register: Path, held: str, branch: str, before: str, merge: str) -> None:
    """The rows the merged commits fixed closed, and each row and standing action the landing leaves named."""
    # Only a `Rows fixed:` line closes, and only a row routed to an agent the merge landed: a mention,
    # or a row another fixer holds, stays for the coordinator to judge.
    bodies = git("log", "--format=%B", "HEAD^1..HEAD^2")
    named = sorted({row.rstrip(".") for found in ROWS_FIXED_RE.findall(bodies) for row in re.split(r"[,\s]+", found) if row.rstrip(".")})
    agent = owners(held, branch).union(*(owners(held, other) for other in carried(before)))
    closed = ledger.close_routed(register, named, merge, agent)
    for row in closed:
        print(f"FIXED {row} by {merge}")
    who = ", ".join(sorted(agent)) or "an agent this tool can name"
    # An OPEN row was never routed, so no fixer was asked for it: the claim is the coordinator's to judge.
    held_as = ledger.held_as(register, named)
    if opened := [row for row in named if held_as.get(row) == "OPEN"]:
        print("named fixed by the merged commits while OPEN; run the line of each row the merge fixed:")
        for row in opened:
            print(f"  {ledger.command('close', str(register.resolve()), 'FIXED', merge, row)}")
    if unclosed := sorted(set(named) - set(closed) - set(opened)):
        print(f"named fixed by the merged commits and not ROUTED to {who}, so left as they stand: {', '.join(unclosed)}")
    # A body naming its report's finding numbers rather than its rows leaves them ROUTED once the fix
    # lands; a warning only, since a row can stay its agent's for a later round.
    if still := ledger.routed(register, agent):
        print(f"still ROUTED to {who} with no `Rows fixed:` line closing them: {', '.join(still)}")
        # One line per row: a single command over them all, run as printed, closes unfixed rows as FIXED.
        print("  run only the line of each row this merge fixed; the rest stay routed:")
        for row in still:
            print(f"  {ledger.command('close', str(register.resolve()), 'FIXED', merge, row)}")
    for trigger in standing(held, agent | {branch}):
        print(f"a standing action waits on this landing: {trigger}")


def parser() -> argparse.ArgumentParser:
    exits = "\n".join(f"  exit {code}: {meaning}" for code, meaning in EXITS.items())
    reading = argparse.ArgumentParser(prog="land.py", description=__doc__, epilog=exits, formatter_class=argparse.RawDescriptionHelpFormatter)
    reading.add_argument("register", type=Path)
    reading.add_argument("branch")
    reading.add_argument(
        "--after-dispatch", action="store_true", help="land although a `window` standing action is unticked, ticking it: it went out"
    )
    return reading


def main(argv: list[str]) -> int:
    args = parser().parse_args(argv)
    try:
        return land(args.register, args.branch, args.after_dispatch)
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
