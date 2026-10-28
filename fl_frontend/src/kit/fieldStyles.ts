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

/**
 * One line, always there, so a message appearing or going moves nothing. The code's line holds a refusal
 * of two sentences, so it wraps and grows from its one line rather than cutting the refusal off.
 */
export const messageLine = tv({
  base: "text-xs",
  variants: {
    lines: {
      one: "h-4 truncate",
      several: "min-h-4",
    },
    tone: {
      description: "text-fg-muted",
      consequence: "text-warn",
      error: "text-danger",
    },
  },
  defaultVariants: { lines: "one" },
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
      W4: "min-h-26 w-full resize-none py-2",
    },
    // A frame holding the value alone takes the padding; a frame grouping a value and a button keeps its
    // start. The padding is set per width below: the two short widths take 10 px, the long ones 12 px.
    inset: {
      full: "",
      start: "",
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
  compoundVariants: [
    { width: ["W1", "W2"], inset: "full", class: "px-2.5" },
    { width: ["W1", "W2"], inset: "start", class: "ps-2.5" },
    { width: ["W3", "W4"], inset: "full", class: "px-3" },
    { width: ["W3", "W4"], inset: "start", class: "ps-3" },
  ],
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

/** The six code boxes, sharing the column, with the code's one input laid over them. */
export const codeRow = tv({ base: "relative grid grid-cols-6 gap-2" });

/** One drawn code box: a field's frame and height, its digit large and centred. */
export const codeBox = tv({
  base: "flex h-9 w-full items-center justify-center rounded-lg border border-border-control bg-bg font-numeric text-xl font-semibold text-fg tabular-nums transition-colors duration-(--motion-state) group-data-disabled:opacity-50 group-data-invalid:border-danger pointer-coarse:h-11",
});

/**
 * The code's input over its boxes: its own text, caret and selection transparent, so the boxes show the
 * digits; 16 px, so a phone does not zoom in on focus.
 */
export const codeInput = tv({
  base: "absolute inset-0 size-full bg-transparent text-base text-transparent caret-transparent selection:bg-transparent",
});

/** One segment of a date or a time; the active one fills, at the 6-px corners of a highlighted part. */
export const dateSegment = tv({ base: "rounded-md caret-transparent data-placeholder:text-fg-muted" });

/** The weekdays over a date's calendar, in the caption grade. */
export const calendarHead = tv({ base: "pb-1 text-xs font-medium text-fg-muted" });

/** A day in a date's calendar, as large as a control; the chosen day inverts. */
export const calendarCell = tv({
  base: "flex size-9 cursor-default items-center justify-center rounded-md font-numeric text-sm tabular-nums data-disabled:opacity-50 data-outside-month:text-fg-muted data-selected:bg-fg data-selected:text-bg pointer-coarse:size-11",
});

/**
 * A checkbox or a switch with its message line: the drawn box's column, then the label's, so the line under
 * the row starts where the label does, whatever the box's width.
 */
export const toggleField = tv({ base: "grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1" });

/** A checkbox, a radio or a switch: the drawn box, its label 10 px to the right. */
export const toggleRow = tv({
  base: "items-start text-sm text-fg data-disabled:opacity-50",
  variants: {
    // A radio's answer stands alone; a checkbox's or a switch's row takes its field's two columns.
    in: {
      list: "flex gap-2.5",
      field: "col-span-2 grid grid-cols-subgrid",
    },
  },
});

/**
 * The drawn box of a checkbox or a radio, a pixel down so it centres on the label's first line. Checked or
 * chosen, it fills with the link green: a checkbox's tick on it is the page's ground, white in the light
 * theme and near-black in the dark, and a radio keeps a 4-px ring of it around a dot of the ground.
 */
export const toggleBox = tv({
  base: "mt-px flex size-4.5 shrink-0 items-center justify-center border transition-colors duration-(--motion-state)",
  variants: {
    shape: {
      square: "rounded-sm",
      round: "rounded-full",
    },
    selected: {
      true: "border-brand bg-brand text-bg",
      false: "bg-bg",
    },
    // A required box left empty at the send: the red edge every other field's error shows.
    invalid: {
      true: "",
      false: "",
    },
  },
  compoundVariants: [
    { selected: false, invalid: false, class: "border-border-control" },
    { selected: false, invalid: true, class: "border-danger" },
  ],
});

/** A checkbox's or a switch's message line, in the label's column. */
export const toggleLine = tv({ base: "col-start-2" });

/** A radio group's answers, one under another. */
export const radioList = tv({ base: "flex flex-col gap-2" });

/** The dot inside a chosen radio, in the page's ground. */
export const radioDot = tv({ base: "size-2.5 rounded-full bg-bg" });

/**
 * A switch's track, its thumb resting two pixels inside it. On, it fills with the link green; off, it keeps
 * the muted fill inside a 1-px edge in the fields' edge colour, so it shows against the page in either theme.
 */
export const switchTrack = tv({
  base: "mt-px flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors duration-(--motion-state)",
  variants: {
    selected: {
      true: "bg-brand",
      // Drawn inside the track, so the edge moves neither the track nor its thumb.
      false: "bg-bg-muted inset-ring inset-ring-border-control",
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
