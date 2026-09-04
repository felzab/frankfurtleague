# Resume prompt

For a session paused for quota, killed, or continued after any gap. **A resume point is a state you
can prove, not a state you remember** — the last commit, the register, and a real exit code. Nothing
an agent reported and nothing you recall counts until it has been re-established against the tree.

**A coordinator arriving here runs the block itself, from step 1, before anything else**; `SKILL.md`
§1 says what puts it here. **The owner** pastes the block only in the fallback sequence
[USAGE.md](USAGE.md) gives, and passes no register path either way — step 1 is the coordinator's
bookkeeping and stays with the coordinator.

```
Resume this session. Do not continue any work until you have finished this protocol.

1. LOCATE THE REGISTER. Find it; never ask for its path. One register per session lives in that
   session's plan directory under the owner's plans directory, named `REGISTER-<session>.md`:

     ls -t ~/.claude/plans/*/REGISTER-*.md          # Git Bash; newest first

   and widen to `find ~/.claude/plans -name 'REGISTER-*.md'` if that matches nothing.
   Then, before you trust a word of it:
     - one file, recording the branch you are on -> that is the register. Name its path in your
       reply.
     - none -> this is not a resume. Say so and wait for a starter prompt: a session that has
       dispatched an agent has a register.
     - more than one -> take the newest that records the branch you are on, and name the ones you
       rejected. Where two still match, ask rather than choose.
     - stale -- it records a branch you are not on, a tip subject that is not on yours, or a next
       action already visible as a commit -> treat none of it as state. Say which check failed and
       ask, because a finished session's register looks exactly like a mid-flight one.

2. RECONSTRUCT. Read the register, its resume point first, then the handoff its header names if a
   previous session wrote one -- the resume point is this session's pending decision, the handoff
   is another session's work. State, in your reply: the branch, the commit subjects on it (never
   SHAs -- a rebase changes every SHA silently), whether the tree is clean, and which phase of the
   cycle we are in. Take every one of these from a command.

3. THE FLEET. List every subagent that is actually running. Assume none is alive and none is
   dead -- killing a parent does not kill its children. For each agent the register records:
     - finished, and its verdict banked here    -> that banked verdict is the only copy of its
       report there is, the harness having each agent return findings as text rather than write a
       file. Mark it done. Where an agent finished and nothing was banked, its findings are gone
       and only its edits on disk survive: judge those, and re-dispatch what you cannot establish
       from them;
     - running                                  -> leave it, note what it owns;
     - paused, killed, or unaccounted for       -> try to RESUME it first, addressed by the id the
       Agent tool returned, which the register records beside the name, since a resumed agent keeps
       its whole context and re-reads nothing. Treat the resume as a new dispatch: check that its
       files are still free before it continues, and treat nothing it claims as done until the
       acceptance evidence is on disk.
       Where the resume fails, re-brief
       it from its last provable state: the files it owns as they stand committed, plus the
       checklist items whose acceptance evidence exists. An item with no evidence is not done.

4. PARTIAL WORK. For every uncommitted change in the tree, name the agent that owns the file. Use
   `git status --porcelain`, not `git diff --name-only`: a file an agent created and never staged
   is invisible to the second, and a test module left untracked that way passed its suite by being
   absent from it. A changed or untracked file no agent owns is the first thing to investigate --
   it is either a lost agent or a conflict incident. Do not commit anything you cannot attribute.

5. INSTRUCTIONS. Re-read every standing instruction and confirm each is still being followed --
   the repository's own rules file, the ratified decisions, the owner's standing-instructions file
   and the starter, whose paths the register header carries, the rulings recorded in the register,
   and the constraints in the brief that started this session. Say which ones the work in flight
   touches. An instruction nobody restated after a gap is the one that gets dropped.
   Then read the register's list of changes made for an unattended stretch, and confirm each is
   still exactly as the register describes it -- still uncommitted, its backup still on disk, its
   restore command still correct. A gap is where a configuration change made to let a fleet run
   overnight gets committed by the session that inherits it.

6. VERIFY, DO NOT TRUST. Re-establish the last verification result from the register's `Last gate
   run`, and confirm the commit it names is still the tip. Run the gate yourself only once step 3
   lists no running agent: while one is live the gate is a wave-boundary instrument, a run over a
   moving tree exits non-zero on somebody else's half-written file, and that red is evidence about
   nothing -- least of all a reason to restore the file it names, which is step 4's question and
   its owner's answer. Once the tree is still, run it at the scope the branch demands and report
   the real exit code, taken from the command and never through a pipe. A previous report of a
   clean run is not evidence of a clean tree now.

7. RESUME POINT. State the single next action and why it is next, and write it into the register in
   the same edit as the action itself, not after it. Then continue, at the same parallelism the
   work can absorb -- a resumed session that runs one agent at a time has lost the fleet as surely
   as the pause did.

Quality is the absolute goal here. Where a piece of work cannot be shown to have completed
correctly, redo it -- I would rather redo than accept bad output. But do not spend tokens
re-deriving what a command can tell you in one line, and do not re-audit work whose acceptance
evidence is on disk and still valid. Re-run what you cannot prove; read what you can.
```

## Step 3's address

The register carries each agent's id so that a resume has an address at all: the harness's
agent-to-agent send tool resumes an agent from its transcript, **addressed by the id the Agent tool
returned rather than by the name in its brief, a send by name having failed** (the owner's standing
instructions). An agent stopped by a quota limit has come back that way with its context intact and
nothing on disk, and the attempt costs one message where a re-brief costs the whole context. What a
resumed agent cannot supply is evidence: an agent that "was nearly done" has, by definition, none
for the part that was nearly done. A resumed agent re-enters its partition — two agents were live in
one directory because a resume was not treated as a dispatch — and one nested helper never returned
at all, which is why the fleet is listed rather than assumed.

At the stop itself, message none of them to checkpoint. Their file edits are already on disk, and
their unreported findings are unreachable by any route: a report is an agent's final message and
messaging costs the same quota that stopped you. What is recoverable is what the register holds
(`SKILL.md` §1), so the single action is to bring it current.

## What a resume restores, and what it does not

A resumed session restores the conversation, the model, the permission mode and the subagent
transcripts — documented, not driven, like every harness fact here; [USAGE.md](USAGE.md) carries the
source and its date. It does **not** restore background shell commands or monitors, so restart what was
watching; nor the launch flags, which are the owner's to pass again ([USAGE.md](USAGE.md)), so a
directory that was reachable may not be. The register on disk is the fallback for a lost
transcript, never a substitute for one.
