<!--
TEMPLATE — copy the matching block to the top of a source file. Delete this comment block.
Guidance: ../2-in-code.md, "Tier 1 — the module header", which is where the rules live. This file
is the blocks themselves.

Three things that are load-bearing and easy to get wrong:

  1. TITLE FIRST, then a blank line. No banner rule above it — the first line is what a JSDoc hover
     and Python's help() show as the summary, and a row of dashes there is worse than nothing.
     Ruff's D205 fails a Python header that opens with a rule.
  2. A DIRECTIVE STAYS ABOVE THE BLOCK. "use server" / "use client" must be the file's first line,
     with the header below it. A mistake here fails at request time, not build time.
  3. IN PYTHON THE DOCSTRING MUST BE THE FIRST STATEMENT, above the imports. Below them it silently
     becomes a dead string expression — invisible to ruff, help() and editors. A comment may sit
     above it, because a comment is not a statement.

The section rules are drawn to a fixed column of 110. The labels are a fixed vocabulary —
INVARIANTS, DECISIONS, SEE ALSO — so the widths below are correct as pasted. Replace only the text;
never recompute the rules.

Only cite an ADR that exists: the documentation gate fails on a number resolving to no file. Where no
ADR governs the module, drop DECISIONS and let SEE ALSO point at the spec sheet.
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

With a directive, which stays the first line of the file:

```ts
"use server";

/**
 * <SLICE> · <what this module is>
 */
```

## TypeScript, reduced form

For a small module. Drop any section that would hold fewer than two entries and fold the rest into
prose. **The header must never exceed about a third of the file.**

```ts
/**
 * <SLICE> · <what this module is>
 *
 * Two or three sentences carrying the purpose and any single invariant inline, with the ADR cited in
 * parentheses (ADR-NNNN).
 */
```

## Python

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
