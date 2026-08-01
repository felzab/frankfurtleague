# Ops pass 1 — build and deploy correctness

Paste into a fresh session (or run via `/audit:pass ops 1`).

---

Audit pass 1 of 2 on the ops surface. Lens: BUILD AND DEPLOY CORRECTNESS — does what ships match
what was verified, and does every step of the pipeline do what its documentation claims.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the report
to `docs/audit/o1-build-deploy.md`.

SCOPE — the ops surface as `docs/README.md` defines it: `docker-compose*.yml`, both Dockerfiles,
both `.dockerignore`s, `nginx/` (routing only — security posture is pass O2), everything in
`scripts/`, `.github/workflows/`, and the build-relevant config in both packages
(`next.config.ts` `output`, `pyproject` build metadata). `scripts/README.md` and
`docs/ops/{overview,spec}.md` are the documented claims this pass checks reality against.

MOTIVATING HISTORY, all real: `pnpm verify` was green twice while the built image was broken;
`instrumentation.ts` compiled at the repo root and was silently not traced into
`output: "standalone"`, disabling the env gate and all production error logging; both
`.dockerignore`s had ~75 markdown-escaped patterns that matched nothing, shipping host
`node_modules`/`__pycache__` into Linux images; CI once failed on an action version that had never
existed. The lens, stated once: **local-green is not image-green — every check in this pass asks
what only the built artifact or the real pipeline can show.**

THE CHECKS, in priority order:

1. **IMAGE CONTENTS VS INTENT.** For each image: build it and enumerate what actually ships.
   Frontend: everything the app needs is traced into the standalone output (`instrumentation.js`
   sanity check exists — verify it still tests the right file; is anything _else_
   silently-droppable the same way?), no dev dependencies, no source maps or `.env*` files, the
   asset set complete. Backend: bytecode/source layout, no test/venv leakage. Compare image size
   and layer list against the last published tags for unexplained growth.

2. **DOCKERIGNORE AND DOCKERFILE TRUTH.** Every ignore pattern actually matches something or is
   documented as prospective (the escaping damage was invisible precisely because dead patterns
   look identical to live ones — spot-check by building with a probe). Dockerfiles: base images
   pinned and current-enough, `ARG`s consistent with `packageManager`/`engines`/`requires-python`,
   layer ordering sane for caching, no build step depending on network state it does not pin.

3. **COMPOSE WIRING.** For each service in both compose files: env propagation (and what happens
   when a variable is absent — the startup gate should fail closed, verify the chain
   healthcheck → `service_healthy` → nginx never starting), depends_on conditions, volumes and
   mounts (certs, configs — `deploy.sh` checks some of these; do the checks match the mounts?),
   restart policies, port exposure. Diff local vs prod compose and verify every divergence is
   intended and documented (both files carry H5 headers with invariants — check the claims).

4. **SCRIPTS VS THEIR DOCUMENTATION.** For each script in `scripts/`: does it do what its header
   and `scripts/README.md` claim? Failure modes: what happens on a dirty tree, a half-pulled
   image, a dead daemon, Ctrl-C mid-run? Platform reality: they run under Git Bash on Windows
   (dev) and bash on Linux (prod) — any MSYS path-rewriting hazard (`docker run -v` without
   `MSYS_NO_PATHCONV=1`), any tool assumed present that is not on the target OS? Does
   `selfcheck.sh` actually cover the invariants the other scripts rely on?

5. **THE GATE'S COVERAGE MAP.** Build the required table: failure class | caught by
   `pnpm verify`? | by `verify.sh` full? | by CI? | by nothing. Include the known residents of
   "by nothing" (rendered-output defects, cache-tag wiring, anything behind auth) and hunt for new
   ones. Verify CI (`verify.yml`) runs the same script it claims (quick on PR, full on main), that
   the tree-diff step still guards the write-mode formatter, and that every action version exists
   (check the raw `action.yml` URL — release pages summarise unreliably).

6. **PUBLISH AND ROLLBACK.** `publish.sh` builds both images before pushing either (verify — this
   is the property that lets coupled FE/BE changes ship in one PR); tags carry the commit as an
   OCI label; rollback by `:sha-` tag works and the retention guidance (~5 tags per package) is
   stated somewhere real. What happens if publish dies between the two pushes?

7. **DEPLOY BEHAVIOUR.** `deploy.sh`: recreates in place, waits for health, confirms live headers;
   what does a _failed_ deploy leave running? Is the previous version still serveable? Does the
   documented rollback path actually reference images that exist after a normal publish cycle?

CROSS-SURFACE QUESTIONS: which manual steps are ritual (accepted) versus trap (undocumented
dependency on the operator remembering something) is owner knowledge — collect and batch per the
shared protocol, with `scripts/revalidate_reference_data.sh` (the BE-4 runbook step) as a known
example of an accepted manual step.

BOUNDARIES — not this pass: nginx security posture, headers, TLS, rate limits, secret reachability
→ pass O2 · application-code findings discovered while probing images → file as questions/rows for
the owning surface's programme, do not report here beyond a pointer.
