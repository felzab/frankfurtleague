<!--
TEMPLATE — copy to docs/<surface>/overview.md; delete this block.
Rules: ../chapters/3-corpus.md — the spine is OUT-5.
  - Around 120 lines, treated as a ceiling: an overview that is growing has started explaining
    mechanisms, and mechanisms belong in the spec sheet.
  - The relative links under "Read next" resolve from docs/<surface>/, not from this folder —
    the gate skips templates for exactly this reason.
-->

# \<Surface\> — overview

**Verified against:** `<sha>`, \<yyyy-mm-dd\>\
**Scope:** \<the directories and files this covers\>

\<Two or three sentences: what this surface is, and the one structural fact that explains most of
its shape. Lead with the thing a reader would otherwise get wrong — the assumption that costs an
afternoon is worth more here than a complete description.\>

## How it is organised

\<The major parts and the boundaries between them, in a short paragraph or a directory tree. Say
which constraints are enforced mechanically — a lint rule, a type, a test — and which are
convention. Where a rule has a deliberate exception, name it and cite the ADR: an unexplained
exception reads as a mistake and gets "fixed".\>

## \<Surface-specific section\>

\<As many of these as the surface needs. Each answers "what is this part for", never "how does it
work". A mermaid diagram earns its place where the shape is genuinely hard in prose — C4 levels
1–3 only (OUT-7).\>

## Read next

- [`spec.md`](spec.md) — the contract, the invariants, and what breaks
- [`../glossary.md`](../glossary.md) — the domain vocabulary
- \<the ADRs that govern this surface, by number and title\>
