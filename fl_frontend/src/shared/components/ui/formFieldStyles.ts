/**
 * The one form-label appearance: `fluid-xs` over a `fluid-sm` input, so the value stays dominant.
 * The sign-in form's uppercase-tracked label is that page's own style rather than this constant.
 */
export const FIELD_LABEL = "fluid-xs text-foreground font-bold";

/**
 * The height every field-shaped control resolves to. HeroUI gives `.number-field__group` a fixed `h-9`
 * while a trigger sizes itself from `py-2` plus its line box — a visible 4px step across one grid row.
 */
export const FIELD_HEIGHT = "h-10";

/**
 * No focus classes here. The border-turns-brand treatment lives once in the unlayered block at the end
 * of `globals.css`, keyed off HeroUI's `data-slot` attributes; repeating it is how it drifted before.
 */
export const FIELD_INPUT = `border-border bg-surface text-foreground fluid-sm ${FIELD_HEIGHT} flex items-center rounded-lg border px-3 py-0 transition-colors outline-none`;

/**
 * A composite field's group chrome — the stepper, date and time groups. HeroUI sizes these itself, so a
 * site hand-rolling the border without `FIELD_HEIGHT` renders 36px beside a 40px trigger.
 */
export const FIELD_GROUP = `border-border bg-surface text-foreground ${FIELD_HEIGHT} rounded-lg border transition-colors`;

/** The input inside a number field's group. `w-full` because the grid's middle track sizes it. */
export const FIELD_COUNT_INPUT = "fluid-sm w-full";

/**
 * Room for the indicator sitting over a trigger's trailing edge. HeroUI's own `pe-7` is in `@layer components` while
 * `FIELD_INPUT`'s `px-3` is in `utilities`, and layer order beats specificity, so its reservation loses.
 */
const INDICATOR_CLEARANCE = "pe-9";

/**
 * For `Autocomplete.Trigger` and `Select.Trigger`. **No `gap-x-*` here** (I30 in `docs/frontend/spec.md`), and both
 * structures are vendored — re-read `autocomplete.js` and `select.js` on an upgrade.
 */
export const FIELD_TRIGGER = `${FIELD_INPUT} ${INDICATOR_CLEARANCE}`;

/**
 * The alignment every detached toggle group carries, spelled once so no two of them drift: HeroUI centres
 * `.toggle-button-group` from `@layer components`, so a group wanting the page's leading edge contradicts it.
 */
export const TOGGLE_GROUP_ALIGN = "justify-center sm:justify-start";

/**
 * The one tab appearance. `data-hovered:` rather than `hover:`: react-aria's `useHover` ignores the emulated mouse
 * events a touch device fires, where `:hover` sticks until the next tap.
 */
export const TAB_ITEM =
  "text-foreground-muted data-hovered:bg-surface data-hovered:text-foreground data-[selected=true]:text-brand-solid-foreground data-[selected=true]:data-hovered:bg-transparent data-[selected=true]:data-hovered:text-brand-solid-foreground fluid-sm rounded-lg font-bold tracking-wide transition-colors";

/** The recessed track every tab strip sits in. Paired with the hover `TAB_ITEM` moves off it. */
export const TAB_TRACK = "border-border bg-muted rounded-xl border";

/**
 * `rounded-lg` matches `TAB_ITEM`: HeroUI's `.tabs__indicator` defaults to `calc(var(--radius) * 3)`, so
 * without it the hover background and the selected background wore different corners on the same tab.
 */
export const TAB_INDICATOR = "bg-brand-solid rounded-lg shadow-sm";

/** The one field-error appearance, so every form reports at the field rather than only through a toast. */
export const FIELD_ERROR = "fluid-xxs text-danger mt-1 font-bold";

/**
 * A sub-group inside a panel; `text-foreground-muted` is what separates it from `FIELD_LABEL`, otherwise the same
 * recipe uppercased. A group whose first field label already names it gets no heading.
 */
export const FORM_SECTION_HEADING = "fluid-xxs text-foreground-muted font-bold tracking-widest uppercase";

/**
 * The one two-up field grid, which a section may half-fill. Spelled per panel, the gap and the breakpoint drift,
 * and a pair a step wider than its neighbour shows only with both panels on screen.
 */
export const FIELD_PAIR = "grid w-full grid-cols-1 gap-4 sm:grid-cols-2";

/** `FIELD_PAIR`'s three-up sibling, and spelled beside it for the same reason: three panels render this grid. */
export const FIELD_TRIO = "grid w-full grid-cols-1 gap-4 sm:grid-cols-3";

/**
 * The one marker disc. Two can share a label row — the match editor's Fehlt/Offen beside Geändert — and a
 * disc that measured differently from its neighbour read as a second idea rather than the same one.
 */
export const FIELD_MARKER = "inline-flex size-5 shrink-0 items-center justify-center rounded-full";

/**
 * `rounded-xl` must match `overlayPanel`'s corner: HeroUI makes `.date-picker__popover` a clipping box, so a larger
 * arc here clips away the calendar's own border. `p-0` because that calendar is already a bordered panel.
 */
export const DATE_PICKER_POPOVER = "rounded-xl p-0";

/**
 * Width and max-width must be declared together at each step: HeroUI declares both on `.calendar`, so a width utility
 * alone is clamped straight back. The days are an `aspect-square` grid, so this is the only lever on a day's size.
 */
export const DATE_PICKER_CALENDAR = "w-72 max-w-72 p-3 sm:w-84 sm:max-w-84 sm:p-4";

/**
 * Deliberately not `"bottom end"`: these pickers sit in a two-column grid from `sm` up, where trailing-edge alignment
 * opens each calendar across the column beside it. HeroUI's default centres it on a far narrower trigger.
 */
export const DATE_PICKER_PLACEMENT = "bottom start";
