<!--
TEMPLATE — copy the appropriate block into the top of a source file.
Guidance: ../2-in-code.md, "Tier 1 — the module header"

Rules are drawn to a fixed column of 110. Because the section labels come from a fixed vocabulary
(INVARIANTS, DECISIONS, SEE ALSO), the widths below are correct as-is — paste them, do not recompute
them. Replace only the text.
-->

# Module header — copy blocks

## TypeScript, full form

```ts
/**
 * <SLICE> · <what this module is>
 *
 * One or two sentences. What this module is for, and the structural fact that explains its shape.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Something true of this module that a reasonable change could violate silently.
 *   • Another.
 *
 *  DECISIONS ────────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   ADR-NNNN  short title
 *   ADR-NNNN  short title
 */
```

**The first line is the title, then a blank line.** No banner rule above it: the first line is what a
JSDoc hover and `help()` display as the summary, and a row of dashes there is worse than nothing.

**A directive stays above the block.** `"use server"` / `"use client"` must be the first line of the
file, with the header below it — a mistake here fails at request time, not build time.

**Only cite an ADR that exists** — the documentation gate fails on a number resolving to no file.
Where no ADR governs the module, omit `DECISIONS` and let `SEE ALSO` point at the spec sheet.

## TypeScript, reduced form

For a small module — drop any section that would hold fewer than two entries, and fold the rest into
prose. The header must never exceed about a third of the file.

```ts
/**
 * <SLICE> · <what this module is>
 *
 * Two or three sentences carrying the purpose and any single invariant inline, with the ADR cited in
 * parentheses (ADR-NNNN).
 */
```

## Python

**Placement matters.** The docstring must be the **first statement** in the file, above the imports. A
comment may sit above it, because a comment is not a statement. Below the imports it silently becomes a
dead string expression — invisible to ruff's `D` rules, `help()` and editors.

```python
"""
<MODULE> · <what this module is>

One or two sentences.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • Something true of this module that a reasonable change could violate silently.
  • Another.

 DECISIONS ────────────────────────────────────────────────────────────────────────────────────────────────

  ADR-NNNN  short title
"""

from fastapi import APIRouter
```

Ruff's `D205` enforces the title-then-blank-line shape, so a Python header that opens with a rule fails
the lint.

## What belongs in INVARIANTS

The test: **could a reasonable change violate it silently?** If yes, it belongs.

- ✅ "`saison_id` reaches the action as an argument, never on the patch body." Someone will reasonably
  try to move it, and nothing would fail loudly.
- ❌ "Exports `getSpiele` and `patchAdminSpielDataAction`." The file already says so.
