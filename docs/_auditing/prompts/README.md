# Audit prompts

One prompt per audit pass, grouped by surface, plus the two files every session loads.

```
prompts/
├── _shared-protocol.md   how to run any pass: report structure, coverage ledger, resume, handoff
├── remediation-wave.md   the session prompt for every remediation wave
├── frontend/             6 passes
├── backend/              4 passes
└── ops/                  2 passes
```

**The split is deliberate.** `_shared-protocol.md` holds the discipline that is identical across
passes, so it exists once and cannot drift per-prompt. A pass prompt holds only its **lens**: scope,
numbered checks, required tables, priority order, boundaries. `../README.md` holds everything above
a single session — the lifecycle, what may run concurrently, and what survives.

**Prompts state how to derive an inventory, never the inventory itself.** A grep or a config read,
not a list of files; a rule, not a count. Anything hardcoded drifts from the code and is then wrong
in a way no gate detects.

| Surface  | Pass | Lens                                      | Prompt                                                         |
| -------- | ---- | ----------------------------------------- | -------------------------------------------------------------- |
| Frontend | 1    | Deprecated and legacy patterns            | [`frontend/1-deprecated.md`](frontend/1-deprecated.md)         |
| Frontend | 2    | Architecture, dead code, tooling          | [`frontend/2-architecture.md`](frontend/2-architecture.md)     |
| Frontend | 3    | RSC and caching semantics, validation     | [`frontend/3-rsc-data.md`](frontend/3-rsc-data.md)             |
| Frontend | 4    | Security and authorization                | [`frontend/4-security.md`](frontend/4-security.md)             |
| Frontend | 5    | Accessibility and UX states               | [`frontend/5-a11y-ux.md`](frontend/5-a11y-ux.md)               |
| Frontend | 6    | Styling system and performance            | [`frontend/6-styling-perf.md`](frontend/6-styling-perf.md)     |
| Backend  | 1    | Data consistency and write-path integrity | [`backend/1-consistency.md`](backend/1-consistency.md)         |
| Backend  | 2    | Schema and contract boundary              | [`backend/2-schema-boundary.md`](backend/2-schema-boundary.md) |
| Backend  | 3    | Security and authorization                | [`backend/3-security.md`](backend/3-security.md)               |
| Backend  | 4    | Architecture, dead code, tests, tooling   | [`backend/4-architecture.md`](backend/4-architecture.md)       |
| Ops      | 1    | Build and deploy correctness              | [`ops/1-build-deploy.md`](ops/1-build-deploy.md)               |
| Ops      | 2    | Security and topology                     | [`ops/2-security-topology.md`](ops/2-security-topology.md)     |

Run a pass with `/audit:pass <surface> <n>`, which resolves `<surface>/<n>-*.md`. Within a surface
the passes run in numbered order: each one reads the earlier reports of its surface and cites them
instead of re-reporting.

## Adding or splitting a pass

- **Number it within its surface folder**, `<n>-<kebab-lens>.md`, and add a row to the table above.
  `/audit:pass` resolves by glob, so nothing else needs updating.
- **State the report path** the pass writes to, as `docs/audit/<surface-initial><n>-<lens>.md`.
- **Split a lens rather than letting one report grow too large to load.** A pass whose report cannot
  be opened in a wave session is a pass whose findings cannot be worked. Roughly eighteen checks
  across four themes is two passes, not one.
- **Begin the prompt by loading `_shared-protocol.md`**, and put nothing in it that the shared
  protocol already covers.
