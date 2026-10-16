# An unattended stretch

The owner's `/away` runs this before they leave, and `/back` undoes it ([modes.md](modes.md)). A
subagent's permission prompt surfaces in the owner's session, not the agent's, so one unanswered
prompt parks the whole fleet; the register is what stays true until the owner is back.

- Bypass permissions mode does not suppress an explicit `ask` rule, the standard's
  `Edit(**/docs/_standard/**)` in `.claude/settings.json` among them, so bypass is no preparation.
- Turn the ask into a deny: add `Edit(**/docs/_standard/**)` to `permissions.deny` in the gitignored
  `.claude/settings.local.json`, which a running session reloads, and confirm one refusal before
  leaving. Deny is evaluated before ask: an agent reaching the standard is refused and works on, and
  the change still waits for the owner.
- Add rules only. Removing or loosening a permission rule or a hook registration is the owner's to
  give, never yours to take, and the denies stay in force through the stretch.
- The prompt surface is not enumerable from the rules: the harness's permission classifier raises
  prompts no rule names, so one command running unprompted establishes that command alone.
- Undo by mechanism: a byte-exact backup, outside the tree, of a `settings.local.json` that existed
  before, and the restore command — the backup put back, or the file deleted where the deny created
  it — written into the register's unattended section and its resume point.
- Execute a pre-authorisation against its intent: where applying it literally would defeat its
  purpose, leave it unexecuted. Surface two instructions in tension as a tension.
- Record every call taken alone as it is taken, with its reasoning and what reversing it would cost.
- Deciding in the owner's place is a grant for a named stretch only, covering routine judgement on
  best-practice terms.
- A question that arises goes through no ask tool, which nobody would answer before the owner is
  back: queue it under the register's "Open, awaiting the owner" with its options, your
  recommendation first. Where it blocks work, build the recommended option provisionally and mark
  it so there; on the owner's return every queued question goes through the ask tool, in batches,
  each naming the provisional build it confirms or reverses. A rule change, and any string a visitor
  navigates by, waits for the owner.
