---
description: Search official docs for the whole stack, report version drift and breaking changes
allowed-tools: WebSearch, WebFetch, Read, Glob, Grep
---

Verify the project stack against current official documentation. Do not answer from training data alone.

**Scope** — check each against its official source (`CLAUDE.md` §7 source list):
Next.js 16 · HeroUI v3 · Tailwind CSS v4 · FastAPI · Pydantic v2 · Motor

**Steps:**
1. Read `fl_frontend/package.json` and `fl_backend/pyproject.toml` for the versions actually installed.
2. Search the official docs for each library's current stable release and recent breaking changes.
3. Compare three ways: installed version ↔ current release ↔ the mandates in `CLAUDE.md` §2.
4. Report drift explicitly. Flag any `CLAUDE.md` §2 claim that current docs contradict — the file is an assumption baseline, not ground truth, and a contradiction means §2 needs updating.
5. If a source is unreachable, say so per-library rather than silently skipping it.

**Output:** table of Library | Installed | Current | Status, then breaking changes that affect this repo, then any §2 corrections needed.

Close with: `Stack verification complete. Current as of [Date].`

After a successful run, responses this session may use the `Verified:` stack line (`CLAUDE.md` §4) instead of `Assumed:` — but only for the libraries actually confirmed above.
