# Using the orchestration skill

**Addressed to the owner, not to the coordinator.** Every imperative below — open a session, type
this, wait, paste that — is the owner's to perform; a coordinator reads this page only for the
mechanics `SKILL.md` cites it for, and can execute none of it.

How the skill reaches a session, read from the Claude Code documentation on 2026-09-02
(`code.claude.com/docs/en/skills`, `sub-agents`, `sessions`, `desktop`) and not driven — no session
here has measured a token budget or watched a compaction — and the exact message sequences for the
three ways a session begins.

## How it loads

- **Only the description is in context by default.** The body loads when Claude judges the
  description relevant, or when you type `/orchestration`. Nothing documented forces the load at
  launch — not a settings key, a `CLAUDE.md` line, a hook, or a flag — so relying on relevance alone
  is relying on a judgement. Type it.
- **On invocation the `SKILL.md` body enters the conversation as one message and stays there across
  turns.** The file is not re-read afterwards: an edit to the skill mid-session needs a fresh
  `/orchestration`. Re-invoking with unchanged content adds a one-line note rather than a second
  copy, so repeating it is free.
- **The files beside `SKILL.md` do not load with it.** The coordinator reads one when a section
  points at it. The brief, register and handoff templates therefore cost nothing until used.
- **Compaction keeps the first 5,000 tokens of each invoked skill**, within a shared budget of
  25,000 for all of them, most recently invoked first; the rule that follows for `SKILL.md` is
  stated at its top. After a long session a repeated `/orchestration` costs nothing and removes the
  doubt.
- **Text after `/orchestration` on the same line is passed as arguments**, appended to the skill
  content as `ARGUMENTS: <text>`. Whether a pasted multi-line message is passed whole is not
  documented, so the sequences below never depend on it: the skill and the prompt go as two
  messages.
- **A subagent does not inherit it.** A project agent file can preload a skill through its `skills`
  field, but an implementer or an auditor needs its brief, not this page.
- **In the desktop app** the `/` menu in the prompt box lists project skills, and clicking a session
  in the sidebar is the app's `--resume`.

## Starting a programme session

1. Open a new session in the repository, on `main`, and name it after the session in the plan.
2. **Message 1:** `/orchestration` — nothing else. Wait for the turn to end.
3. **Message 2:** paste the session's `START-*.md` verbatim.

Two messages because the skill's argument mechanics are documented for one line only, and because
a starter that begins with a slash command reads as an argument to it. The starter's own first lines
still say to invoke `/orchestration` if it is not in context, which is the fallback for the day
message 1 is forgotten.

## Resuming after a pause, a kill, or a quota stop

1. Resume the same session — the sidebar in the desktop app, or `claude --continue` /
   `claude --resume <name>` in a terminal. Pass any launch flags again; a resume restores none of
   them. Offered a summary or the full session, take the full session.
2. **Message 1:** `/orchestration` — after a long session compaction may have truncated the copy in
   context, and a repeat costs nothing.
3. **Message 2:** the block in [resume-prompt.md](resume-prompt.md), verbatim, prefixed by one line
   naming the register's path.
4. Send no work instruction until the reply to the six-step protocol has come back and names the
   single next action.

## The planning session

1. New session; **message 1:** `/orchestration`.
2. **Message 2:** the programme brief — the goal, the constraints, the durable plan directory to
   write into, and the deliverables: the programme plan, the `START-*.md` for session one in the
   form [handoff-template.md](handoff-template.md) gives, and an independent audit of both followed
   by the fix round the cycle ends on. The planning session dispatches research agents in parallel
   like any other, so the skill applies to it in full.

## Precedence

This skill never overrides `.claude/CLAUDE.md` or the owner's standing-instructions file the
starter names. Where the skill disagrees with either, the skill is wrong: fix it in the same
session and say so.
