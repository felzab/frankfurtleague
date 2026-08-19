---
description: Run one audit pass — /audit:pass <risk|frontend|backend|ops|crosscut> <n>
---

Run the audit pass named by the arguments — the surface, then the pass number: `$ARGUMENTS`

**Report-only: zero fixes, zero source changes.**

**Preconditions — check all of these first, report anything that fails, and only stop where stated:**

| Check                                                    | If it fails                                                                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| The prompt file exists                                   | **Stop.** List the available prompts from `docs/_auditing/prompts/README.md`                                            |
| The target report has no complete verdict                | **Stop.** This pass already ran — say so rather than overwriting. A verdict-less file means resume instead              |
| The risk pass's report exists (any pass except `risk 1`) | Warn: this pass has no assigned coverage and its severities are anchored to nothing                                     |
| Earlier passes of this surface have reports              | Warn and continue; note it in the report header, since the ledger will have overlap to untangle                         |
| The working tree is clean                                | Warn and continue. Record `Tree state: dirty (<n> files)` in the header — the report may describe code that never lands |

**Steps:**

1. **Read `docs/_auditing/lessons.md` in full**, before resolving anything else. It records the traps
   earlier programmes hit; a pass that skips it repeats them.
2. Resolve the prompt file by glob: `docs/_auditing/prompts/<surface>/<n>-*.md`. The available
   surfaces and pass numbers are the rows of `docs/_auditing/prompts/README.md`, read from there
   rather than from a list here.
   - `risk` runs **first** in a programme. Its coverage map assigns hazards to the later passes, so
     running it after them wastes most of its value — say so if asked to run it late.
   - `crosscut` runs **last**, after that programme's surface passes. It derives both halves of every
     seam from the code, so it needs no other surface's report to exist.
3. Read `docs/_auditing/prompts/_shared-protocol.md` in full, then the resolved prompt file in full.
   The shared protocol governs everything the pass does.
4. Append a start entry to `docs/audit/programme/state.md` naming this pass and the report it is
   about to write, in the shape `docs/_auditing/programme.md` §3 gives. Create the file, and the
   directory holding it, if this is the programme's first pass.
5. Execute the pass exactly as the prompt specifies, writing to the report path it names.
6. Finish per the protocol's handoff: confirm the report file exists on disk, append a done entry to
   `state.md` naming what it produced, then tell the owner the pass is complete and that they must
   run `/clear` before the next pass — stale context from this pass poisons the next one. Start no
   further pass in this session.
