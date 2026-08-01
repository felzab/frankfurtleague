# ADR-0016 — One enforced CSP keeping `unsafe-inline`, with `react/no-danger` as the compensating control

**Status:** Accepted
**Date:** 2026-07-30
**Surface:** ops, frontend
**Supersedes:** —
**Superseded by:** —
**Source:** remediation ledger R3b-S9.1b

## Context

The Content-Security-Policy keeps `'unsafe-inline'` on `script-src`, which is the one directive that
makes a CSP meaningfully mitigate script injection. A policy with it is often described as
decorative.

A per-request nonce was implemented in `src/proxy.ts` and then removed. The question was whether to
restore it.

## Decision

**One enforced CSP, defined at server level in `nginx/*.conf`, keeping `'unsafe-inline'` on
`script-src`.**

**`react/no-danger` is set to `error`** in `eslint.config.mjs` as the compensating control.

## Consequences

The reason a nonce cannot work here: **24 routes ship a build-time prerendered shell**, and those script
tags cannot carry a per-request value. A nonce policy would therefore need a second mechanism for
prerendered HTML plus a standing exception for the framework's own inline scripts — three mechanisms
where there is now one, with the weakest of the three setting the real security level.

`react/no-danger` targets what a nonce would actually have mitigated: it forbids
`dangerouslySetInnerHTML`, which is the only realistic path for injected markup to enter this codebase.
It landed at `error` directly, having been measured at zero existing violations.

**The rest of the policy still does real work** and should not be dismissed along with `script-src`:
`frame-ancestors 'none'` blocks framing, `object-src 'none'` blocks plugin content, `base-uri 'self'`
blocks base-tag hijacking, and `form-action 'self'` blocks exfiltration via form posts.

**A trap that follows from setting headers in nginx:** `add_header` inside a `location` block _replaces_
the inherited set rather than adding to it. The `/_next/static/` block therefore repeats every security
header verbatim. Adding a header at server level without adding it there too silently exempts every
static asset.

**What would justify revisiting this:** the prerendered-shell constraint disappearing, or genuine need
for raw HTML rendering. If raw HTML is ever needed, that is the moment to reconsider a nonce-based
policy — not the moment to disable the lint rule.

## Alternatives considered

**Restore the per-request nonce in `proxy.ts`.** Rejected on the prerendering conflict above, and on a
second cost that is easy to miss: the nonce middleware ran `auth()` — a MongoDB round trip — in front of
public page loads. Removing it is why the matcher is now scoped to `/admin` alone.

**Report-only CSP alongside the enforced one.** Rejected: two policies to keep in step, and no
report-collection endpoint exists to receive the violations.

**Refactor the 24 prerendered routes to render dynamically so a nonce becomes possible.** Rejected
outright — it would trade the application's entire static-shell performance story for one directive.
