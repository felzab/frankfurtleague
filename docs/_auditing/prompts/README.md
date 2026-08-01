# Audit prompts

One file per pass, all in the same shape: the prompt carries only its **lens** — scope, numbered
checks, required tables, priority order, boundaries — and loads every shared rule from
[`_shared-protocol.md`](_shared-protocol.md) (report structure, coverage ledger, incremental
writing, resume protocol, ask-don't-guess, budget honesty, secrets). That split is deliberate:
shared discipline exists once and cannot drift per-prompt, and prompts stay fact-light — they state
how to _derive_ an inventory (a grep, a config read), never the inventory itself, because every
hardcoded fact in the first-generation prompts drifted.

The frontend prompts are the optimized successors of the five that ran the 2026-07 programme; the
originals' checklists survive here, their missteps in [`../lessons.md`](../lessons.md), and their
outcome in [`../reports/2026-07-frontend.md`](../reports/2026-07-frontend.md). The oversized
UI-quality lens is now two passes, which is why the frontend has six.

| Pass       | Lens                                        | Prompt                                                         |
| ---------- | ------------------------------------------- | -------------------------------------------------------------- |
| Frontend 1 | Deprecated and legacy patterns              | [`frontend-1-deprecated.md`](frontend-1-deprecated.md)         |
| Frontend 2 | Architecture, dead code, tooling            | [`frontend-2-architecture.md`](frontend-2-architecture.md)     |
| Frontend 3 | RSC/caching semantics, validation integrity | [`frontend-3-rsc-data.md`](frontend-3-rsc-data.md)             |
| Frontend 4 | Security and authorization                  | [`frontend-4-security.md`](frontend-4-security.md)             |
| Frontend 5 | Accessibility and UX states                 | [`frontend-5-a11y-ux.md`](frontend-5-a11y-ux.md)               |
| Frontend 6 | Styling system and performance              | [`frontend-6-styling-perf.md`](frontend-6-styling-perf.md)     |
| Backend 1  | Data consistency & write-path integrity     | [`backend-1-consistency.md`](backend-1-consistency.md)         |
| Backend 2  | Schema & contract boundary                  | [`backend-2-schema-boundary.md`](backend-2-schema-boundary.md) |
| Backend 3  | Security & authorization                    | [`backend-3-security.md`](backend-3-security.md)               |
| Backend 4  | Architecture, dead code, tests, tooling     | [`backend-4-architecture.md`](backend-4-architecture.md)       |
| Ops 1      | Build & deploy correctness                  | [`ops-1-build-deploy.md`](ops-1-build-deploy.md)               |
| Ops 2      | Security & topology                         | [`ops-2-security-topology.md`](ops-2-security-topology.md)     |

[`remediation-wave.md`](remediation-wave.md) is the session prompt for every remediation wave.

## Running a programme

The cycle per pass: run the prompt in a fresh session → verify the report file exists in
`docs/audit/` → `/clear` → next pass. `/clear` between passes is mandatory — stale context from one
pass makes the next one summarise instead of scan. If a session dies mid-pass, the resume protocol
in `_shared-protocol.md` continues it from the last completed check.

After the last pass: `/audit:plan` builds the ledger, waves run via `/audit:wave`, and
`/audit:finish` writes the final report and retires `docs/audit/`.
