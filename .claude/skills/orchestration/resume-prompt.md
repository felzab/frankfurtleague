# Resume prompt

For a session paused for quota, killed, or continued after any gap. **A resume point is a state you
can prove, not a state you remember** — the last commit, the register, and a real exit code. Nothing
an agent reported and nothing you recall counts until it has been re-established against the tree.

**The owner** sends `/orchestration` as its own message first, then pastes the block below verbatim
as the next message; the mechanics behind that order are in [USAGE.md](USAGE.md). **A coordinator
reading this file starts at the block** — the two sentences above are not yours to execute.

```
Resume this session. Do not continue any work until you have finished this protocol.

1. RECONSTRUCT. Read the register and the latest resume-state or handoff document. State, in
   your reply: the branch, the commit subjects on it (subjects, never SHAs -- a rebase changes
   every SHA silently), whether the tree is clean, and which phase of the cycle we are in. Take
   every one of these from a command.

2. THE FLEET. List every subagent that is actually running. Assume none is alive and none is
   dead -- killing a parent does not kill its children. For each agent the register records:
     - finished, with its report on disk        -> read the condensed verdict, mark it done;
     - running                                  -> leave it, note what it owns;
     - paused, killed, or unaccounted for       -> try to RESUME it first, addressed by the agent
       name the register records, since a resumed agent keeps its whole context and re-reads
       nothing. Treat the resume as a new
       dispatch: check that its files are still free before it continues, and treat nothing it
       claims as done until the acceptance evidence is on disk. Where the resume fails, re-brief
       it from its last provable state: the files it owns as they stand committed, plus the
       checklist items whose acceptance evidence exists. An item with no evidence is not done.

3. PARTIAL WORK. For every uncommitted change in the tree, name the agent that owns the file. Use
   `git status --porcelain`, not `git diff --name-only`: a file an agent created and never staged
   is invisible to the second, and a test module left untracked that way passed its suite by being
   absent from it. A changed or untracked file no agent owns is the first thing to investigate --
   it is either a lost agent or a conflict incident. Do not commit anything you cannot attribute.

4. INSTRUCTIONS. Re-read every standing instruction and confirm each is still being followed --
   the repository's own rules file, the ratified decisions, the owner's standing-instructions file,
   the rulings recorded in the register, and the constraints in the brief that started this
   session. Say which ones the work in flight touches. An instruction nobody restated after a gap
   is the one that gets dropped.

5. VERIFY, DO NOT TRUST. Re-establish the last verification result yourself. Run the gate at the
   scope the branch demands and report the real exit code, taken from the command and never
   through a pipe. A previous report of a clean run is not evidence of a clean tree now.

6. RESUME POINT. State the single next action and why it is next. Then continue, at the same
   parallelism the work can absorb -- a resumed session that runs one agent at a time has lost
   the fleet as surely as the pause did.

Quality is the absolute goal here. Where a piece of work cannot be shown to have completed
correctly, redo it -- I would rather redo than accept bad output. But do not spend tokens
re-deriving what a command can tell you in one line, and do not re-audit work whose acceptance
evidence is on disk and still valid. Re-run what you cannot prove; read what you can.
```

## Why each step is there

- **Step 1** — a branch can be rebuilt while a session is away. A sixteen-commit branch here was
  rebuilt twice inside six minutes, every SHA different and every subject intact.
- **Step 2** — the register carries each agent's name so that a resume has an address at all: the
  harness's agent-to-agent send tool is addressed by the name an agent was dispatched under, and a
  send resumes it from its transcript. That is **read from the tool's own definition and not
  driven**, so attempt it and see; whether an agent killed by a quota stop comes back has not been
  recorded either way, and the attempt costs one message where a re-brief costs the whole context.
  What a resumed agent cannot supply is evidence: an agent that "was nearly done"
  has, by definition, none for the part that was nearly done. And a resumed agent re-enters its
  partition — two agents were live in one directory because a resume was not treated as a dispatch.
  One nested helper never returned at all, which is why the fleet is listed rather than assumed.
- **Step 3** — a file changed by nobody the register names is the cheapest detectable sign that an
  agent went somewhere it should not have.
- **Step 4** — this is the requirement that a resumed session still obeys everything the original
  did. Instructions decay silently across a gap; nothing surfaces the decay except restating them.
- **Step 5** — a checker read taken by hand in a tree several agents were editing is a snapshot of a
  tree that has already moved on. Only the gate's own invocation counts.

## What a resume restores, and what it does not

A resumed session restores the conversation, the model and the permission mode, and subagent
transcripts with it. It does **not** restore launch-time configuration — `--add-dir`, `--settings`,
`--mcp-config`, `--plugin-dir` — nor background shell commands or monitors, so pass the flags again
and restart what was watching. Offered a choice between resuming from a summary and resuming the
full session, take the full session: whatever the summary leaves out is gone, and the register on
disk is the fallback for a lost transcript, never a substitute for one. There is no state export
beyond this, which is exactly why the register and the handoff are written to disk as the session
runs rather than at its end.
