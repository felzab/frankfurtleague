# Frontend pass 5 — accessibility and UX state coverage

Paste into a fresh session (or run via `/audit:pass frontend 5`).

---

Audit pass 5 of 6 on `./fl_frontend`. Lens: ACCESSIBILITY AND UX STATE COVERAGE. Styling-system
consistency and performance are pass 6 — the two lenses are deliberately kept apart, because
together they produce a report too large to load in a remediation session.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the
report to `docs/audit/f5-a11y-ux.md`. Read the f1–f4 reports first; cite, do not re-report.

DELIVERABLE: two required tables — the WCAG 2.2 Level AA conformance table (check 0) and the
per-view state matrix (check 6). Every accessibility finding names the failing **interaction**
("keyboard users cannot reach X"), never only a criterion number, and anything needing a real
keyboard or screen reader is tagged needs-human rather than guessed.

CONTEXT — derive, do not assume: HeroUI is react-aria-based, which sets the baseline; `jsx-a11y`
runs at `error`, so anything it catches is already impossible — this pass hunts what it cannot
see. Ratified state to check conformance against: one `--focus`-driven indicator app-wide with two
recorded exceptions (field-like controls border-brand; collection options deliberately
indicatorless — a recorded WCAG 2.4.7 deviation, do not re-flag it), the two recorded sub-AA chip
states, the drawer's no-trap decision with its reversal trigger.

SECTION A — ACCESSIBILITY

0. **WCAG 2.2 Level AA conformance table.** Anchor this pass to the published criteria rather than to
   a hand-rolled checklist. **WCAG 2.2 is the current W3C Recommendation** (<https://www.w3.org/TR/WCAG22/>,
   also published as ISO/IEC 40500:2025); WCAG 3.0 remains a draft and is not the target. Follow the
   shared protocol's rule on external standards: **fetch the current criteria list and state the
   version in the header; never reproduce it from memory.**

   One row per Level A and Level AA success criterion — every one, no omissions: criterion | how this
   app satisfies it, with the component or file | evidence, including how it was checked | `met` /
   `gap` / `not applicable` with reason / `needs-human`. Level AAA is out of scope except where the
   app already claims it.

   Two recorded deviations exist and are decisions, not gaps: collection options are deliberately
   indicatorless, a recorded 2.4.7 deviation, and two chip states are recorded sub-AA. Mark them
   `gap (accepted)` with the pointer to the record — never silently `met`, and never re-flagged as
   new findings.

   **Every `gap` becomes a numbered finding below** naming the failing interaction. The checks that
   follow run in full regardless: they cover what conformance criteria do not, which is most of what
   actually makes an interface usable.

1. **Overlay correctness.** Enumerate the modals/popovers/drawers (derive the list), and per
   overlay: focus trap, restore on close, Escape, labelled dialog, scroll lock — noting which
   behaviour comes from library primitives and which is hand-rolled. Three recurring traps to check
   every time: a library `*.Trigger` component already renders a focusable button, so nesting a
   `<button>` inside one is invalid HTML and a double tab stop; overlays survive client-side
   navigation unless wired to the shared navigation-close hook, because a client-side navigation is
   not a light-dismiss interaction; and a popover anchored inside a `position: fixed` overlay is
   mispositioned, because positioning against `document.body` adds `documentElement.scrollTop`.

2. **Keyboard reachability.** Click handlers on non-interactive elements, custom dropdowns, table
   row interactions, anything reachable by pointer only. Verify by driving the running app where
   possible, honouring the environment traps in the shared wave prompt (a hidden pane never
   matches `:focus`).

3. **Forms.** Label association, errors programmatically linked and rendered at the field, focus
   moved to the first invalid field on a _server_ failure (react-aria only auto-focuses on the
   native `invalid` event — server errors need `reportValidity()`), `isInvalid` never passed as a
   defined `false` (it builds a controlled error that outranks native validation), pending states
   preventing double submit, cleared numeric fields not coercing to 0.

4. **Names and semantics.** Accessible names on icon-only controls (a name and a tooltip description
   are different things), heading hierarchy per route **including the empty-data branch** — a
   heading placed only in the populated branch disappears exactly when the page has least context —
   landmarks, list semantics (`role="list"` never on a `display: contents` wrapper or an element
   owning another role), alt text. The name inventory must cover **rendered output or library
   source**, not just `src` greps: the component library carries hardcoded English names that no
   `src` grep can see.

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

Priority order: A0, A1, A3, A2, A4, C6, C7, A5, C8. Needs-human findings go in the verdict's
needs-human list, where the ledger turns them into wave exit-gate clauses.

BOUNDARIES — not this pass: styling tokens, dark mode, class repetition, performance → pass 6 ·
form input _validation shape_ → f3 · anything the a11y lint rule already errors on.
