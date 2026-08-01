# ADR-0017 — Publish to GitHub Container Registry as two public packages

**Status:** Accepted
**Date:** 2026-08-01
**Surface:** ops
**Supersedes:** —
**Superseded by:** —
**Source:** Raised by the owner alongside taking the repository public; the analysis was carried as
open item OPS-1 until this decision closed it.

## Context

Both images were published to a **single private Docker Hub repository**, `felzab/frankfurtleague`,
with the service name carried in the tag — `:frontend`, `:frontend-sha-1a2b3c4`, `:backend`,
`:backend-sha-1a2b3c4`. Tags were ordered `<service>-<qualifier>` so that alphabetical listings
grouped each service together.

None of that was a design preference. Docker Hub's free plan allows exactly **one** private
repository, so both services had to share it, and the tag prefix was the only thing left to tell
them apart.

Three facts then changed at once. The repository became **public** on GitHub, so code and images no
longer needed two accounts and two authentication stories. The account was renamed to `felzab`,
forcing a pass over every reference anyway. And GitHub Packages is **free and unlimited for public
packages**, which removes the constraint that produced the tag-multiplexing in the first place.

The binding constraint on the new arrangement is quota. A free personal account gets **500 MB of
package storage and 1 GB/month of transfer for _private_ packages — shared with GitHub Actions
artifacts.** The two images measure roughly 370 MB and 379 MB uncompressed, perhaps half that as
compressed layers, deduplicated across `sha-` tags. Two private packages plus a few rollback tags
sit at or past that ceiling, and publishing is blocked once it is exhausted with no payment method
on file. For _private_ images Docker Hub's free plan is the more generous option — which is exactly
why the old arrangement existed.

One property of the old setup is load-bearing and easy to lose: **the registry is the rollback
mechanism.** `deploy.sh` rolls back by pulling a pinned `sha-` tag, so registry retention is not
housekeeping — it is the recovery path.

## Decision

**Publish to `ghcr.io` as two packages, one per service, both public.**

- `ghcr.io/felzab/frankfurtleague-frontend`
- `ghcr.io/felzab/frankfurtleague-backend`

Each carries a moving `:latest` tag and immutable `:sha-<commit>` tags. The service name lives in
the **repository**, not the tag, so every tag string says only which build it is.

**Take a clean break on rollback history.** The Docker Hub repository is deleted once a ghcr deploy
is confirmed healthy. Historical `sha-` tags are not re-pushed.

**Package visibility is public, and that is a required step, not a default.** A package created by a
first push is private until changed by hand. Leaving it private breaks the server's anonymous pull
and produces an authentication error that looks like a credentials problem and is not — `deploy.sh`
says so at the failure site.

## Consequences

**The server needs no registry credentials at all.** Anonymous pulls work for public packages, so
there is no token on the production host to manage, rotate, or discover has expired mid-deploy. This
is the largest practical gain and it removes a whole class of failure.

**Publishing needs a token with `write:packages`**, held only on the development machine.

**Everything is on one provider now.** A GitHub outage blocks code, CI and image pulls
simultaneously, where Docker Hub and GitHub previously failed independently. Assessed and accepted:
deploys here are manual and unhurried, nothing depends on shipping during an outage, and the
server's previously deployed images remain in its local Docker store — so an emergency rollback can
retag locally and run `docker compose up -d` without reaching any registry.

**There is a window with no rollback target.** Immediately after the migration exactly one build
exists on ghcr, so `deploy.sh sha-<older>` has nothing to pull until a few publishes accumulate. The
local-image fallback above is the mitigation, and it is why the Docker Hub repository is deleted
only after a ghcr deploy is confirmed healthy.

**Tag strings simplify and one grep had to change.** `deploy.sh --status` matched rollback
candidates on the substring `-sha-`, which no longer appears now that the tag is `sha-1a2b3c4`; it
is anchored on the tag instead. Left unfixed it would have reported "none pinned locally" forever —
silently, and only noticed when a rollback was needed.

## Alternatives rejected

**Stay on Docker Hub.** Free, working, and independent of GitHub. Rejected because it keeps a second
account and credential story for no benefit now that the code is public, keeps the tag-multiplexing
workaround, and Docker Hub's free tier now applies pull-rate ceilings that ghcr does not.

**Move to ghcr but keep one package with tag prefixes.** Would have preserved the existing tag
scheme and required no `--status` fix. Rejected because the scheme's only justification was Docker
Hub's one-private-repo limit; carrying a workaround past the constraint that caused it is how
codebases accumulate unexplainable conventions.

**Private packages.** Rejected on quota, as above: the two images exceed the free private allowance
almost immediately, and the alternative is paying for storage to hide source that is already public.

**Re-push the last ~5 `sha-` tags to ghcr for continuity.** Rejected as cost without benefit. It
means pulling roughly 2 GB, retagging and pushing — and those images carry OCI `revision` labels
pointing at commits that no longer exist after the 2026-08-01 history rewrite, so the rollback
targets would be unidentifiable anyway. Continuity would have been cosmetic.

## See also

- `scripts/_lib.sh` — the single definition of registry and repository names
- `scripts/README.md` — the publish/deploy procedures and the retention policy
- [`docs/ops/spec.md`](../ops/spec.md) — the services contract and its invariants
