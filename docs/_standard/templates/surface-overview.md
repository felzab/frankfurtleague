<!--
TEMPLATE — copy to docs/<surface>/overview.md and fill in. Delete this comment block.
Guidance: ../3-out-of-code.md, "Layer 3 — surface overviews"

An overview says what the surface is FOR, names its major parts, and links onward. It is read once,
front to back. It does not explain mechanisms — that is the spec sheet — and it does not argue —
that is the ADR.

THE SPINE, which every overview follows:

  header                      Verified against, Scope
  opening                     two or three sentences, no heading
  How it is organised         always first, always this name
  <surface-specific sections> as many as the surface needs
  Read next                   always last

AROUND 120 LINES, treated as a ceiling. An overview that is growing has started explaining
mechanisms, and mechanisms belong in the spec sheet. If a section describes HOW something works
rather than what it is and why it is shaped that way, move it.

The relative links under "Read next" resolve once this file sits at docs/<surface>/overview.md. They
do not resolve here, which is why the documentation gate skips templates.
-->

# \<Surface\> — overview

**Verified against:** `<sha>`, `<date>`
**Scope:** \<the directories and files this covers\>

Two or three sentences: what this surface is, and the one structural fact that explains most of its
shape. **Lead with the thing a reader would otherwise get wrong** — the assumption that costs an
afternoon is worth more here than a complete description.

## How it is organised

The major parts and the boundaries between them, in a short paragraph or a directory tree.

Say which constraints are **enforced mechanically** — a lint rule, a type, a test — and which are
convention. A reader needs to know which ones will fail loudly and which will not.

Where a rule has a deliberate exception, name it here and cite the ADR. An unexplained exception
reads as a mistake and gets "fixed".

## \<Surface-specific section\>

As many as the surface needs. Each one answers "what is this part for", not "how does it work".

A mermaid diagram earns its place where the shape is genuinely hard in prose — C4 levels 1 to 3 only,
never a code diagram (DS10). Skip it wherever prose is clearer.

## Read next

- [`spec.md`](spec.md) — the contract, the invariants, and what breaks
- [`../glossary.md`](../glossary.md) — the domain vocabulary
- The ADRs that govern this surface, by number and title
