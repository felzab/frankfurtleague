# Frontend pass 6 — styling system and performance

Audit pass `frontend 6` on `./fl_frontend`. Lens: STYLING-SYSTEM CONSISTENCY AND PERFORMANCE.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the report
to `docs/audit/programme/f6-styling-perf.md`.

DELIVERABLE: every performance finding carries its number (bytes gzipped, elements mounted,
milliseconds) and how it was measured; every contrast finding carries its ratio pair in both themes.
A claim without its measurement is filed INFO and labelled unmeasured.

CONTEXT — derive, do not assume: Tailwind is CSS-first (`globals.css` owns the token layer and
`@theme` exports); the shared recipes (`card`, `formButton`, `ctaButton`, the tab, field and label
constants, `overlayPanel`, `StatusPanel`) are the styling system's enforcement layer;
`no-unknown-classes` runs at `error`. Two hard rules for this lens: **verify library and CSS
behaviour at the source or in compiled output before prescribing anything** — a token name in the
wrong namespace does not compile, and a mount-cost finding is a no-op wherever the library already
mounts lazily — and **every contrast claim carries measured ratios** in both themes at the rendered
size, because a plausible-looking token remapping can drop several combinations below AA at once.

SECTION B — STYLING SYSTEM

B1. **Token discipline.** Hardcoded colours and arbitrary values in `.tsx` that duplicate or bypass a
token. Dead vocabulary — classes and tokens resolving to nothing — is f1's; this check judges
only live tokens bypassed or duplicated. Verify each proposed token name compiles under the
correct Tailwind namespace before recommending it.

B2. **Dark-mode coverage.** Components styled for one theme; raw values that do not flip; `dark:`
escape hatches beyond the recorded residual set. **Verify with one page load per theme, seeding
the storage key before scripts run** — `docs/_auditing/lessons.md` §6 has why the alternatives
read stale.

B3. **Recipe conformance.** Hand-written class strings duplicating an existing recipe (the drift the
recipes exist to prevent); the same semantic role styled differently across views; conditional
class strings assembled with the separating space inside a string literal (the formatter glues
them — the lint rule catches only half the shapes, so grep for the pattern).

B4. **Responsive and stylesheet hygiene.** Breakpoint usage against the theme's breakpoints (never
shadow a stock breakpoint), layouts at mobile widths, `globals.css` layer ordering (the
reduced-motion block must stay unlayered), `@utility` definitions used or dead.

SECTION D — PERFORMANCE

D5. **Server waterfalls.** Sequential awaits that should be parallel; any resolver re-introducing a
serialised lookup in front of page queries (the season default is resolved server-side — nothing
should front-run it).

D6. **Client payload.** Whole datasets crossing the RSC boundary for a rendered subset; context
providers shipping data to routes that never read it. **Measure gzipped before filing.** A
structurally real over-fetch is not worth a remediation row when the whole payload compresses to
a few kilobytes.

D7. **Rendering cost.** Expensive derived values without memoization — but `.claude/CLAUDE.md` §7
forbids re-enabling the React Compiler, so **never propose it as a fix.** Provider value stability.
And the admin tables' memo-plus-stable-props constraint, where an inline lambda at a call site
silently defeats the memo — verify the constraint still holds at every call site.

D8. **Assets and chunks.** Image handling (the app deliberately uses masked SVGs, not `next/image` —
verify that remains true before recommending either direction), font loading, lazy-loaded chunks
with honest loading states, chunk contents versus what the route actually needs.

Priority order: B3, B1, D6, D7, B2, D5, B4, D8.

BOUNDARIES — not this pass: accessibility and UX states → f5 · caching semantics and list keys →
f3 · duplication, dead code and excess → f2 · deprecated utilities and dead styling vocabulary → f1.
