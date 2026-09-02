---
paths:
  - ".github/**/*"
  - ".github/**/.*"
  - "nginx/**/*"
  - "nginx/**/.*"
  - "scripts/**/*"
  - "scripts/**/.*"
  - "**/Dockerfile"
  - "**/.dockerignore"
  - "docker-compose.yml"
  - "docker-compose.local.yml"
  - "fl_frontend/next.config.ts"
---

# Ratified decisions — ops, CI and packaging

`.claude/CLAUDE.md` §7's never-clauses for the deployment surface, on §7's terms.

- **nginx** — Disable origin compression; precompress brotli at build time
- **nginx** — Send `immutable` for a URL with no content hash
- **ci** — Pin `type=gha`'s version; share one cache scope; re-add `actions/cache`
- **gate** — Add a check to the gate without recording its measured cost; raise a job's budget without a measurement; make the budget advisory

Two paths above are not the deployment tree. `scripts/` is there for the cache clause and the gate
clause: the cache's three limbs are configured in `scripts/verify.sh`, its recorded argument the
comment beside them, and a check joins the gate through that file or a checker beside it, while
its cost is recorded in `.github/gate-wall-clock.tsv`. `fl_frontend/next.config.ts` is there for
the `immutable` clause, whose other write site is that file's `headers()` block.
