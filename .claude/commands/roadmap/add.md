---
description: Add described items to the roadmap and re-rank the file — /roadmap:add, one `*` bullet per item
---

Add the items described in the arguments to `docs/roadmap/open-items.md`, then re-rank the whole
file: `$ARGUMENTS`

**Each top-level `*` bullet is exactly one item.** Never merge two bullets into one entry and never
split one bullet into two without asking. A bullet is a description, not the entry — the entry is
what you write after you have read the code it touches.

This command adds and re-ranks. **It never closes, deletes or implements anything** — that is
`/roadmap:start <ID>`, and it is a different session.

## Steps

1. **Read the rules before writing a line.** `docs/roadmap/README.md` in full — the issue boundary,
   the ranking rubric, the status derivation — and `docs/roadmap/open-items.md` in full, which is
   also the shape every new entry must match. Then `docs/_standard/chapters/1-core.md`: an entry is
   documentation and carries COR-1, COR-3, COR-6 and COR-9 like anything else.

2. **Triage each bullet, and say the result back before writing.** Three outcomes:

   | The bullet is                                      | Do                                                                                          |
   | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
   | Already covered by an entry in the file            | **Amend that entry**, do not open a second one. Say which entry and what you added to it    |
   | Small, decided, and doable in the session at hand  | Say so. The roadmap's own rule is "just do it" — an entry for a five-minute fix is ceremony |
   | A question with trade-offs, or owner-directed work | Open an entry                                                                               |

   Check `docs/roadmap/closed-items.md` too: a bullet describing something already closed is either a
   regression, which gets a **new** id, or a misunderstanding, which gets an answer instead of an entry.

3. **Research each item before writing its entry. This is the step that gives the file its value.**
   An entry that only restates the bullet in nicer words is worth nothing — the file exists so that a
   decision is taken with the analysis already in hand. For each item, establish and write down:

   - **What it actually touches**, cited the way COR-6 requires — `` `<file> :: <symbol>` `` or a file
     plus a short quoted fragment. Never a line number.
   - **What is already decided about it.** Search `docs/_decisions/`. An ADR that settles half the
     question turns an open argument into a scoped piece of work, and citing it is what stops the
     next session re-litigating it.
   - **Who consumes it** — the other entries, endpoints, components or collections that would have to
     change with it, and which of them are already in this file.
   - **What makes it non-trivial**, stated plainly. If it is genuinely trivial, say that instead.
   - **What you could not verify** (COR-9). A named gap is useful; a confident guess is a defect with a
     long half-life.

   **Never invent analysis.** Where a bullet is too thin to research — it names no surface, or the
   thing it describes cannot be found — that is a question for the owner, not a gap to fill with
   plausible prose.

4. **Ask everything at once, before writing.** Collect the questions from steps 2 and 3 and put them
   as **one batch** with a recommendation each. Only ask what changes the entry: a different answer
   must produce a different entry, or it is not a question worth the owner's time.

5. **Assign an id.** Take the prefix from the ids already in use, reading both roadmap files for what
   each one means: surface-scoped prefixes for surface work, and a named prefix of its own for a
   programme that belongs to no single surface. Invent a new prefix only for that last case, and say
   that you did.

   **The number is one past the highest that prefix has ever used, counting closed ids.** Ids are
   never reused — `closed-items.md` states this and its log is half the evidence.

6. **Write the entry in the file's own shape**, which you read in step 1: a `### <rank> · <ID> — <title>`
   heading, a bold lead sentence naming what the item is, the analysis, and a **`Path:`** line saying
   what it blocks and what blocks it. Give it `Surfaces`, an `Effort` from the file's own S/M/L/XL
   scale, and a `Status` derived by the README's derivation — never chosen by feel.

   Optimise the owner's description into the entry; do not transcribe it. Where the description
   carries an instruction — consult me first, check this against a source, record this reminder —
   that instruction is part of the entry and must survive into it, because the session that works the
   item will have only the entry.

7. **Re-rank the entire file**, by the rubric in `docs/roadmap/README.md`. Not "insert the new
   entries somewhere": every rank is re-derived, because a new entry can change what an old one is
   worth waiting for.

   - Renumber the index table **and** every `### <rank> ·` heading, and keep them in step.
   - Move entries between tiers where the rubric says so, and **rewrite each tier's opening
     paragraph** to describe the entries actually in it.
   - **Re-derive every row's `Status`**, not only the new ones. `Blocked` is a claim about another
     row, so an added entry can change rows nobody edited.
   - Fix every `Path` line the new entries affect, in both directions: what they block, and what
     blocks them.
   - **Say out loud which existing entries moved and why**, naming the test from the rubric that
     moved each one. A re-rank nobody can audit is a re-rank the owner has to redo.

8. **Update everything else that indexes these entries**, because CLAUDE.md's same-commit rule
   requires it. Search the repository for the ids and for the tables that list them — each surface
   spec sheet carries a `Known-open` section, and the audit prompts seed checks from these entries.
   Add the new item wherever its kind is listed; leave the rest alone.

9. **Re-read every entry against the code before you ship it.** Researching and writing in one pass
   is how a claim gets written from a grep that was half-read, and an entry states its evidence
   confidently enough that nobody checks it again for months.

   **The gate proves that a citation resolves. Only a reader proves that it supports the claim.** So
   re-open each file an entry cites and check the things that are wrong most often:

   - **Every count**, re-derived rather than remembered — "three files", "seven occurrences".
   - **Every _every_, _only_ and _never_.** A component shared by "every" caller usually has an
     exception, and the exception is the interesting half of the finding.
   - **Every claim about a framework** rather than about this repository. If the repo states it in a
     comment, cite that comment; if nothing states it, mark the claim unverified (COR-9).
   - **Every structural promise**: the index table and the `### <rank> ·` headings agree, rank by
     rank, and no id appears twice.

   Correct what is wrong, and **say in the handover what this step caught** — a step that never
   reports anything is a step nobody is really running.

10. **Restamp every stamped page this change touched**, not only `docs/roadmap/open-items.md`, per
    `docs/_standard/chapters/5-currency.md`. Step 8 routinely edits spec sheets, and each carries its own
    `Verified against` line. Editing a stamped page without moving its stamp fails the gate; moving a
    stamp without re-reading the page falsifies a record the gate treats as true.

11. **Ship it as one commit**, following `docs/workflows/README.md` — branch before the first write,
    `pnpm format` from `fl_frontend/`, then `./scripts/verify.sh --docs`. That stays the scope even
    when step 8 sends you into a source file, because a comment-only edit is a documentation change
    whatever file holds it. Then push and hand over the pull request link, title and body. Report the
    gate's actual exit code. The two-commit protocol belongs to closing an item and does not apply
    here.

12. **Hand over.** The new ids and where each ranked, the entries that moved and the test that moved
    them, the questions the owner answered and how each shaped an entry, what step 9 caught, and
    anything you could not verify. If a new entry now blocks or unblocks an existing one, say which.
