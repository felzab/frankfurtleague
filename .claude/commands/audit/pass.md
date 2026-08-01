---
description: Run one audit pass — /audit:pass <backend|ops|frontend> <n>
---

Run the audit pass named by the arguments: `$ARGUMENTS` (surface, then pass number — e.g.
`backend 1`, `ops 2`).

**Steps:**

1. Resolve the prompt file: `docs/_auditing/prompts/<surface>-<n>-*.md` (frontend 1–6,
   backend 1–4, ops 1–2). If it does not exist, list the available prompts from
   `docs/_auditing/prompts/README.md` and stop.
2. Read `docs/_auditing/prompts/_shared-protocol.md` in full, then the resolved prompt file in
   full. The shared protocol governs everything: report structure, coverage ledger first,
   incremental writing, the resume protocol (check whether the target report already exists before
   writing), ask-don't-guess, budget honesty, the secrets rule.
3. Execute the pass exactly as the prompt specifies, writing to the report path it names under
   `docs/audit/` (create the directory if this is the programme's first pass).
4. Finish per the protocol's handoff: confirm the report file exists on disk, then tell the owner
   the pass is complete and that they must run `/clear` before the next pass — stale context from
   this pass poisons the next one. Do not start another pass in this session.

This command runs a **report-only** pass: zero fixes, zero source changes.
