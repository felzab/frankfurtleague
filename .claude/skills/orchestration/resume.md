# Resuming a session

For a session paused, killed, stopped for quota, or continued after any gap. A resume point is a
state you can prove from the last commit, the register and a real exit code; nothing an agent
reported or you recall counts until it is re-established against the tree. Run the block from step
1 before anything else. The owner pastes it only in the fallback `USAGE.md` gives, with no register
path.

```
Resume this session. Do not continue any work until you have finished this protocol.

1. LOCATE THE REGISTER. Find it; never ask for its path:

     ls -t ~/.claude/plans/*/REGISTER-*.md          # Git Bash; newest first

   widening to `find ~/.claude/plans -name 'REGISTER-*.md'` if that matches nothing. One whose
   `Coordinator session id` line names this session's id is the candidate ahead of every other.
     - one file, recording the branch you are on -> that is the register; name its path.
     - none -> this is not a resume; say so and wait for a starter prompt.
     - more than one -> take the newest recording your branch and name the ones rejected; where two
       still match, ask.
     - stale -- another branch, a tip subject not on yours, or a next action already a commit ->
       treat none of it as state; say which check failed and ask.

2. RECONSTRUCT. Read the resume point, then the handoff the register names if one exists. State
   the branch, the commit subjects on it (never SHAs), whether the tree is clean, and the cycle
   phase, each from a command.

3. THE FLEET. List every subagent actually running; assume none alive and none dead. For each one
   the register records:
     - finished and banked -> mark it done; finished and not banked -> bank its report from its
       transcript (`ledger.py bank --from <agent id>`), and judge its edits on disk against it.
     - running -> leave it, and note what it owns.
     - paused, killed or unaccounted for -> resume it by the id the Agent tool returned, as a new
       dispatch: check its files are still free, and count nothing done until its acceptance
       evidence is on disk. Where it cannot be resumed, brief a successor from its saved brief, its
       `<NAME>-messages.md` and its transcript, and from its last provable state. Land its branch
       only where every commit carries acceptance evidence, otherwise a branch cut at the last
       commit that does. Judge every uncommitted edit as intended work or an unrestored plant; save
       the work -- `git -C <path> diff`, its untracked files, any stash entry on its branch -- to
       the scratch path, name it in the successor's brief, and
       keep its worktree row open until the fresh work lands.

4. PARTIAL WORK. Match every `git worktree list` entry to the register's worktree table. For each,
   `git log --format='%h %s' <session branch>..<branch>` names what a merge would take and
   `git -C <path> status --porcelain` what is uncommitted, an untracked file included. A worktree no
   row names is a lost agent; your own checkout holding a change is a conflict incident. Land
   nothing you cannot attribute.

5. INSTRUCTIONS. Re-read every standing instruction -- the repository's rules, the ratified
   decisions, the owner's `~/.claude/CLAUDE.md`, the starter the register names, the rulings in the
   register -- and say which the work in flight touches. Confirm each change made for an
   unattended stretch is exactly as the register describes it: uncommitted, its backup on disk, its
   restore command correct.

6. VERIFY. Check that the commit the register's `Last gate run` names is still the tip, and that
   the Docker engine the database tier needs answers (`docker info` exits 0) before any agent
   resumes: after a restart it may not. Run the gate only where the next action is the ending's.

7. RESUME POINT. State the single next action and why, and write it into the register in the same
   edit as the action. Where this session's id differs from the register's, rewrite the
   `Coordinator session id:` line in that edit. A register with no `Briefs:` line gains one, and
   each live agent `reg.py dispatch` has not recorded is given its file and row, before the next send. Then continue, running in parallel what shortens
   the critical path.

Redo what cannot be shown complete; re-derive nothing a command answers in one line; re-audit no
work whose acceptance evidence is on disk and still valid.
```

## Resuming an agent

Establish whether this harness can resume an agent by attempting one send before any plan rests on
it. With a send tool, address the agent by the id the Agent tool returned; an agent stopped by quota
comes back with its context intact. Without one, every continuation is a fresh dispatch with a
corrected brief, built from what the register banked and what is on disk; a finished agent's
transcript file holds its final report. A resumed agent supplies no evidence for the part it "nearly
finished", and re-enters its files as a new dispatch would.

At a stop itself, message no agent to checkpoint: their edits are on disk and their unreported
findings are unreachable. Bring the register current instead.

## What a resume restores

A resumed session restores the conversation, the model, the permission mode and the subagent
transcripts. It does not restore background shell commands or monitors, which you restart, nor the
launch flags, which are the owner's to pass again.
