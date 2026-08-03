# Frontend pass 6 — styling system and performance

Paste into a fresh session (or run via `/audit:pass frontend 6`).

---

Audit pass 6 of 6 on `./fl_frontend`. Lens: STYLING-SYSTEM CONSISTENCY AND PERFORMANCE.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the
report to `docs/audit/f6-styling-perf.md`. Read the f1–f5 reports first; cite, do not re-report.

DELIVERABLE: every performance finding carries its number (bytes gzipped, elements mounted, milliseconds) and how it was measured; every contrast finding carries its ratio pair in both themes. A claim without its measurement is filed INFO and labelled unmeasured.

CONTEXT — derive, do not assume: Tailwind is CSS-first (`globals.css` owns the token layer and
`@theme` exports); the shared recipes (`card`, `formButton`, `ctaButton`, the tab/field/label
constants, `overlayPanel`, `StatusPanel`) are the styling system's enforcement layer;
`no-unknown-classes` runs at `error`. Two hard rules for this lens: **verify library and CSS
behaviour at the source or in compiled output before prescribing anything** — a token name in the
wrong namespace does not compile, and a mount-cost finding is a no-op wherever the library already
mounts lazily — and **every contrast claim carries measured ratios** in both themes at the rendered
size, because a plausible-looking token remapping can drop several combinations below AA at once.

SECTION B — STYLING SYSTEM

1. **Token discipline.** Hardcoded colors and arbitrary values in `.tsx` that duplicate or bypass
   a token; tokens declared and consumed by nothing; shadowed or stale token names. Verify each
   proposed token name compiles under the correct Tailwind namespace before recommending it.

2. **Dark-mode coverage.** Components styled for one theme; raw values that do not flip; `dark:`
   escape hatches beyond the recorded residual set. **Verify with one page load per theme, seeding
   the storage key before scripts run** — flipping `data-theme` on a live page gives stale readings,
   and emulating `prefers-color-scheme` does nothing while the app pins a default theme.

3. **Recipe conformance.** Hand-written class strings duplicating an existing recipe (the drift
   the recipes exist to prevent); the same semantic role styled differently across views;
   conditional class strings assembled with the separating space inside a string literal (the
   formatter glues them — the lint rule catches only half the shapes, so grep for the pattern).

4. **Responsive and stylesheet hygiene.** Breakpoint usage against the theme's breakpoints (never
   shadow a stock breakpoint), layouts at mobile widths, `globals.css` layer ordering (the
   reduced-motion block must stay unlayered), `@utility` definitions used or dead.

SECTION D — PERFORMANCE

5. **Server waterfalls.** Sequential awaits that should be parallel; any resolver re-introducing a
   serialised lookup in front of page queries (the season default is server-side by ADR-0002 —
   nothing should front-run it).

6. **Client payload.** Whole datasets crossing the RSC boundary for a rendered subset; context
   providers shipping data to routes that never read it. **Measure gzipped before filing.** A
   structurally real over-fetch is not worth a remediation row when the whole payload compresses to
   a few kilobytes — a payload finding without a byte count is not a finding.

7. **Rendering cost.** Index keys, and keys unique only within a subset, on reused lists — a
   per-season match number is not unique across sibling lists. Expensive derived values without
   memoization: **the React Compiler is off by a measured decision recorded on its config key, so
   do not propose re-enabling it as a fix.** Provider value stability. And the admin tables'
   memo-plus-stable-props constraint, where an inline lambda at a call site silently defeats the
   memo — verify the constraint still holds at every call site.

8. **Assets and chunks.** Image handling (the app deliberately uses masked SVGs, not
   `next/image` — verify that remains true before recommending either direction), font loading,
   lazy-loaded chunks with honest loading states (`dynamic({ssr:false})` with no `loading` renders
   `null` — a dead-looking click), chunk contents versus what the route actually needs.

Priority order: B3, B1, D6, D7, B2, D5, B4, D8.

MEASUREMENT: every performance finding carries its number (bytes gzipped, elements mounted,
milliseconds) and how it was measured; every contrast finding carries its ratio pair. A claim
without its measurement goes in as INFO with "unmeasured" stated.

BOUNDARIES — not this pass: a11y and UX states → f5 · caching semantics → f3 · dead code → f2 ·
deprecated utilities → f1.
