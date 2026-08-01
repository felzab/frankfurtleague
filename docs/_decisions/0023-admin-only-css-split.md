# ADR-0023 — Admin-only component CSS ships in its own stylesheet

**Status:** Accepted
**Date:** 2026-08-01
**Surface:** frontend
**Supersedes:** —
**Superseded by:** —
**Source:** Looked for the payload win that brotli precompression could not justify (ADR-0022), by
measuring what the 330 KB stylesheet actually contains.

## Context

After ADR-0019 cut HeroUI to the components this app renders, the stylesheet was still 330,847 bytes,
and it is one file for every route because `globals.css` is imported by the root layout.

Measured on the deployed stylesheet:

| layer                       | bytes       |
| --------------------------- | ----------- |
| **components**              | **250,171** |
| utilities                   | 55,771      |
| theme                       | 28,439      |
| base, properties, unlayered | 18,910      |

**87,460 of that components layer — 35% of it, 26% of the whole file — belongs to components only the
admin match-edit form renders.** On the landing page, `calendar-year-picker` alone is 5.3 KB,
`autocomplete__popover` 4.2 KB, `date-picker__popover` 2.5 KB. Every visitor downloads and parses the
admin date picker's styles.

That matters more than the download: a stylesheet is render-blocking, and the mobile LCP breakdown
attributes 2.3 s to render delay rather than to network. Parse time is paid on the slowest device in
the audience.

## Decision

**Move the component stylesheets no public route can reach into `src/app/admin/admin.css`, imported by
`app/admin/layout.tsx`.** Nine of them: `number-field`, `calendar`, `calendar-year-picker`,
`date-field`, `time-field`, `date-input-group`, `date-picker`, `combo-box`, `autocomplete`.

**Membership is decided from the import graph, not from folder names.** The graph was walked from every
route entry under `app/`, following dynamic imports — `AdminSpielCardsList` reaches its edit modal
through `next/dynamic`, and a static reading would have missed it. That measurement contradicted three
guesses: `Select` and `ListBox` are reached by public routes, and `CloseButton` is imported only by an
admin form but may be composed by the public `SpielDetailsModal`. All three stayed in `globals.css`.

**The tie-break is asymmetric: public unless proven otherwise.** Guessing wrong toward `globals.css`
costs a few KB. Guessing wrong toward `admin.css` is an unstyled admin form that nothing in the
toolchain reports.

## Consequences

**The public stylesheet drops 330,847 → 263,709 bytes, −20%.** Both the transfer and the parse fall,
and the parse half is the one aimed at the LCP render delay.

**Admin pages load both files** — verified in document order, `globals.css` first — and pay ~5 KB of
duplicated `@layer properties` for the privilege. Admin sits behind a login and is not perf-critical;
this is the right side to put the cost on.

**Order stays correct by construction.** HeroUI requires shared primitives before the components that
compose them. Everything moved sits _later_ in HeroUI's own order than everything that stayed, and
`admin.css` loads after `globals.css`, so the relative order is preserved rather than merely lucky.

**`admin.css` needs `@reference "../globals.css"`.** Several HeroUI component files use `@apply`, which
needs theme context; without it the build fails — loudly, which is the good case. The reference does not
duplicate the theme: `--accent-brand` appears in the public chunk and not the admin one.

**There are now two lists to check, and that is the real cost.** ADR-0019's failure mode — a missing
import renders a component unstyled while every check passes — now has a second way to happen: the right
import in the wrong file. The mitigation is procedural and repeated in four places: the headers of both
CSS files, `docs/frontend/overview.md`, and CLAUDE.md §6.

## Alternatives considered

**Leave it as one stylesheet.** Simplest, and it cannot break. Rejected on the measurement: a quarter of
what every visitor parses is for a date picker behind a login.

**Split further, per route group** — a dashboard sheet, a meta-pages sheet. Rejected as the point of
diminishing returns: the admin/public boundary is a real authorization boundary that already exists in
the routing, so it needs no new concept. Slicing the public routes against each other would multiply the
"which file?" decision for a few KB each.

**Lazy-load the admin CSS at runtime instead.** Rejected: it reintroduces a flash of unstyled form on
the pages that need it most, to save nothing the layout-level import does not already save.

## See also

- [ADR-0019](0019-per-component-heroui-css.md) — why HeroUI is imported per component at all
- `fl_frontend/src/app/globals.css` and `fl_frontend/src/app/admin/admin.css` — the two lists
- [`docs/frontend/overview.md`](../frontend/overview.md#adding-a-heroui-component) — the checklist
