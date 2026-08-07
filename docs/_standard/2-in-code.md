# In-code documentation

**Verified against:** `cf88b87`, 2026-08-07

Applies to `fl_frontend/src` and `fl_backend/app`. The principles in
[`1-principles.md`](1-principles.md) apply here too; this chapter adds what is specific to source
files.

Every example is real code from the `spiele` slice, so one subject runs through this chapter,
[`3-out-of-code.md`](3-out-of-code.md) and the templates.

| Section                                                             | Covers                                        |
| ------------------------------------------------------------------- | --------------------------------------------- |
| [The rule that outranks the rest](#the-rule-that-outranks-the-rest) | Never restate a type                          |
| [Three altitudes](#three-altitudes)                                 | Which tier a given fact belongs to            |
| [Tier 1 — the module header](#tier-1--the-module-header)            | Shape, placement, what goes in INVARIANTS     |
| [Tier 2 — symbol documentation](#tier-2--symbol-documentation)      | Where a docstring is required, and tests      |
| [Tier 3 — inline comments](#tier-3--inline-comments)                | The surprise, at the line                     |
| [Citations](#citations)                                             | What a comment may cite                       |
| [Enforcement](#enforcement)                                         | What is checked mechanically, and what is not |

---

## The rule that outranks the rest

**Never restate a type.**

Both sides of the stack are fully typed. `@param filters - Query filters` restates what
`filters: FLSpieleFilterParams` already says, and every restatement is one more thing that can go out of
date on its own. This is not machine-checkable; it is a review judgement, and it is recorded in
CLAUDE.md's quality bar.

Document **why**, the constraint, the rejected alternative, the trap. Not what the next line does.

## Three altitudes

| Tier | Unit            | Job                                                                            | Update trigger                            |
| ---- | --------------- | ------------------------------------------------------------------------------ | ----------------------------------------- |
| 1    | module          | what this file is, its invariants, which ADRs govern it                        | the module's purpose or invariants change |
| 2    | exported symbol | why it is shaped this way; one line of what, only if the name doesn't carry it | the reasoning changes                     |
| 3    | line            | the surprise, at the line                                                      | the line changes                          |

---

## Tier 1 — the module header

Format **H5**: labelled sections separated by horizontal rules.

### Shape

**The first line is the title, then a blank line, then the prose.** No enclosing banner rules above the
title. Section rules (`INVARIANTS`, `SEE ALSO`, …) provide the visual separation.

This was revised on 2026-08-01, after the original enclosing-banner form met the tooling: the first
line of a docstring is what `help()`, `pydoc` and editor hovers display as the summary, and a row of
dashes there is actively worse than nothing. Ruff's `D205` catches it in Python. The same argument
applies to a JSDoc block, whose first line shows in hover tooltips, so both languages use the same
shape.

### Mechanics

- Rules are drawn to a **fixed column of 110**. Both toolchains allow 144
  (`fl_frontend/.prettierrc.json` `printWidth: 144`; `fl_backend/pyproject.toml` `line-length = 144`),
  so 110 leaves margin and stays readable.
- Section labels come from a **fixed vocabulary**: `INVARIANTS`, `DECISIONS`, `SEE ALSO`. Because the
  set is fixed, the rule widths are a template you paste — never arithmetic you redo. This is what
  keeps the rules from going crooked.
- Prettier's `proseWrap: "preserve"` means it will not reflow header content. Verified.
- **Scaling rule:** the full header runs ~18 lines, which is absurd on a 30-line module. Keep the title
  rules, drop any section that would hold fewer than two entries, fold the rest into prose. **The
  header should never exceed about a third of the file.**

### Where the header goes

**Top of the file, above the imports, in both languages.**

In Python this is a language rule, not a convention: PEP 257 defines the module docstring as the
**first statement** in the module. Below the imports it is not a docstring at all — it becomes a dead
string expression, invisible to `help()`, to `pydoc` and to ruff's `D` rules. A comment may precede it,
because a comment is not a statement.

In TypeScript there is no language-level equivalent. The convention comes from JSDoc's file-overview
block (`@fileoverview` in Google's style guide), which sits at the top of the file before imports. It
is a documentation-tool convention rather than a rule, but it is the standard one.

**One exception, and it is load-bearing:** a directive — `"use server"`, `"use client"`, `"use strict"`
— stays on the **first line, above the header block**. The ECMAScript spec permits comments before a
directive prologue, and bundlers generally accept them, but a mistake here fails at _request time_
rather than at build time. This codebase has already been bitten by that class of bug, so the header
goes below the directive and says so.

```ts
"use server";

/**
 * SPIELE · server action
 *
 * NOTE: the directive stays the first line, above this block.
 */
```

### TypeScript — full form

```ts
/**
 * SPIELE · read & write path
 *
 * The slice's only cached read (`getSpiele`) and its only writer (`patchAdminSpielDataAction`). Both live
 * here so that every cache tag declared in this file is invalidated in this file.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Every granular cache tag declared here is invalidated in this same file.
 *   • Base tags invalidate unconditionally; granular tags only when a season id parses.
 *   • `saison_id` reaches the action as an argument, never on the patch body.
 *
 *  DECISIONS ────────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   ADR-0001  two granular cache tags kept, twenty deleted
 *   ADR-0002  omitted season means the current season
 *   ADR-0005  the write path belongs to `spiele`, not `admin`
 */
```

**Cite only an ADR that exists** (DS5) — the gate fails on a number that resolves to no file. Where
no ADR governs the module, omit `DECISIONS` and let `SEE ALSO` point at the spec sheet.

### TypeScript — reduced form, for a small module

```ts
/**
 * SPIELE · derivations
 *
 * Pure derivation over a Spiel — no I/O, no caching, so it stays out of `queries.ts` (ADR-0004).
 * Parsing `ergebnis` lives here because its format is declared by `FLSpielSchema`: it is Spiel domain
 * knowledge, not something a `teams` view should re-implement.
 */
```

### Python

```python
"""
SPIELE · read endpoint

Serves `GET /spiele`, and compiles the filter parameters into a Mongo query.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • The current-season resolution stays in the handler; a Pydantic field default cannot query the DB.
  • `saison_phase="playoffs"` is an alias compiled to "not gruppenphase". It is not a stored value, so
    it must never be written into a document.

 DECISIONS ────────────────────────────────────────────────────────────────────────────────────────────────

  ADR-0002  omitted season means the current season
"""

from fastapi import APIRouter, Depends
```

### What goes in `INVARIANTS`

Statements that are **true of the module and would break something if violated**. Not a summary of what
the code does. The test: could a reasonable change violate it silently? If yes, it belongs.

Good — "`saison_id` reaches the action as an argument, never on the patch body." Someone will
reasonably try to move it, and nothing would fail loudly.

Bad — "Exports `getSpiele` and `patchAdminSpielDataAction`." The file says so.

---

## Tier 2 — symbol documentation

### Required

| Where                                 | Why                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Every FastAPI endpoint                | FastAPI publishes the docstring as the operation `description` in `/openapi.json`, and `summary=` as its title |
| **Every test function**               | One sentence saying what it **covers** — see below                                                             |
| Anywhere with a _why_ worth recording | The thing that cannot be re-derived from source                                                                |

Everywhere else is judgement. There is **no** "every exported symbol" rule — that manufactures filler on
symbols whose names already say everything.

### Tests (DS13)

Every test gets a docstring, and **it must say what is covered rather than paraphrase the name**:

```python
@pytest.mark.parametrize("email", ["not-an-email", "@example.com", "a@", "a@b", "a b@example.com"])
def test_rejects_a_malformed_email(kontakt, email):
    """Five near-misses, including `a@b` — a shape a naive "contains @" check would let through."""
```

The name already said "rejects a malformed email". The docstring says _which_ shapes, and which one is
the interesting one — the part a reader scanning five strings cannot work out.

Worth saying, in rough order of value: **what the parametrised cases span** and which is load-bearing;
**the failure it guards against**, where the test exists because something broke; and **why a case that
looks redundant is not** — `00000` for a postcode, `0` for a version number.

If the docstring can only restate the name, that is a signal rather than a formatting problem: either
the name is vague, or the test is not pinning anything a reader would doubt. Fixture definitions in
`conftest.py` are out of scope.

**In TypeScript the `it("…")` string is the sentence** — there is no docstring to add, and the existing
names already read as full clauses ("rejects the script-bearing schemes that z.url() lets through").
Adding a comment above each would be the restatement this rule exists to prevent. Where a test needs
more than its name can carry, put a `//` comment above the `it()`.

### TypeScript

```ts
/**
 * Omitting `saison_id` yields the current season, not all seasons — the backend resolves it
 * (ADR-0002). Throws `APINetworkError` if the backend is unreachable; the landing page catches it.
 */
export async function getSpiele(filters: FLSpieleFilterParams = {}): Promise<FLSpieleListResponse> {
```

Note what is absent: no `@param`, no `@returns`. The signature carries both. What is present is the one
thing the signature cannot say — that an omitted filter means _current season_, not _all seasons_.

```ts
/**
 * `rawSaisonId` is used only for cache invalidation and must not move onto the patch body — the
 * backend model does not declare it and Pydantic would drop it silently (ADR-0001).
 *
 * No `prevState`: the caller awaits inside a transition rather than through `useActionState`, which
 * exists to hold state you *render*. This result only feeds a toast.
 */
export async function patchAdminSpielDataAction(rawPayload: unknown, rawSaisonId: unknown): Promise<NonNullable<FormState>> {
```

### Python — endpoint

The first paragraph becomes the OpenAPI description, so write it for someone reading the API, not the
implementation.

```python
@router.get("", response_model=FLSpieleListResponse, summary="List Spiele")
async def get_spiele(...) -> FLSpieleListResponse:
    """
    List Spiele matching the given filters.

    Omitting `saison_id` returns the current season, not every season. `saison_phase="playoffs"` is an
    alias for "not gruppenphase".

    This text is published as the operation description in /openapi.json.
    """
```

### Python — internal helper

No `Args:` / `Returns:` blocks. Prose, and only the part the signature cannot carry.

```python
def build_statistik_lookup_stage(saison_id: str, rules: FLSaisonRules, scope: FLTeamStatistikScope) -> Mapping[str, Any]:
    """
    The `$lookup` deriving one team's seven statistics from the season's matches (ADR-0026).

    A match counts exactly when it carries an `ergebnis`. `is_canceled` is deliberately not consulted:
    a cancelled match with a result is a forfeit, and a forfeit counts.
    """
```

---

## Tier 3 — inline comments

At the line, about the line. This is where the audit's reasoning mostly lives, and the repo already
does this well.

```ts
// Tags by phase or status were deleted: a result edit *changes* a match's status, so invalidating
// by status would need both the old and the new value to be correct (ADR-0001).
const tags: string[] = ["spiele"];
```

```python
    # Resolved here, not as a field default: a default is a constant and cannot reach the DB (ADR-0002).
    if filters.saison_id is None:
```

The pattern worth copying: **state the failed alternative.** "Invalidating by status would need both
values" is worth ten comments describing what the line does.

---

## Citations

Comments cite **ADR numbers**, never audit IDs.

```ts
// ✅  ... to be correct (ADR-0001).
// ❌  ... to be correct (ledger D2 / R3a-A2.1).
```

Audit IDs dangle the moment `docs/audit/` is archived, renumbered or superseded. ADR numbers are
permanent by construction.

**Only cite an ADR that exists**, and never invent a number to fill a gap. The documentation gate
fails on a citation resolving to no file in `docs/_decisions/`.

---

## Two rules about what a comment may say (DS14, DS15)

### Name only what exists

**A comment describes what the code IS. Never what it WAS, and never that something is absent.** Full
argument: [DS14](6-decisions.md#ds14--documentation-names-only-what-exists).

A rejected alternative is worth recording and does not break this rule — write it in the **present, as
a constraint**, aimed at the reader about to propose it again:

```python
# ❌  A reduced `compact` variant used to branch here and was removed: it trimmed 26 KiB.
# ✅  Never branch a reduced variant off it: measured 2026-08-02, the trim is 26 KiB across all 17
#     teams and no query work at all -- both lookups above run either way (ADR-0034).
```

A **measurement with a date is not history** and stays. What is banned is the change, not the timestamp.

Greppable, and the grep is worth running over a branch diff before committing — reading the hits is
required, because "the former … the latter" is ordinary English:

```bash
git diff main...HEAD -U0 | grep -niE "former|used to|was removed|no longer|previously|moved here"
```

### Point at the ADR; do not restate it

**A header section running past about five lines, or repeated in a second file, is an ADR that has not
been written yet.** State the rule in one or two lines, cite the number, and let the argument live in
the ADR. Full argument: [DS15](6-decisions.md#ds15--a-module-header-points-at-the-adr-it-does-not-restate-it).

The claim must be stated in full (DS12); the **argument** is what gets cited (DS5). A reader who never
opens the ADR must still know not to violate the rule — what they lose is _why_, never _what_.

```python
#  ✅  • `/teams/{team_id}/saisons/{saison_id}` addresses a JUNCTION ROW, not a season document. A GET
#         added here must return junction rows (ADR-0034).
```

---

## Enforcement

Deliberately minimal.

| Tool                  | Decision                                                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ruff `D` (pydocstyle) | A narrow **formatting** subset, so docstrings that exist are shaped alike. The selected codes are in `fl_backend/pyproject.toml` under `[tool.ruff.lint]` — read them there rather than from a copy |
| ruff `D1xx`           | **Excluded.** `D103` would demand a docstring on every function and manufacture exactly the boilerplate this standard rejects                                                                       |
| `eslint-plugin-jsdoc` | **Not added.** Its useful rules police `@param` completeness, which this standard does not use                                                                                                      |
| never restate a type  | Not enforceable. Review judgement, recorded in CLAUDE.md                                                                                                                                            |

The rule selections live in `fl_backend/pyproject.toml` and `fl_frontend/eslint.config.mjs`. Read
them there; a copy here would be one more thing that can disagree with the source (P4).
