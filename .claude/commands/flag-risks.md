---
description: Rate the last code block for security, performance, and maintainability risk
argument-hint: "[optional: file path or scope to analyze instead]"
---

Analyze for risk across three axes: **security**, **performance**, **maintainability**.

**Target:** `$ARGUMENTS` if provided. Otherwise the most recent code block in this conversation.

**Rate each finding HIGH / MEDIUM / LOW:**
- **HIGH** — exploitable, data-losing, or production-breaking. Includes: injection, missing authz/authn, secrets in code or logs, unvalidated input reaching the DB, unbounded queries.
- **MEDIUM** — degrades under real load or predictably causes future bugs. Includes: N+1 queries, missing indexes, unhandled rejections, race conditions, missing error boundaries.
- **LOW** — friction and clarity. Naming, duplication, weak typing, absent tests.

**Per finding:** Severity | Location (`file:line`) | What breaks and under what conditions | Concrete mitigation (code, not advice).

Order strictly by severity, highest first. State the concrete failure scenario — inputs or state that trigger it — not a generic label. If an axis is clean, say so in one line rather than padding it with speculation.
