import { tv } from "tailwind-variants/lite";

/*
 * The look every field shares, kept in one place so a ruling changes it in one edit: the label, the
 * frame, the message line, the drawn box of a checkbox, radio or switch, and the menu a select or a
 * combo box opens. Each is a `tv()` recipe, which the class lint reads. A border's colour is named
 * because HeroUI's base sheet colours every element's border.
 */

/** A field's label, its frame and its message line, one under another. */
export const fieldRoot = tv({ base: "group flex min-w-0 flex-col gap-1" });

export const fieldLabel = tv({ base: "text-sm font-medium text-fg" });

/** The asterisk after a required field's label. */
export const requiredMark = tv({ base: "text-danger" });

/** One line, always there, so a message appearing or going moves nothing. */
export const messageLine = tv({
  base: "h-4 truncate text-xs",
  variants: {
    tone: {
      description: "text-fg-muted",
      consequence: "text-warn",
      error: "text-danger",
    },
  },
});

/** The edge a value is typed into: 36 px with a mouse, 44 px and 16-px text on a touch screen. */
export const fieldFrame = tv({
  base: "rounded-lg border border-border-control bg-bg text-sm text-fg transition-colors duration-(--motion-state) group-data-invalid:border-danger data-disabled:opacity-50 data-invalid:border-danger pointer-coarse:text-base",
  variants: {
    // The four width classes: up to five characters, a date or a short figure, the column, a paragraph.
    width: {
      W1: "h-9 w-16 pointer-coarse:h-11",
      W2: "h-9 w-36 pointer-coarse:h-11",
      W3: "h-9 w-full pointer-coarse:h-11",
      W4: "w-full resize-none py-2",
    },
    // A frame holding the value alone takes the padding; a frame grouping a value and a button keeps its start.
    inset: {
      full: "px-3",
      start: "ps-3",
      // A search field's magnifier stands where the padding would.
      none: "",
    },
    // A select's trigger holds its value and the arrow beside it, the arrow inside the frame's end.
    layout: {
      value: "",
      trigger: "flex items-center justify-between gap-2 pe-2 text-start",
      // A date or a combo box: the typed value, then a button as tall and as wide as the field.
      group: "flex items-center overflow-hidden",
    },
    // Figures are set in Inter, with columns that line up.
    figures: {
      true: "font-numeric tabular-nums",
    },
  },
});

/** The button at a field's end, a date's calendar or a combo box's arrow: as tall and as wide as the field. */
export const fieldButton = tv({ base: "flex h-full w-9 shrink-0 items-center justify-center text-fg-muted pointer-coarse:w-11" });

/** The text a combo box or a search field is typed into, filling its frame between the frame's other parts. */
export const groupInput = tv({ base: "h-full min-w-0 flex-1 bg-transparent" });

/** A search field's magnifier, at the frame's start. */
export const searchGlyph = tv({ base: "flex shrink-0 items-center ps-3 pe-2 text-fg-muted" });

/** A search field's text, without the clearing cross WebKit draws inside a search input. */
export const searchInput = tv({ base: "h-full min-w-0 flex-1 bg-transparent [&::-webkit-search-cancel-button]:hidden" });

/** A search field's clearing button, there only once something is typed. */
export const searchClear = tv({
  base: "flex h-full w-9 shrink-0 items-center justify-center text-fg-muted group-data-empty:invisible pointer-coarse:w-11",
});

/** The six code boxes, sharing the column. */
export const codeRow = tv({ base: "group grid grid-cols-6 gap-2" });

/** One code box: a field's frame and height, its digit large and centred. */
export const codeBox = tv({
  base: "h-9 w-full rounded-lg border border-border-control bg-bg text-center font-numeric text-xl font-semibold text-fg tabular-nums transition-colors duration-(--motion-state) group-data-invalid:border-danger disabled:opacity-50 pointer-coarse:h-11",
});

/** One segment of a date or a time; the active one fills, at the 6-px corners of a highlighted part. */
export const dateSegment = tv({ base: "rounded-md caret-transparent data-placeholder:text-fg-muted" });

/** The weekdays over a date's calendar, in the caption grade. */
export const calendarHead = tv({ base: "pb-1 text-xs font-medium text-fg-muted" });

/** A day in a date's calendar, as large as a control; the chosen day inverts. */
export const calendarCell = tv({
  base: "flex size-9 cursor-default items-center justify-center rounded-md font-numeric text-sm tabular-nums data-disabled:opacity-50 data-outside-month:text-fg-muted data-selected:bg-fg data-selected:text-bg pointer-coarse:size-11",
});

/** A checkbox, a radio or a switch: the drawn box, its label to the right. */
export const toggleRow = tv({ base: "flex items-start gap-3 text-sm text-fg data-disabled:opacity-50" });

/** The drawn box of a checkbox or a radio, a pixel down so it centres on the label's first line. */
export const toggleBox = tv({
  base: "mt-px flex size-4.5 shrink-0 items-center justify-center border transition-colors duration-(--motion-state)",
  variants: {
    shape: {
      square: "rounded-md",
      round: "rounded-full",
    },
    selected: {
      true: "border-brand-solid",
      false: "border-border-control bg-bg",
    },
  },
  compoundVariants: [{ shape: "square", selected: true, class: "bg-brand-solid text-on-brand" }],
});

/** A toggle's message line, starting under its label: past the box, or the switch's track, and the 12-px gap. */
export const toggleLine = tv({
  variants: {
    box: {
      square: "ps-7.5",
      track: "ps-12",
    },
  },
});

/** A radio group's answers, one under another. */
export const radioList = tv({ base: "flex flex-col gap-2" });

/** The dot inside a selected radio. */
export const radioDot = tv({ base: "size-2 rounded-full bg-brand-solid" });

/** A switch's track, its thumb resting two pixels inside it. */
export const switchTrack = tv({
  base: "mt-px flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors duration-(--motion-state)",
  variants: {
    selected: {
      true: "bg-brand-solid",
      false: "bg-bg-muted",
    },
  },
});

export const switchThumb = tv({
  base: "size-4 rounded-full bg-bg transition-transform duration-(--motion-state)",
  variants: {
    selected: {
      true: "translate-x-4",
      false: "translate-x-0",
    },
  },
});

/** The menu a select, a combo box or a date's calendar opens, fading in and out. */
export const menuPopover = tv({
  base: "overflow-auto rounded-lg bg-bg p-1 shadow-menu transition-opacity duration-(--motion-in) data-entering:opacity-0 data-exiting:opacity-0 data-exiting:duration-(--motion-out)",
  variants: {
    // A list is as wide as the field that opened it.
    fit: {
      field: "w-(--trigger-width)",
      content: "",
    },
  },
});

/** One entry of that menu: a fill when the pointer or the arrow keys reach it. */
export const menuItem = tv({
  base: "flex min-h-9 cursor-default items-center justify-between gap-2 rounded-md px-3 text-sm text-fg data-disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:text-base",
});
