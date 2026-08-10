# ADR-0061 — The sign-in redirect carries no `callbackUrl`

**Status:** Accepted\
**Date:** 2026-07-29\
**Surface:** frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** A finding of the frontend audit and remediation programme, 2026-07-29; the programme's
permanent record is `docs/_auditing/reports/2026-07-frontend.md`.

## Context

`fl_frontend/src/proxy.ts` runs ahead of every `/admin` request and sends a visitor without a
session to `/signin`. That redirect carried a `callbackUrl` naming the page the visitor had asked
for, and nothing anywhere consumed it: the sign-in page takes no props and reads no search
parameters, and the action that sends the magic link fixes where the link lands. An admin who
followed a link into a deep admin page therefore arrived somewhere else after signing in, exactly as
though the parameter were absent.

A parameter with no consumer is either wired up or removed, and wiring it up is the change a reader
reaches for, because it is the behaviour the parameter's name promises and the behaviour Auth.js
supplies by default. It is also the change that turns a value the visitor controls into the
destination of a redirect issued by a page they trust, which is the standard shape of an open
redirect. Making that safe is not a matter of care at the call site: it needs the value checked
against a set of destinations known in advance, and that check has to stay correct as the admin
route set grows.

## Decision

Redirect a session-less `/admin` request to `/signin` and nothing else — no query string, no return
path, in `fl_frontend/src/proxy.ts`. Where a visitor lands after signing in is fixed in the action
that sends the magic link (`fl_frontend/src/features/auth/actions.ts :: handleSignIn`), and it is
the admin root rather than anything derived from the request.

Restoring a return path means introducing the allowlist first. The allowlist is the decision; the
parameter is only what makes it necessary.

## Consequences

An admin who follows a deep link into the admin area while signed out lands at the admin root after
verifying, not at the page the link named. That is the entire cost, and it is paid on every session
that starts from a link rather than from the bookmark.

There is correspondingly nothing to review on this path. An open redirect needs a caller-supplied
value that reaches a redirect, and none does — so no validation can be written wrongly, skipped in a
refactor, or made stale by a new route.

The cost of that is legibility: a redirect carrying no parameter looks exactly like one nobody
thought about, and the pressure to add the parameter recurs every time deep-linking is noticed, with
the framework's own default arguing for it. What tells a deliberate absence from an oversight is the
invariant in the module header, which states the rule and cites this number rather than repeating
the argument.

## Alternatives considered

**Honour the parameter as the request supplies it.** The direct reading of what the parameter is
for, and the classic open redirect: an attacker chooses an absolute URL, the visitor authenticates
on a page they have every reason to trust, and the sign-in flow delivers them somewhere else.
Rejected outright — sign-in is reachable without a session, which makes it the worst place in the
codebase to put a caller-controlled destination.

**Honour it behind an allowlist of destinations.** The safe form, and the only safe form. Rejected
on what it buys rather than on whether it works: the gain is that an admin arriving by link saves a
navigation, and the price is a validation rule guarding the unauthenticated route, which every
future admin path has to be checked against. A convenience does not earn a security-critical rule
that has to be maintained forever to keep being correct.

**Leave the parameter in place and let nothing read it.** Rejected because a value with no consumer
reads as an unfinished feature: the next reader completes it, and completing it is the pass-through
above. Carrying no parameter is what makes the decision visible as a decision.
