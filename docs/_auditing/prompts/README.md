# Audit prompts

**Folder purpose:** one prompt per audit pass, plus the protocol every pass session runs under and
the prompt a remediation wave loads.

## Folder overview

Listed in the order a programme runs them — risk, then the surface passes, then crosscut.
[`../programme.md`](../programme.md) carries that ordering and the reasoning behind it.

| Read                                                                     | For                                                                     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [`_shared-protocol.md`](_shared-protocol.md)                             | Running any pass: what to read first, report structure, resume, handoff |
| [`remediation-wave.md`](remediation-wave.md)                             | Running a remediation wave                                              |
| [`risk/1-failure-modes.md`](risk/1-failure-modes.md)                     | Failure modes and audit coverage                                        |
| [`frontend/1-deprecated.md`](frontend/1-deprecated.md)                   | Deprecated and legacy patterns                                          |
| [`frontend/2-architecture.md`](frontend/2-architecture.md)               | Architecture, excess, dead code, tooling                                |
| [`frontend/3-rsc-data.md`](frontend/3-rsc-data.md)                       | RSC and caching semantics, validation                                   |
| [`frontend/4-security.md`](frontend/4-security.md)                       | Frontend security and authorization                                     |
| [`frontend/5-a11y-ux.md`](frontend/5-a11y-ux.md)                         | Accessibility and UX states                                             |
| [`frontend/6-styling-perf.md`](frontend/6-styling-perf.md)               | Styling system and performance                                          |
| [`backend/1-consistency.md`](backend/1-consistency.md)                   | Data consistency and write-path integrity                               |
| [`backend/2-schema-boundary.md`](backend/2-schema-boundary.md)           | Schema and contract boundary                                            |
| [`backend/3-security.md`](backend/3-security.md)                         | Backend security and authorization                                      |
| [`backend/4-architecture.md`](backend/4-architecture.md)                 | Architecture, excess, tests, tooling                                    |
| [`ops/1-build-deploy.md`](ops/1-build-deploy.md)                         | Build and deploy correctness                                            |
| [`ops/2-security-topology.md`](ops/2-security-topology.md)               | Security and topology                                                   |
| [`crosscut/1-contracts-and-seams.md`](crosscut/1-contracts-and-seams.md) | Contracts and seams between surfaces                                    |

## Writing, adding or splitting a prompt

**A prompt states how to derive an inventory, never the inventory itself.** A grep or a config read,
not a list of files; a rule, not a count. Anything hardcoded drifts from the code and is then wrong
in a way no gate detects. **Every prompt names its boundaries** — which findings belong to which
other pass. Without that, one defect becomes four differently-worded findings and the ledger's
overlap map turns into archaeology. Begin it by binding
[`_shared-protocol.md`](_shared-protocol.md), and put nothing in it that the shared protocol already
covers.

A new lens is numbered inside its surface folder as `<n>-<kebab-lens>.md` and takes a row above;
`/audit:pass` resolves `<surface>/<n>-*.md` by glob, so nothing else needs updating. Name the report
path it writes to — `docs/audit/programme/<prefix><n>-<lens>.md`, where the prefix is `r` risk ·
`f` frontend · `b` backend · `o` ops · `x` crosscut — because the prefixes are single characters and
distinct, so a report is identifiable from its filename alone. **Split a lens rather than letting
one report grow too large to load**, at the size [`../lessons.md`](../lessons.md) records: a pass
whose report cannot be opened in a wave session is a pass whose findings cannot be worked.

## Read next

- [`../programme.md`](../programme.md) — the lifecycle, the pass order, the session rules, the
  close-out
- [`_shared-protocol.md`](_shared-protocol.md) — read this before running any pass
