/**
 * SHARED · the one text-field appearance
 *
 * The style existed in two drifting copies across 12 fields — a brand focus border on four, no
 * focus feedback on the rest, inside a single form. It carries no focus classes at all: the
 * border-turns-brand treatment lives once in the unlayered block at the bottom of `globals.css`,
 * keyed off HeroUI's `data-slot` attributes, and repeating it here is how the drift happened.
 *
 * `transition-colors` stays, so the border animates into brand rather than snapping.
 */
/**
 * The one form-label appearance. The app had drifted to two sizes INSIDE the same modals — the
 * entity forms' main fields at `fluid-sm` while their currency fields, the address grid and every
 * match-form section sat at `fluid-xs` (audit, 2026-07-31). `fluid-xs` over a `fluid-sm` input is
 * the Stripe/Linear convention: the value stays dominant. The sign-in form's uppercase-tracked
 * label is that page's deliberate style and not this constant.
 */
export const FIELD_LABEL = "fluid-xs text-foreground font-bold";

/**
 * The height every field-shaped control resolves to, so a picker and the number field beside it line
 * up.
 *
 * They did not: HeroUI gives `.number-field__group` a fixed `h-9` while a trigger sized itself from
 * `py-2` plus its line box, landing near 40px — a visible 4px step between two controls sharing a grid
 * row. One number here settles it, and the vertical padding goes with it (a fixed height with centred
 * content has no use for padding, and the number field's is neutralised globally in `globals.css`).
 */
export const FIELD_HEIGHT = "h-10";

export const FIELD_INPUT = `border-border bg-surface text-foreground fluid-sm ${FIELD_HEIGHT} flex items-center rounded-lg border px-3 py-0 transition-colors outline-none`;

/**
 * A composite field's group chrome — the number field's stepper group and the date and time groups —
 * with the same border, background and height as every other field.
 *
 * HeroUI sizes these groups itself (`h-9` on `.number-field__group`, padding-derived on the date
 * groups), which is exactly the 4px step this constant removes: every site that hand-rolled
 * `border-border bg-surface … border` without the height token rendered 36px next to a 40px trigger.
 * The number field's group is a `grid-template-columns: 40px 1fr 40px`, so the two buttons are fixed
 * and only the input flexes; all this adds is the app's own surface and the shared height.
 */
export const FIELD_GROUP = `border-border bg-surface text-foreground ${FIELD_HEIGHT} rounded-lg border transition-colors`;

/** The input inside a number field's group. `w-full` because the grid's middle track sizes it. */
export const FIELD_COUNT_INPUT = "fluid-sm w-full";

/**
 * A picker's trigger — `FIELD_INPUT` plus room for the chevron.
 *
 * `pe-9` is a bug fix, not a preference. HeroUI reserves that space itself with `pe-7` inside
 * `.autocomplete__trigger:has(.autocomplete__indicator)`, but that rule is in `@layer components`
 * while `FIELD_INPUT`'s `px-3` is in `utilities` — and layer order beats specificity, so the
 * reservation lost and the value's content box ran under an indicator that is positioned
 * `absolute … end-2`. Anything trailing in the value, a chip most visibly, sat underneath it.
 *
 * **The separation between two children does not belong here, and a `gap-x-*` cannot put it here.**
 * `Autocomplete.Indicator` wraps its absolutely positioned icon in a `<button>` of its own — an
 * in-flow flex item with nothing in it — so a gap on this recipe lands in front of that empty
 * wrapper and buys a dead column at the trailing edge of every Autocomplete trigger. At a
 * `Select.Trigger` it buys nothing at all: that indicator is the bare icon, absolutely positioned,
 * and never a flex item to space. A child needing clearance from its neighbour carries its own
 * `ms-2` (I29 in `docs/frontend/spec.md`).
 *
 * Use this on `Autocomplete.Trigger` and `Select.Trigger`; use `FIELD_INPUT` for a field with nothing
 * floating over its trailing edge.
 */
export const FIELD_TRIGGER = `${FIELD_INPUT} pe-9`;

/**
 * The one tab appearance. Both tab strips in the app — the sign-in role picker and the spielplan's
 * Spieltag bar — are the same control doing the same job, and writing the classes at each site is
 * how they ended up with different hover states.
 *
 * The selected tab is excluded from the hover background on purpose: it already carries
 * `Tabs.Indicator`, and a second background under a moving indicator reads as a glitch.
 *
 * Hover LIFTS to `bg-surface` rather than darkening, because the track itself is the recessed
 * `bg-muted` (see `TAB_TRACK`). A darkening hover is invisible on a `bg-muted` track, which is
 * exactly how the two strips came to look different despite sharing this constant.
 *
 * `data-hovered:`, not `hover:` — these are react-aria components, and `useHover` ignores the
 * emulated mouse events a touch device fires, so `data-hovered` clears after a tap where `:hover`
 * sticks until the user taps something else.
 */
export const TAB_ITEM =
  "text-foreground-muted data-hovered:bg-surface data-hovered:text-foreground data-[selected=true]:text-brand-solid-foreground data-[selected=true]:data-hovered:bg-transparent data-[selected=true]:data-hovered:text-brand-solid-foreground fluid-sm rounded-lg font-bold tracking-wide transition-colors";

/** The recessed track both tab strips sit in. Paired with `TAB_ITEM`'s lifting hover. */
export const TAB_TRACK = "border-border bg-muted rounded-xl border";

/**
 * The selected-tab fill. `rounded-lg` is not decoration: HeroUI's `.tabs__indicator` defaults to
 * `calc(var(--radius) * 3)`, which does not match the `rounded-lg` on `TAB_ITEM` — so the hover
 * background and the selected background had visibly different corners on the same tab.
 */
export const TAB_INDICATOR = "bg-brand-solid rounded-lg shadow-sm";

/**
 * The one field-error appearance. Every `<FieldError>` in the app uses it, so a rejected value looks
 * the same wherever it is rejected — and every form has a field-level surface, rather than reporting
 * failures only through a toast that names no field.
 */
export const FIELD_ERROR = "fluid-xxs text-danger mt-1 font-bold";

/**
 * A sub-group INSIDE a panel, one level below that panel's own title.
 *
 * **It is not a section heading any more, and the demotion is most of the "no hierarchy" fix.** While
 * this uppercase 12px micro-label was the largest thing in each section it was smaller than the inputs
 * under it, so the page had nothing to read a structure from. A panel now carries a real `fluid-base`
 * title (`formPanel`), and this marks a group within one — "Termin", "Spielort", "Schiedsrichter"
 * inside "Ansetzung" (ADR-0040).
 *
 * **`text-foreground-muted`, and the colour is the point.** Demoting it by size alone left it at
 * `fluid-xs font-bold text-foreground` — character for character the same recipe as `FIELD_LABEL`
 * beneath it, distinguished only by being uppercase. Two levels of a hierarchy rendered identically
 * are one level. The group marker recedes and the field label stays at full contrast, because the
 * label is what a reader is actually looking for.
 *
 * Still only for groups whose members are heterogeneous. A group whose first field label already names
 * it gets no heading — that would render the same word twice and read it twice to a screen reader.
 */
export const FORM_SECTION_HEADING = "fluid-xxs text-foreground-muted font-bold tracking-widest uppercase";

/**
 * The date picker's popover and its calendar, declared once for all three pickers (decided 2026-08-08).
 *
 * **The popover carries no padding.** It is a positioning wrapper, and the calendar inside it is already a
 * bordered panel with its own — so `p-2` on the wrapper drew a second inset outside the border, which read
 * as the popover being misaligned with its trigger rather than as deliberate spacing.
 *
 * **The calendar is much larger from `sm` up.** HeroUI sizes `.calendar` at `w-63` (15.75rem) and lays the
 * days out as a 7-column grid of `aspect-square` cells, so the ROOT's width is the only lever — widening it
 * scales every cell proportionally rather than needing each one overridden. 25rem gives roughly 57px days
 * on a desktop, against 36px before; the phone keeps the compact size, where the screen is the constraint.
 *
 * One declaration rather than three copies: the three pickers had identical strings, which is exactly how
 * two of them come to disagree after somebody adjusts the third.
 */
export const DATE_PICKER_POPOVER = "p-0";

export const DATE_PICKER_CALENDAR = "p-3 sm:w-100 sm:max-w-100 sm:p-4 sm:text-base";

/**
 * Below the trigger and aligned to its leading edge, for all three pickers (decided 2026-08-08).
 *
 * HeroUI's `DatePicker.Popover` defaults to `"bottom"`, which centres the panel on the trigger — and the
 * calendar is far wider than the trigger it hangs from, so a centred panel overhangs the field on both
 * sides and reads as unanchored. `start` puts its leading edge where the field's is, which is the edge a
 * reader is already tracking down the form. `FilterBar`'s popover is placed the same way for the same
 * reason, so the app has one answer to "where does a panel open" rather than one per control.
 *
 * Deliberately not `"bottom end"`: every one of these pickers sits in a two-column grid from `sm` up, so
 * trailing-edge alignment would open each calendar leftwards, across the column beside it. react-aria
 * still shifts the panel back inside the viewport where the leading edge leaves no room for it.
 */
export const DATE_PICKER_PLACEMENT = "bottom start";
