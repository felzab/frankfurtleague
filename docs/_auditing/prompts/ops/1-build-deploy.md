# Ops pass 1 — build and deploy correctness

Audit pass `ops 1` on the ops surface. Lens: BUILD AND DEPLOY CORRECTNESS — does what ships match what
was verified, and does every step of the pipeline do what its documentation claims.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the report
to `docs/audit/programme/o1-build-deploy.md`.

SCOPE — the ops surface (`docs/standard.md :: OUT-8`), narrowed to routing alone for `nginx/` because
its security posture is `ops 2`'s, and widened past that definition to `.github/workflows/`,
`.github/actions/`, both `.dockerignore`s and the build-relevant config in each package
(`next.config.ts` `output`, `pyproject` build metadata). `docs/ops/overview.md` and `docs/ops/spec.md`
are the documented claims this pass checks reality against.

DELIVERABLE: required tables — the gate coverage map (check 5) and the excess table (check 8, in the
shape the shared protocol sets). Every image claim comes from a built image, never from reading the
Dockerfile.

THE LENS, stated once: **local-green is not image-green.** Every check asks what only the built
artifact or the real pipeline can show. `docs/_auditing/lessons.md` §5 holds the classes that pass a
green local gate and break the image, and a third belongs to this pass alone: a CI action pin that
resolves to nothing, which fails only when CI runs.

THE CHECKS, in priority order:

1. **IMAGE CONTENTS VS INTENT.** For each image: build it and enumerate what actually ships.
   Frontend: everything the app needs is traced into the standalone output (the `instrumentation.js`
   sanity check exists — verify it still tests the right file; is anything _else_ silently-droppable
   the same way?), no dev dependencies, no source maps or `.env*` files, the asset set complete.
   Backend: bytecode and source layout, no test or venv leakage. Compare image size and layer list
   against the last published tags for unexplained growth.

2. **DOCKERIGNORE AND DOCKERFILE TRUTH.** Every ignore pattern actually matches something, or is
   documented as prospective. **Spot-check by building a probe image**: a dead pattern is invisible
   to inspection because it looks identical to a live one, and the build context cannot be probed by
   watching transfer sizes, since transfer is lazy and per-step. Dockerfiles: base images pinned and
   current-enough, `ARG`s consistent with `packageManager` / `engines` / `requires-python`, layer
   ordering sane for caching, no build step depending on network state it does not pin.

3. **COMPOSE WIRING.** For each service in both compose files: env propagation, and what happens when
   a variable is absent — the startup gate should fail closed, so verify the chain
   healthcheck → `service_healthy` → nginx never starting. Then `depends_on` conditions, volumes and
   mounts (certs, configs — `deploy.sh` checks some of these; do the checks match the mounts?),
   restart policies, port exposure. Diff the local and production compose files and verify every
   divergence is intended and documented — both files carry header blocks stating their invariants,
   so check those claims against what the file actually does.

4. **SCRIPTS VS THEIR DOCUMENTATION.** For each script in `scripts/`: does it do what its header and
   `docs/ops/spec.md` claim? Failure modes: what happens on a dirty tree, a half-pulled image, a dead
   daemon, Ctrl-C mid-run? Platform reality: they run under Git Bash on Windows (dev) and bash on
   Linux (prod) — any MSYS path-rewriting hazard (`docker run -v` without `MSYS_NO_PATHCONV=1`), any
   tool assumed present that is not on the target OS? Does `selfcheck.sh` actually cover the
   invariants the other scripts rely on?

5. **THE GATE'S COVERAGE MAP.** The required table: failure class | caught by the frontend scope? | by
   `verify.sh` full? | by CI? | by nothing. Include the known residents of "by nothing"
   (rendered-output defects, anything behind auth) and hunt for new ones; a class that is a
   cross-surface seam — cache-tag wiring is one — is crosscut 1 check 8's row, not this table's.
   Verify CI
   (`verify.yml`) runs the scopes its path mapping claims (scope jobs per touched surface on a pull
   request, everything on main), that the tree-diff step still guards `fl_frontend/tsconfig.json`
   against the rewrite `next typegen` and `next build` each make, and
   that every action reference in `.github/workflows/` and `.github/actions/` is pinned to a full
   commit SHA resolving to a real commit — the rule is `docs/_git/spec.md` §1.6 and the resolution
   procedure §1.5, whose annotated-tag step separates a pin that reads as valid from one no runner
   can resolve. Run that procedure per pin rather than trusting the trailing version comment, which
   is prose beside the pin and can disagree with it.

6. **PUBLISH AND ROLLBACK.** `publish.sh` builds both images before pushing either (verify — this is
   the property that lets coupled frontend and backend changes ship in one pull request); tags carry
   the commit as an OCI label; rollback by `:sha-` tag works and the retention guidance is stated
   somewhere real. What happens if publish dies between the two pushes?

7. **DEPLOY BEHAVIOUR.** `deploy.sh`: recreates in place, waits for health, confirms live headers;
   what does a _failed_ deploy leave running? Is the previous version still serveable? Does the
   documented rollback path actually reference images that exist after a normal publish cycle?

8. **EXCESS IN THE PIPELINE.** The candidates for this surface:

   | Class         | The candidate                                                                                     |
   | ------------- | ------------------------------------------------------------------------------------------------- |
   | `duplicated`  | The same step, healthcheck, env block or shell helper written out in two files                    |
   | `one-caller`  | A script function, workflow input or compose anchor used once                                     |
   | `hand-rolled` | A step reimplementing what Docker, Compose, GitHub Actions or a published action already provides |
   | `simpler`     | A plainly simpler construction reaching the same result                                           |
   | `dead-config` | An ignore pattern, compose key, workflow input, script flag or env declaration nothing reads      |

   Where the duplication is deliberate — the two compose files diverge on purpose, and their header
   blocks say so — cite the header and mark it already-correct. `dead-config` overlaps check 2 for
   ignore patterns: report those there, do not file twice.

CROSS-SURFACE QUESTIONS: which manual steps are accepted ritual, and which are traps that depend on
the operator remembering something undocumented, is knowledge only I have. The frontend-container
recreation after an out-of-band reference edit is a known example of an accepted manual step; check
`docs/ops/spec.md` for the others before filing any of them as findings.

BOUNDARIES — not this pass: nginx security posture, headers, TLS, rate limits, secret reachability →
`ops 2` · seam enforcement → the crosscut pass · application-code findings discovered while probing
images → file as questions or rows for the owning surface's programme, not here beyond a pointer.
