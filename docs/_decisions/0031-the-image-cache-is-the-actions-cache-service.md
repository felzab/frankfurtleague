# ADR-0031 — The image build cache is the Actions cache service, reached through a local action

**Status:** Accepted\
**Date:** 2026-08-05\
**Surface:** ops\
**Supersedes:** —\
**Superseded by:** —\
**Source:** CI measurement of 2026-08-05 — both runs of pull request 50 showed the actions/cache
path restoring perfectly and saving nothing.

## Context

CI's `images` job cached Docker layers with `actions/cache` holding a `type=local` buildx cache
directory. **It restored perfectly and saved nothing that mattered.** Measured on both runs of pull
request 50:

|                                   | Run 1                     | Run 2                     |
| --------------------------------- | ------------------------- | ------------------------- |
| Cache restore — exact hit, 547 MB | 5s                        | 7s                        |
| Frontend image build              | **107s**                  | **124s**                  |
| Backend image build               | 16s                       | 18s                       |
| Cache save                        | 0s — _"not saving cache"_ | 0s — _"not saving cache"_ |

The key was `images-<hashFiles(pnpm-lock.yaml, uv.lock, both Dockerfiles)>`. **It did not describe
what the cache contained.** Those four files last moved on 2026-08-03, while the cached layers depend
on the whole `fl_frontend` and `fl_backend` trees, which moved six commits in the same period. Every
run therefore hit the key exactly, and `actions/cache` does not write on an exact hit — its log says
so in as many words. The entry froze at its 2026-08-04 contents and could never learn a newer layer,
while the complete cache buildx exported on every run was discarded when the job ended.

What survived was everything above the `COPY`: the base image and `pnpm install`. What could never
survive was `next build`, which is the expensive part and the reason the job existed to be cached.

Two constraints shaped the replacement.

- **`type=gha` cannot be reached from a `run:` step unaided.** Docker's documentation is explicit:
  "If you invoke the `docker buildx` command manually from an inline step, then the variables must be
  manually exposed." The runner injects `ACTIONS_RUNTIME_TOKEN` and `ACTIONS_RESULTS_URL` into
  JavaScript actions only.
- **A failed cache export fails the build, but only at the end of it.** `ignore-error` defaults to
  `false`, so a backend that cannot authenticate is fatal rather than silent — and the export runs
  after every layer has been built, so the cost is the whole build followed by a buildkit error
  naming a missing token rather than a missing step.

## Decision

**Use buildx's `type=gha` backend, one cache scope per image, and delete the `actions/cache` step.**
buildx talks to the Actions cache service itself and fetches only the blobs a build needs, so there
is no tarball to download, no directory to carry, and no key to go stale.

- **The credential comes from a local JavaScript action**, `.github/actions/actions-runtime-env`,
  which re-exports the runtime variables to `$GITHUB_ENV` and masks the token before it does.
- **Do not pin `version`.** buildx selects the live cache service from `ACTIONS_CACHE_SERVICE_V2`,
  which the action forwards; naming a retired service disables the cache without failing anything.
- **`scope` is per image.** A scope is one cache key, and buildx overwrites rather than merges, so a
  shared scope would have the backend build evict the frontend's entries on every run.
- **`verify.sh` refuses to build when `VERIFY_IMAGES_CACHE=gha` and no token is present.** buildx
  would fail too, but only after building everything and only with a message about a missing token;
  this moves the same failure to before the first layer and names the step that should have supplied
  it. **Leave `ignore-error` at its default.** Setting it true is what would make a broken cache
  silent, and a cache nobody notices is broken is the state this ADR exists to leave.
- **Locally there is no cache backend at all** — a plain `docker build` against the daemon's own
  layer cache, which is already warm and needs no export.

## Consequences

- The 547 MB download-and-discard cycle is gone, and with it the `actions/cache` step.
- The cache updates. Blobs are content-addressed, so there is no key to describe the contents wrongly
  and no save-on-miss rule to freeze it.
- **A JavaScript action to maintain.** Thirty-two lines of code importing nothing but `node:fs` and
  `node:crypto`, and the repository owns them.
- **`actionlint` has a floor of 1.7.12**, since `using: node24` is rejected by 1.7.7 as an invalid
  runner. Nothing bumps it automatically: Dependabot's `github-actions` ecosystem tracks `uses:`
  references, and `selfcheck.sh` reaches actionlint through `docker run`.
- **The runtime token reaches every later step of the `images` job.** It is masked, so the runner
  redacts it from the log, and its scope is the cache service rather than the repository.
- **A cache service outage now fails the gate**, because an export error is fatal by default. That is
  the right trade here — the alternative is `ignore-error=true`, which buys availability by making a
  dead cache indistinguishable from a working one — but it does mean CI depends on the cache service
  being up, where before it only depended on it for speed.
- **An import failure stays quiet.** `--cache-from` degrades to a cold build rather than an error, so
  a cache that cannot be read costs minutes and reports nothing. That direction is benign: the build
  is still correct, only slow.

## Alternatives considered

**Key the existing `actions/cache` entry on the source trees** —
`hashFiles('fl_frontend/**', 'fl_backend/**')` with `restore-keys`. Correct, and the cheapest fix: the
key would finally describe its contents, so an unchanged tree is a true hit and a changed one saves.
Rejected because it keeps the whole 547 MB round trip on every run and writes a new half-gigabyte
entry against a 10 GB quota each time the source moves, to reach a slower place than `type=gha`
reaches with no tarball at all.

**`crazy-max/ghaction-github-runtime`**, the action Docker's documentation points at. It does exactly
what the local one does. Rejected because it would be a fourth third-party action, requiring an
allowlist entry that only I can add, for thirty-two lines this repository can own outright —
and the allowlist exists to bound supply-chain surface (`docs/_git/spec.md`, Actions), which a
local action bounds strictly better.

**`type=registry` into ghcr**, alongside the images already published there. Genuinely attractive:
content-addressed, no Actions quota, and shared between CI and a development machine. Rejected on
permissions. `verify.yml` declares `contents: read` deliberately and publishes nothing, and this would
need `packages: write` on the gate itself. A fork's pull request receives no write token by design, so
the export would need conditional plumbing to avoid failing exactly the runs the repository is most
careful about.

**`docker/build-push-action`**, which populates the cache credentials on its own. Rejected because it
moves image building out of `verify.sh` and into the workflow, so the gate would no longer run
identically on a development machine and in CI — the property that makes one script the gate.

**`mode=min`.** Rejected because `next build` runs in a builder stage and `min` exports only the final
stage, so it would cache everything except the expensive thing.
