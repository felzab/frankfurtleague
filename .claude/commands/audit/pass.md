---
description: Run one audit pass — /audit:pass <risk|frontend|backend|ops|crosscut> <n>
---

Run the audit pass named by the arguments: `$ARGUMENTS` (surface, then pass number — e.g.
`backend 1`, `ops 2`, `crosscut 1`).

**Preconditions — check all of these first, report anything that fails, and only stop where stated:**

| Check                                                                     | If it fails                                                                                                             |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| The prompt file exists                                                    | **Stop.** List the available prompts from `docs/_auditing/prompts/README.md`                                            |
| The target report has no complete verdict                                 | **Stop.** This pass already ran — say so rather than overwriting. A verdict-less file means resume instead              |
| `docs/audit/register.md` exists (any pass except `risk 1`)                | Warn: the risk pass has not run, so this pass has no assigned coverage and severity is unanchored                       |
| Earlier passes of this surface have reports                               | Warn and continue. Note it in the report header; the ledger will have overlap to untangle                               |
| The working tree is clean                                                 | Warn and continue. Record `Tree state: dirty (<n> files)` in the header — the report may describe code that never lands |
| `risk 1` only: the register's last-verified commit is not far behind HEAD | Report the drift and run in REFRESH mode                                                                                |

**Steps:**

1. Resolve the prompt file: `docs/_auditing/prompts/<surface>/<n>-*.md` (risk 1, frontend 1–6,
   backend 1–4, ops 1–2, crosscut 1).
   - `risk` runs **first** in a programme. Its register assigns coverage to the later passes, so
     running it after them wastes most of its value — say so if asked to run it late.
   - `crosscut` runs **last**, after that programme's surface passes. It derives both halves of every
     seam from the code, so it needs no other surface's report to exist.
2. Read `docs/_auditing/prompts/_shared-protocol.md` in full, then the resolved prompt file in
   full. The shared protocol governs everything: report structure, coverage ledger first,
   incremental writing, the resume protocol (check whether the target report already exists before
   writing), ask-don't-guess, budget honesty, the secrets rule.
3. Execute the pass exactly as the prompt specifies, writing to the report path it names under
   `docs/audit/programme/` (create the directory if this is the programme's first pass). The
   `risk` pass additionally writes the standing `docs/audit/register.md`, which is **never** placed
   inside `programme/` — that folder is deleted at close and the register must survive.
4. Finish per the protocol's handoff: confirm the report file exists on disk, then tell the owner
   the pass is complete and that they must run `/clear` before the next pass — stale context from
   this pass poisons the next one. Do not start another pass in this session.

This command runs a **report-only** pass: zero fixes, zero source changes.
