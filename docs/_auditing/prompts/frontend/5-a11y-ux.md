# Frontend pass 5 — accessibility and UX state coverage

Audit pass `frontend 5` on `./fl_frontend`. Lens: ACCESSIBILITY AND UX STATE COVERAGE.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the report
to `docs/audit/programme/f5-a11y-ux.md`.

DELIVERABLE: required tables — the WCAG 2.2 Level AA conformance table (A0) and the per-view state
matrix (C6). Every accessibility finding names the failing **interaction** ("keyboard users cannot
reach X"), never only a criterion number. Anything needing a real keyboard or screen reader is tagged
needs-human rather than guessed.

CONTEXT — derive, do not assume: HeroUI is react-aria-based, which sets the baseline; the `jsx-a11y`
recommended rules run over all of `src/` (`fl_frontend/eslint.config.mjs`), so what they catch is
already impossible and this pass hunts what they cannot see. The ratified state to check conformance
against is one `--focus`-driven indicator app-wide, with its exceptions argued in
`fl_frontend/src/app/globals.css` and in the components' own comments — field-like controls take a
brand border, and a collection option keys its indicator off `data-focus-visible` / `data-focused`.
**Read those blocks before judging a criterion**: each says what it decided and what would reverse
it.

SECTION A — ACCESSIBILITY

A0. **WCAG 2.2 Level AA conformance table.** Anchor this pass to the published criteria rather than
to a hand-rolled checklist. **WCAG 2.2 is the current W3C Recommendation**
(<https://www.w3.org/TR/WCAG22/>, also published as ISO/IEC 40500:2025); WCAG 3.0 remains a draft
and is not the target. Per the shared protocol's rule on external standards, fetch the current
criteria list and state the version in the header.

One row per Level A and Level AA success criterion — every one, no omissions: criterion | how
this app satisfies it, with the component or file | evidence, including how it was checked |
`met` / `gap` / `not applicable` with reason / `needs-human`. Level AAA is out of scope except
where the app already claims it.

**A recorded deviation is a decision rather than a gap** — but derive the live ones instead of
carrying a list forward: grep the component's own comments and `globals.css` for the decision,
then check it still describes the code. Mark one that survives `gap (accepted)`, citing the
comment that records it — never silently `met`, and never re-flagged as a new finding.

A1. **Overlay correctness.** Enumerate the modals, popovers and drawers (derive the list), and per
overlay: focus trap, restore on close, Escape, labelled dialog, scroll lock — noting which
behaviour comes from library primitives and which is hand-rolled. Recurring traps, each to be checked
every time: a library `*.Trigger` component already renders a focusable button, so nesting a
`<button>` inside one is invalid HTML and a double tab stop; overlays survive client-side
navigation unless wired to the shared navigation-close hook, because a client-side navigation is
not a light-dismiss interaction; and a top-placed overlay's `bottom` is computed against the
viewport but resolved by CSS against its containing block, so check that `<html>` and `<body>` carry
no `position`, `transform`, `filter` or `contain: paint` — any of those opens every such overlay a
whole scroll height low on a route whose document scrolls (`docs/frontend/spec.md :: I29`).

A2. **Keyboard reachability.** Click handlers on non-interactive elements, custom dropdowns, table
row interactions, anything reachable by pointer only. Drive the running app, honouring the
environment traps in `docs/_auditing/lessons.md` — a hidden browser pane never matches `:focus`
and manufactures convincing fake bugs. **List what you actually drove and what you did not**, and
tag the remainder needs-human.

A3. **Forms.** Label association, errors programmatically linked and rendered at the field, focus
moved to the first invalid field on a _server_ failure (react-aria only auto-focuses on the
native `invalid` event — server errors need `reportValidity()`), `isInvalid` never passed as a
defined `false` (it builds a controlled error that outranks native validation), pending states
preventing double submit, cleared numeric fields not coercing to 0.

A4. **Names and semantics.** Accessible names on icon-only controls (a name and a tooltip
description are different things), heading hierarchy per route **including the empty-data
branch** — a heading placed only in the populated branch disappears exactly when the page has
least context — landmarks, list semantics (`role="list"` never on a `display: contents` wrapper
or an element owning another role), alt text. The name inventory must cover **rendered output or
library source**, not just `src` greps: the component library carries hardcoded English names
that no `src` grep can see.

A5. **Language consistency.** German UI throughout: user-visible strings, accessible names,
validation messages (zod union errors surface the union's message — branch messages are
unreachable), with the recorded exception that native browser validation bubbles follow the
browser locale by decision.

SECTION C — UX STATE COVERAGE

C6. **The state matrix.** Per view (derive the list): loading / empty / error present and visually
consistent, as an actual matrix table. Loading fallbacks must be dimensionally honest — a
fallback shaped unlike its content shifts layout on arrival, and a control that looks finished
before it works is worse than a skeleton.

C7. **Mutation feedback.** Every action's success AND failure surfaced; toasts only for failures no
field owns; feedback not queued into an unmounting tree (fire before navigation).

C8. **Locale formatting.** Dates, times and numbers through the shared Berlin-pinned formatters and
the one-placeholder-per-category constants, never ad-hoc `toLocale*` calls.

Priority order: A0, A1, A3, A2, A4, C6, C7, A5, C8. Needs-human findings go in the verdict's
needs-human list, where the ledger turns them into wave exit-gate clauses.

BOUNDARIES — not this pass: styling tokens, dark mode, class repetition, performance → f6 · form
input _validation shape_ → f3 · anything the a11y lint rule already errors on.
