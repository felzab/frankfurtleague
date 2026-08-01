# Frontend pass 5 — accessibility and UX state coverage

Paste into a fresh session (or run via `/audit:pass frontend 5`).

---

Audit pass 5 of 6 on `./fl_frontend`. Lens: ACCESSIBILITY AND UX STATE COVERAGE. Styling-system
consistency and performance are pass 6 — this lens was one oversized pass in the previous
programme and is deliberately split.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the
report to `docs/audit/f5-a11y-ux.md`. Read the f1–f4 reports first; cite, do not re-report.

CONTEXT — derive, do not assume: HeroUI is react-aria-based, which sets the baseline; `jsx-a11y`
runs at `error`, so anything it catches is already impossible — this pass hunts what it cannot
see. Ratified state to check conformance against: one `--focus`-driven indicator app-wide with two
recorded exceptions (field-like controls border-brand; collection options deliberately
indicatorless — a recorded WCAG 2.4.7 deviation, do not re-flag it), the two recorded sub-AA chip
states, the drawer's no-trap decision with its reversal trigger. Every accessibility finding names
the failing **interaction** ("keyboard users cannot reach X"), never just a rule number.

SECTION A — ACCESSIBILITY

1. **Overlay correctness.** Enumerate the modals/popovers/drawers (derive the list), and per
   overlay: focus trap, restore on close, Escape, labelled dialog, scroll lock — noting which
   behaviour comes from library primitives versus hand-rolled code. Watch the three traps the
   previous programme hit repeatedly: library `*.Trigger` components already render a focusable
   button (nesting a `<button>` inside one is invalid HTML and a double tab stop — it happened
   three times); overlays survive client-side navigation unless wired to the shared
   navigation-close hook; never anchor a popover inside a `position: fixed` overlay.

2. **Keyboard reachability.** Click handlers on non-interactive elements, custom dropdowns, table
   row interactions, anything reachable by pointer only. Verify by driving the running app where
   possible, honouring the environment traps in the shared wave prompt (a hidden pane never
   matches `:focus`).

3. **Forms.** Label association, errors programmatically linked and rendered at the field, focus
   moved to the first invalid field on a _server_ failure (react-aria only auto-focuses on the
   native `invalid` event — server errors need `reportValidity()`), `isInvalid` never passed as a
   defined `false` (it builds a controlled error that outranks native validation), pending states
   preventing double submit, cleared numeric fields not coercing to 0.

4. **Names and semantics.** Accessible names on icon-only controls (name and tooltip-description
   are different things), heading hierarchy per route including empty-data branches (four `sr-only`
   h1s once existed only in the populated branch), landmarks, list semantics (`role="list"` never
   on `display:contents` wrappers or elements owning another role), alt text. The name inventory
   must cover **rendered output or library source**, not just `src` greps — the component library
   has hardcoded English names no `src` grep can see.

5. **Language consistency.** German UI throughout: user-visible strings, accessible names,
   validation messages (zod union errors surface the union's message — branch messages are
   unreachable), with the recorded exception that native browser validation bubbles follow the
   browser locale by decision.

SECTION C — UX STATE COVERAGE

6. **The state matrix.** Per view (derive the list): loading / empty / error present and visually
   consistent — as an actual matrix table. Loading fallbacks must be dimensionally honest (a
   fallback shaped unlike its content shifts layout on arrival; a control that looks finished
   before it works is worse than a skeleton).

7. **Mutation feedback.** Every action's success AND failure surfaced; toasts only for failures no
   field owns; feedback not queued into an unmounting tree (fire before navigation).

8. **Locale formatting.** Dates/times/numbers through the shared Berlin-pinned formatters and the
   one-placeholder-per-category constants, never ad-hoc `toLocale*` calls.

Priority order: A1, A3, A2, A4, C6, C7, A5, C8.

EXIT NOTE: findings whose verification requires a real keyboard or screen reader get a
"needs-human" tag rather than a guessed verdict — the remediation ledger turns those into owner
gate clauses.

BOUNDARIES — not this pass: styling tokens, dark mode, class repetition, performance → pass 6 ·
form input _validation shape_ → f3 · anything the a11y lint rule already errors on.
