---
description: Official docs URL plus recent breaking changes for a technology
argument-hint: "[technology, e.g. heroui, tailwind, motor]"
allowed-tools: WebSearch, WebFetch
---

Provide current official documentation for: **`$ARGUMENTS`**

If no technology is given, list the `CLAUDE.md` §7 source table and stop.

**Steps:**
1. Prefer the canonical URL from the `CLAUDE.md` §7 source list when the technology is in it.
2. Search for the official docs when it is not, or when the listed URL looks stale.
3. Summarize breaking changes from recent releases — prioritize those affecting patterns this repo actually uses.

**Output:** official URL · current stable version · breaking changes relevant to this repo · migration note if any apply.

Do not summarize from training data alone. If the docs cannot be reached, say so plainly and give the URL unverified rather than guessing at its contents.
