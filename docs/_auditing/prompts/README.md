# Audit prompts

**Folder purpose:** one prompt per audit pass, plus the protocol every pass session runs under.

## Folder overview

Listed in the order a programme runs them — risk, then the surface passes, then crosscut.
[`../programme.md`](../programme.md) carries that ordering and its reasoning; §1.6 there is how a
prompt is written, added or split.

| Read                                                                     | For                                                                     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [`_shared-protocol.md`](_shared-protocol.md)                             | Running any pass: what to read first, report structure, resume, handoff |
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
