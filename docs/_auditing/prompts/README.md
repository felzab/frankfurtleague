# Audit prompts

```
prompts/
├── _shared-protocol.md   how to run any pass: what "done" means, report structure, resume, handoff
├── remediation-wave.md   the session prompt for every remediation wave
├── risk/                 1 pass, run FIRST in every programme
├── frontend/             6 passes
├── backend/              4 passes
├── ops/                  2 passes
└── crosscut/             1 pass, run LAST in every programme
```

**Risk first, surface passes in the middle, crosscut last.** The risk pass supplies the consequence
axis — what would actually hurt — and assigns coverage to the passes that follow. The surface passes
find the defects. The crosscut pass covers the seams, which belong to no surface. A programme that
runs only the middle is a programme whose lenses are all shaped like the stack.

| Surface  | Pass | Lens                                      | Prompt                                                                   |
| -------- | ---- | ----------------------------------------- | ------------------------------------------------------------------------ |
| Risk     | 1    | Failure modes and audit coverage          | [`risk/1-failure-modes.md`](risk/1-failure-modes.md)                     |
| Frontend | 1    | Deprecated and legacy patterns            | [`frontend/1-deprecated.md`](frontend/1-deprecated.md)                   |
| Frontend | 2    | Architecture, dead code, tooling          | [`frontend/2-architecture.md`](frontend/2-architecture.md)               |
| Frontend | 3    | RSC and caching semantics, validation     | [`frontend/3-rsc-data.md`](frontend/3-rsc-data.md)                       |
| Frontend | 4    | Security and authorization                | [`frontend/4-security.md`](frontend/4-security.md)                       |
| Frontend | 5    | Accessibility and UX states               | [`frontend/5-a11y-ux.md`](frontend/5-a11y-ux.md)                         |
| Frontend | 6    | Styling system and performance            | [`frontend/6-styling-perf.md`](frontend/6-styling-perf.md)               |
| Backend  | 1    | Data consistency and write-path integrity | [`backend/1-consistency.md`](backend/1-consistency.md)                   |
| Backend  | 2    | Schema and contract boundary              | [`backend/2-schema-boundary.md`](backend/2-schema-boundary.md)           |
| Backend  | 3    | Security and authorization                | [`backend/3-security.md`](backend/3-security.md)                         |
| Backend  | 4    | Architecture, dead code, tests, tooling   | [`backend/4-architecture.md`](backend/4-architecture.md)                 |
| Ops      | 1    | Build and deploy correctness              | [`ops/1-build-deploy.md`](ops/1-build-deploy.md)                         |
| Ops      | 2    | Security and topology                     | [`ops/2-security-topology.md`](ops/2-security-topology.md)               |
| Crosscut | 1    | Contracts and seams between surfaces      | [`crosscut/1-contracts-and-seams.md`](crosscut/1-contracts-and-seams.md) |

The lifecycle, the session rules and the close-out live in [`../README.md`](../README.md).

## How a prompt is built

**A prompt carries only its lens** — scope, numbered checks, required tables, priority order,
boundaries. Everything identical across passes lives once in
[`_shared-protocol.md`](_shared-protocol.md), so it cannot drift per-prompt.

**A prompt states how to derive an inventory, never the inventory itself.** A grep or a config read,
not a list of files; a rule, not a count. Anything hardcoded drifts from the code and is then wrong
in a way no gate detects.

**Every prompt names its boundaries** — which findings belong to which other pass. Without that,
one defect becomes four differently-worded findings and the ledger's overlap map turns into
archaeology.

## Adding or splitting a pass

- Number it inside its surface folder as `<n>-<kebab-lens>.md` and add a row above. `/audit:pass`
  resolves `<surface>/<n>-*.md` by glob, so nothing else needs updating.
- Name the report path the pass writes to: `docs/audit/<prefix><n>-<lens>.md`, where the prefix is
  `r` risk · `f` frontend · `b` backend · `o` ops · `x` crosscut. The prefixes are one character and
  distinct, so a report is identifiable from its filename alone.
- **Split a lens rather than letting one report grow too large to load.** A pass whose report cannot
  be opened in a wave session is a pass whose findings cannot be worked. Roughly eighteen checks
  across four themes is two passes, not one.
- Begin the prompt by loading `_shared-protocol.md`, and put nothing in it that the shared protocol
  already covers.
