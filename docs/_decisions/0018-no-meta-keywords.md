# ADR-0018 — Ship no `keywords` meta tag

**Status:** Accepted
**Date:** 2026-08-01
**Surface:** frontend
**Supersedes:** —
**Superseded by:** —
**Source:** Raised by the owner during the PageSpeed remediation pass, when a metadata review found the
tag duplicated, misspelled and inconsistent across twelve routes.

## Context

Every route carried a `keywords` array in its `Metadata` export — twelve of them, between two and
eleven entries each, rendered as `<meta name="keywords">`.

Reviewing them turned up the usual decay of a field nothing validates: `Fussbal` for `Fußball`, the
pair `Frankfurt-League Dashboard` / `Frankfurt-League Saisonübersicht` listed twice in the same array
on `/dashboard/spielhistorie`, and case variants (`Frankfurt-League`, `Frankfurt-league`,
`Frankfurt league`) listed as if they were separate coverage when keyword matching has never been
case-sensitive. Nothing caught any of it, because nothing reads it.

What the engines say:

- **Google** has ignored it since 2009, announced explicitly because the tag was so widely abused.
- **Bing** does not treat it as a positive signal and has stated that **excessive keywords can be read
  as a spam signal**. This is the important one: it makes the tag a small liability rather than a
  harmless no-op.
- **Yandex** has described it as a very weak signal, negligible in practice.
- **Brave Search** publishes no position on it. No statement was found either way, and no evidence
  that its index uses the tag.

That last gap is worth stating plainly rather than papering over: the case for removal does not rest
on proof that Brave ignores the tag. It rests on the tag having no demonstrated benefit anywhere,
against one named engine that treats overuse as negative.

## Decision

**Ship no `keywords` meta tag. Do not add one back for a new route.**

The field is removed from all twelve `Metadata` exports. Ranking-relevant terms belong in the
`title` and `description`, which are read, and in the page's own copy.

## Consequences

**Twelve arrays stop drifting.** They were maintained by hand with no feedback loop, and a
maintained-but-unread field is a standing invitation to spend effort on nothing. Anyone tempted to
"improve the SEO keywords" now finds this file instead.

**One theoretical loss, accepted.** If Brave, Yandex or some future engine does read the tag, the site
gives up whatever tiny signal that was. Weighed against Bing's spam position and fifteen years of
Google ignoring it, that trade is not close.

**The description field carries more weight now**, since it is the only free-text metadata besides the
title that engines actually consume. All twelve sit between 134 and 149 characters, which is inside
the range search results display; keep new ones there.

## Alternatives considered

**Keep the tag and just fix it** — dedupe, correct the spelling, drop the case variants. Rejected
because it preserves the maintenance cost and the drift risk in exchange for a benefit no engine
confirms. Correct-but-unread is still unread, and the next reviewer has to re-derive this whole
argument to leave it alone.

**Keep it only on the homepage**, as a token. Rejected as the worst of both: it still has to be
maintained, it still risks Bing's spam reading, and one route's worth of an ignored tag cannot
plausibly do anything.

**Wait for a Brave statement.** Rejected as an open-ended block on a change that is otherwise clear.
If Brave publishes a position that the tag is read, this ADR is superseded rather than pre-emptively
weakened.

## See also

- [`docs/frontend/overview.md`](../frontend/overview.md) — the metadata and indexing rules for routes
- `fl_frontend/src/app/layout.tsx` — the root `Metadata` export
