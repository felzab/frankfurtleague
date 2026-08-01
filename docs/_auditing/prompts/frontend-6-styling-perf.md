# Frontend pass 6 — styling system and performance

Paste into a fresh session (or run via `/audit:pass frontend 6`).

---

Audit pass 6 of 6 on `./fl_frontend`. Lens: STYLING-SYSTEM CONSISTENCY AND PERFORMANCE.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the
report to `docs/audit/f6-styling-perf.md`. Read the f1–f5 reports first; cite, do not re-report.

CONTEXT — derive, do not assume: Tailwind is CSS-first (`globals.css` owns the token layer and
`@theme` exports); the shared recipes (`card`, `formButton`, `ctaButton`, the tab/field/label
constants, `overlayPanel`, `StatusPanel`) are the styling system's enforcement layer;
`no-unknown-classes` runs at `error`. Two hard rules from the previous programme: **verify library
and CSS behaviour at the source or in compiled output before prescribing** (three prescribed token
names did not compile; a mount-cost HIGH was a no-op because the library already mounts lazily),
and **contrast claims carry measured ratios** in both themes at the rendered size (a well-meaning
token mapping once dropped six combinations below AA).

SECTION B — STYLING SYSTEM

1. **Token discipline.** Hardcoded colors and arbitrary values in `.tsx` that duplicate or bypass
   a token; tokens declared and consumed by nothing; shadowed or stale token names. Verify each
   proposed token name compiles under the correct Tailwind namespace before recommending it.

2. **Dark-mode coverage.** Components styled for one theme; raw values that do not flip; `dark:`
   escape hatches beyond the recorded residual set. Verify by loading each theme in its own page
   load (live-flipping `data-theme` gave stale readings before).

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
   providers shipping data to routes that never read it. **Measure gzipped before filing**: the
   previous programme closed a real 25-for-8 finding because the whole payload was 5 KB gzipped —
   a payload finding without a byte count is not a finding.

7. **Rendering cost.** Index keys and per-subset-unique keys on reused lists, expensive derived
   values without memoization (the React Compiler is OFF by measured decision — its reversal
   trigger lives on the config key; do not re-enable it as a fix), provider value stability, and
   the two admin tables' memo + stable-props constraint (an inline lambda passed to them silently
   restores a known bug — verify the constraint still holds at every call site).

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
