<!--
TEMPLATE — copy the matching block to the top of a source file; delete this block.
Rules: ../chapters/2-in-code.md
  - A directive ("use server", "use client") stays the file's first line, above the header.
  - In Python the docstring is the first statement, above the imports — below them it is silently
    a dead string expression. Title line first, then a blank line (ruff D205).
  - Hard cap 20 lines including delimiters. Only an ADR that exists may be cited.
-->

**TypeScript**

```ts
<a directive like "use server" goes here, as the file's first line, if the file needs one>

/**
 * <TOKEN> · <what this module is>
 *
 * <At most three sentences, why-first: what the module is for, and the structural fact that
 * explains its shape.>
 *
 * Invariants:
 * - <something true of this module that a reasonable change could violate silently>
 * - <another, or drop the list>
 *
 * See:
 * - ADR-<NNNN> — <short title>
 * - <the spec sheet or related module worth pointing at, or drop the list>
 */
```

**Python**

```python
"""
<TOKEN> · <what this module is>

<At most three sentences, why-first.>

Invariants:
- <something true of this module that a reasonable change could violate silently>

See:
- ADR-<NNNN> — <short title>
"""

<the imports start here, below the docstring>
```

\<Drop `Invariants:` or `See:` when it would hold nothing; most modules need only the title line
and a sentence or two of prose.\>
