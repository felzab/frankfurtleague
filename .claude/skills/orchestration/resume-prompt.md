# Resume prompt

Incidents cited here are from this repository, recorded 2026-09-01.

For a session paused for quota, killed, or continued after any gap. **A resume point is a state you
can prove, not a state you remember** — the last commit, the register, and a real exit code. Nothing
an agent reported and nothing you recall counts until it has been re-established against the tree.

Paste this verbatim.

```
Resume this session. Do not continue any work until you have finished this protocol.

1. RECONSTRUCT. Read the register and the handoff. State, in your reply: the branch, the commit
   subjects on it (subjects, never SHAs -- a rebase changes every SHA silently), whether the tree
   is clean, and which phase of the cycle we are in. Take every one of these from a command.

2. THE FLEET. List every subagent that is actually running. Do not assume any is alive and do not
   assume any is dead -- killing a parent does not kill its children. For each agent the register
   records:
     - finished, with its report on disk        -> read the condensed verdict, mark it done;
     - running                                  -> leave it, note what it owns;
     - paused, killed, or unaccounted for       -> it does NOT resume where it stopped. Re-dispatch
       it from its last provable state: the files it owns as they stand committed, plus the
       checklist items whose acceptance evidence exists. An item with no evidence is not done.

3. PARTIAL WORK. For every uncommitted change in the tree, name the agent that owns the file. A
   changed file no agent owns is the first thing to investigate -- it is either a lost agent or a
   conflict incident. Do not commit anything you cannot attribute.

4. INSTRUCTIONS. Re-read every standing instruction and confirm each is still being followed --
   the repository's own rules file, the ratified decisions, the owner's rulings recorded in the
   register, and the constraints in the brief that started this session. Say which ones the work
   in flight touches. An instruction nobody restated after a gap is the one that gets dropped.

5. VERIFY, DO NOT TRUST. Re-establish the last verification result yourself. Run the gate at the
   scope the branch demands and report the real exit code, taken from the command and never
   through a pipe. A previous report of a clean run is not evidence of a clean tree now.

6. RESUME POINT. State the single next action and why it is next. Then continue.

Quality is the absolute goal here. Where a piece of work cannot be shown to have completed
correctly, redo it -- I would rather redo than accept bad output. But do not spend tokens
re-deriving what a command can tell you in one line, and do not re-audit work whose acceptance
evidence is on disk and still valid. Re-run what you cannot prove; read what you can.
```

## Why each step is there

- **Step 1** — a branch can be rebuilt while a session is away. A sixteen-commit branch here was
  rebuilt twice inside six minutes, every SHA different and every subject intact.
- **Step 2** — one nested helper never returned and left a claim unverified. A killed agent that
  "was nearly done" has, by definition, no acceptance evidence for the part that was nearly done.
- **Step 3** — a file changed by nobody the register names is the cheapest detectable sign that an
  agent went somewhere it should not have.
- **Step 4** — this is the requirement that a resumed session still obeys everything the original
  did. Instructions decay silently across a gap; nothing surfaces the decay except restating them.
- **Step 5** — a checker read taken by hand in a tree several agents were editing is a snapshot of a
  tree that has already moved on. Only the gate's own invocation counts.

## Session hygiene that makes a resume cheap

A resumed session restores the conversation, the model and the permission mode. It does **not**
restore configuration passed at launch — extra directories, settings files, tool servers — so pass
those again. There is no state export beyond this, which is exactly why the register and the handoff
are written to disk as the session runs rather than at its end.
