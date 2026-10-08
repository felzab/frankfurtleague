# Using the orchestration skill

Addressed to the owner: every step below is yours to perform. The coordinator never reads this page.

## How it loads

- Only the skill's description is in context until it is invoked, so type `/orchestration` rather
  than rely on Claude judging it relevant. Text after it on the same line arrives as
  `ARGUMENTS: <text>` at the end of the skill.
- An agent definition's `initialPrompt`, with the session launched by `--agent`, is documented to
  submit a first turn whose skills are processed, which could invoke the skill at launch. It is
  untried here, and unknown in the desktop app.
- The skill stays in the conversation once invoked; an edit to it mid-session needs a fresh
  `/orchestration`. A compaction after that re-attached the session's first, older copy rather
  than the latest the documentation names, so the compaction hook tells the coordinator that the
  file on disk is the current core.
- Compaction re-attaches the first 5,000 tokens of each invoked skill, within 25,000 shared by all of
  them and filled from the most recent: the skill's core is held under that size by
  `scripts/tests/test_orchestration_skill.py`, so it comes back whole, and its other files are read
  when the core points at them. A session that invoked many other skills since can lose it entirely;
  invoke it again then.
- Compact at a wave boundary rather than when the window is full, with a focus instruction, for
  example `/compact keep the register path, the branch and the live agent ids`.
- A subagent does not inherit the skill: its agent definition and its brief carry what it needs.

## Starting a programme session

1. Open a new session in the repository, on `main`, named after the session in the plan.
2. Message 1: `/orchestration`, and nothing else. Wait for the turn to end.
3. Message 2: the session's `START-*.md`, verbatim. A starter opening with a slash command would be
   read as that command's argument, so it goes as its own message.

## Resuming after a pause, a kill or a quota stop

1. Resume the same session — the sidebar in the desktop app, or `claude --continue` /
   `claude --resume <name>`. Pass any launch flags again; a resume restores none of them. Offered a
   summary or the full session, take the full session.
2. One message: `/orchestration resume`. The coordinator runs the resume protocol, which finds the
   register on its own.
3. Send no work instruction until the reply names the single next action.

A resumed agent's entry in the app can keep showing its transcript up to the pause while it works,
so a live lane looks hung there; its commits on its own branch, which the coordinator reads for you
on asking, are where its work shows.

The fallback: `/orchestration` as one message, then the block in `resume.md` verbatim as the next.
Neither carries a register path.

## The planning session

1. A new session; message 1: `/orchestration`.
2. Message 2: the programme brief — the goal, the constraints, the durable plan directory, and the
   deliverables: the programme plan, session one's `START-*.md`, and an independent audit of both
   followed by its fix round.
