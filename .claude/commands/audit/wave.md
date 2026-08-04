---
description: Run a remediation wave — /audit:wave <id>, e.g. /audit:wave 2
---

Run remediation wave `$ARGUMENTS` of `docs/audit/programme/0-remediation-ledger.md`, in a fresh
session, on its own branch.

**Preconditions — check first, report what fails, stop where stated:**

| Check                                                   | If it fails                                                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The ledger exists                                       | **Stop.** Run `/audit:plan` first                                                                                                                                   |
| Its `Wave 0 status:` line reads `SETTLED <date>`        | **Stop.** Wave 0 answers routinely invert findings; a wave run before them can ship the exact opposite of the right fix. Present the open Part 1 questions and wait |
| The named wave exists in the ledger                     | **Stop.** List the waves that do exist                                                                                                                              |
| Every earlier wave is closed (no `[ ]` or `[~]`)        | **Stop** unless the owner says to proceed. Waves are dependency-ordered — later ones assume earlier work landed                                                     |
| `main` is up to date with `origin/main`                 | Pull before branching, so the wave does not build on a stale base                                                                                                   |
| The working tree is clean                               | **Stop.** Uncommitted work would be swept into this wave's commits                                                                                                  |
| Report drift since each cited report's `Audited at` SHA | Report it and raise the verification bar for this wave's rows accordingly                                                                                           |

**Steps:**

1. Read `docs/_auditing/prompts/remediation-wave.md` in full — it is the operating manual for this
   entire session.
2. Read the ledger, locate the wave, and take its `{SECTIONS}` and `{NOTES}` from the ledger's
   Part 6 table. Re-derive `{SECTIONS}` from the wave rows' `§` column and compare against Part 6 —
   if they differ, Part 6 is stale: correct it first, then use the derived list.
3. Substitute `{WAVE}`, `{SECTIONS}` and `{NOTES}` into the wave prompt and execute it as written:
   resume check → verify the findings → one batched owner consultation → implement with per-row
   commits → gate → independent review → wave report → consistency sweep → push → print the PR
   title and body.
4. Branch discipline: if not already on this wave's branch, create `wave-<id>-<kebab-name>` off
   current `main` before the first change. One wave = one branch = one PR; never merge across wave
   boundaries.

The session ends with the branch pushed and a single copy-paste block containing the PR title
(`Scope: what changed`) and body — the owner's only actions are Create PR and Merge on GitHub.
Open it with `gh pr create --draft`. Never `gh pr ready`, never `gh pr merge` — both are the owner's.
