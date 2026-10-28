import { tv } from "tailwind-variants/lite";

/*
 * The look every field shares, kept in one place so a ruling changes it in one edit: the label, the
 * frame, the message line, the drawn box of a checkbox, radio or switch, and the menu a select or a
 * combo box opens. Each is a `tv()` recipe, which the class lint reads. A border's colour is named
 * because HeroUI's base sheet colours every element's border.
 */

/**
 * A field's label, its frame and its message line, one under another. It fills its column, so a box's grid
 * can place every child at its own width without a field narrowing to its label.
 */
export const fieldRoot = tv({ base: "group flex w-full min-w-0 flex-col gap-1" });

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

/**
 * A form's status line, at its acts: always there and at least one line tall, so an outcome appearing moves
 * nothing. Beside the acts in a row it shares the row and is cut at its second line; under them in a column,
 * as on the sign-in, it takes every line a refusal needs.
 */
export const statusLine = tv({
  base: "min-h-5 text-sm",
  variants: {
    placement: {
      row: "line-clamp-2 min-w-0 flex-1",
      column: "",
    },
    tone: {
      none: "",
      changes: "text-fg",
      saved: "text-success",
      error: "text-danger",
    },
  },
});

/**
 * The edge a value is typed into: 36 px with a mouse, 44 px and 16-px text on a touch screen, filled with the
 * surface one step up from the page inside its control edge.
 */
export const fieldFrame = tv({
  base: "rounded-lg border border-border-control bg-bg-surface text-sm text-fg transition-colors duration-(--motion-state) group-data-invalid:border-danger data-disabled:opacity-50 data-invalid:border-danger pointer-coarse:text-base",
  variants: {
    // A field is as wide as its value. The short widths are counted in characters, as the GOV.UK Design
    // System sizes its fixed-width inputs, so they grow with the reader's font size: each holds its count
    // of characters and one more for the caret, inside the two 10-px insets and the two 1-px edges
    // (1.375 rem together). Then the column, and the column at four lines for a paragraph.
    width: {
      // A score.
      C2: "h-9 w-[calc(3ch+1.375rem)] pointer-coarse:h-11",
      // A postcode, a time, whole euros, a house number.
      C5: "h-9 w-[calc(6ch+1.375rem)] pointer-coarse:h-11",
      // A date: the width of a ten-character field and its calendar button beside it, 36 px with a mouse
      // and 44 on a touch screen as every field's button is.
      C10: "h-9 w-[calc(11ch+1.375rem+2.25rem)] pointer-coarse:h-11 pointer-coarse:w-[calc(11ch+1.375rem+2.75rem)]",
      W3: "h-9 w-full pointer-coarse:h-11",
      // A select of a few short choices: as wide as its longest choice, which `Select` lays in the frame unseen.
      fit: "h-9 w-fit max-w-full min-w-40 pointer-coarse:h-11",
      W4: "min-h-26 w-full resize-none py-2",
    },
    // A frame holding the value alone takes the padding; a frame grouping a value and a button keeps its
    // start. The padding is set per width below: the short widths take 10 px, the long ones 12 px.
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
    { width: ["C2", "C5", "C10"], inset: "full", class: "px-2.5" },
    { width: ["C2", "C5", "C10"], inset: "start", class: "ps-2.5" },
    { width: ["W3", "W4", "fit"], inset: "full", class: "px-3" },
    { width: ["W3", "W4", "fit"], inset: "start", class: "ps-3" },
  ],
});

/**
 * A unit after its field and outside it, as „€“ follows a price: 10 px off, as a box's label is, in the field's
 * own text, so the figure and its unit read as one value.
 */
export const fieldUnit = tv({
  slots: {
    row: "flex items-center gap-2.5",
    unit: "text-sm text-fg pointer-coarse:text-base",
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

/** The six code boxes, centred in the column as every code entry sets them, with the code's one input laid over them. */
export const codeRow = tv({ base: "relative flex justify-center gap-2" });

/** One drawn code box: a 44-px square in a field's frame and fill, whatever the pointer, its digit large and centred. */
export const codeBox = tv({
  base: "flex size-11 items-center justify-center rounded-lg border border-border-control bg-bg-surface font-numeric text-xl font-semibold text-fg tabular-nums transition-colors duration-(--motion-state) group-data-disabled:opacity-50 group-data-invalid:border-danger",
});

/**
 * The code's input over its boxes: its own text, caret and selection transparent, so the boxes show the
 * digits; 16 px, so a phone does not zoom in on focus.
 */
export const codeInput = tv({
  base: "absolute inset-0 size-full bg-transparent text-base text-transparent caret-transparent selection:bg-transparent",
});

/**
 * One segment of a date or a time; the active one fills, at the 6-px corners of a highlighted part. An empty
 * segment shows its placeholder in capitals, „TT.MM.JJJJ“, as German forms write it.
 */
export const dateSegment = tv({ base: "rounded-md caret-transparent data-placeholder:text-fg-muted data-placeholder:uppercase" });

/** The weekdays over a date's calendar, in the caption grade. */
export const calendarHead = tv({ base: "pb-1 text-xs font-medium text-fg-muted" });

/** A day in a date's calendar, as large as a control; the chosen day inverts. */
export const calendarCell = tv({
  base: "flex size-9 cursor-default items-center justify-center rounded-md font-numeric text-sm tabular-nums data-disabled:opacity-50 data-outside-month:text-fg-muted data-selected:bg-fg data-selected:text-bg pointer-coarse:size-11",
});

/**
 * A checkbox or a switch with its message line: the drawn box's column, then the label's, so the line under
 * the row starts where the label does, whatever the box's width.
 * @awaitsProduction session 4's `Checkbox`, session 5's `Switch`
 */
export const toggleField = tv({ base: "grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1" });

/**
 * A checkbox, a radio or a switch: the drawn box, its label 10 px to the right.
 * @awaitsProduction session 4's `Checkbox` and `RadioGroup`, session 5's `Switch`
 */
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
 * @awaitsProduction session 4's `Checkbox` and `RadioGroup`
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

/**
 * A checkbox's or a switch's message line, in the label's column. A grid, so the line inside it is a block at
 * its own 16-px height, as a field's line is, rather than an inline span set in the page's taller line box.
 * @awaitsProduction session 4's `Checkbox`, session 5's `Switch`
 */
export const toggleLine = tv({ base: "col-start-2 grid" });

/**
 * A radio group's answers: one under another, or, where each answer is described, side by side as cards,
 * one equal column per answer on desktop so the row is always full.
 * @awaitsProduction session 4's `RadioGroup`
 */
export const radioList = tv({
  variants: {
    layout: {
      list: "flex flex-col gap-2",
      cards: "grid gap-2 lg:auto-cols-fr lg:grid-flow-col",
    },
  },
});

/**
 * A described answer drawn as a card: its circle, then its title over its line, 10 px apart as a box and its
 * label are; the chosen card edged 2 px in the link green.
 * @awaitsProduction session 4's `RadioGroup`
 */
export const choiceCard = tv({
  slots: {
    card: "grid cursor-default grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 rounded-lg border border-border-control bg-bg p-4 text-sm text-fg transition-colors duration-(--motion-state) data-disabled:opacity-50 data-selected:border-brand data-selected:inset-ring-1 data-selected:inset-ring-brand",
    words: "grid gap-1",
    title: "font-semibold",
    line: "text-xs text-fg-muted",
  },
});

/**
 * The dot inside a chosen radio, in the page's ground.
 * @awaitsProduction session 4's `RadioGroup`
 */
export const radioDot = tv({ base: "size-2.5 rounded-full bg-bg" });

/**
 * A switch's track, its thumb resting two pixels inside it. On, it fills with the link green; off, it keeps
 * the muted fill inside a 1-px edge in the fields' edge colour, so it shows against the page in either theme.
 * @awaitsProduction session 5's `Switch`
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

/**
 * The switch's thumb: the control edge's grey on the off track, the page's ground on the brand fill once on,
 * sliding to the track's end when on.
 * @awaitsProduction session 5's `Switch`
 */
export const switchThumb = tv({
  base: "size-4 rounded-full transition-[transform,background-color] duration-(--motion-state)",
  variants: {
    selected: {
      true: "translate-x-4 bg-bg",
      // Off, the thumb takes the control edge's grey, which shows on the muted track in both themes; the
      // page's ground would sit at 1.3:1 on it.
      false: "translate-x-0 bg-border-control",
    },
  },
});

/** The menu a select, a combo box or a date's calendar opens, fading in and out. */
export const menuPopover = tv({
  base: "overflow-auto rounded-lg bg-bg p-1 shadow-menu transition-opacity duration-(--motion-in) data-entering:opacity-0 data-exiting:opacity-0 data-exiting:duration-(--motion-out)",
  variants: {
    // A list is as wide as the field that opened it, or as its longest entry, never narrower than its field or
    // wider than the screen; a menu keeps a floor of 224 px, so a short list of words does not open as a
    // sliver, and takes its trigger's width where the trigger is a full-width row.
    fit: {
      field: "w-(--trigger-width)",
      content: "max-w-[calc(100vw-2rem)] min-w-(--trigger-width)",
      menu: "min-w-56",
      trigger: "w-(--trigger-width) min-w-56",
    },
  },
});

/** One entry of that menu: a fill when the pointer or the arrow keys reach it. */
export const menuItem = tv({
  base: "flex min-h-9 cursor-default items-center justify-between gap-2 rounded-md px-3 text-sm text-fg data-disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:text-base",
});

/**
 * How a list marks its chosen entry, by what choosing it means, in every list that has one. A form's value,
 * in a select's, a combo box's or a menu's choice: the row tinted 12 % of the link green, its check at the
 * end. A navigating menu's current place: the rail's mark of the current page, the muted fill with the words
 * in the link green, and no check.
 */
export const entryMark = tv({
  variants: {
    mark: {
      value: "data-selected:bg-brand/12",
      place: "data-selected:bg-bg-muted data-selected:text-brand",
    },
  },
});

/**
 * A short choice drawn as buttons: the segmented control of a single choice, its segments in one frame on the
 * surface, and the toggle boxes of a small multi-select, each box standing alone.
 */
export const choiceGroup = tv({
  base: "flex flex-wrap",
  variants: {
    kind: {
      segmented: "inline-flex h-9 self-start rounded-lg border border-border-control bg-bg-surface p-0.5 pointer-coarse:h-11",
      boxes: "gap-2",
    },
  },
});

/**
 * One answer of that choice, semibold once chosen. The chosen segment is raised out of its frame, the
 * highlight fill inside a 1-px control edge, as GitHub Primer's segmented control draws it; a chosen box lifts
 * to the surface, its edge one grade stronger, so the edge tells it from its neighbours too.
 */
export const choiceButton = tv({
  base: "inline-flex cursor-default items-center justify-center text-sm font-medium whitespace-nowrap text-fg transition-colors duration-(--motion-state) data-disabled:opacity-50 data-selected:font-semibold",
  variants: {
    kind: {
      segmented: "h-full rounded-md border border-transparent data-selected:border-border-control data-selected:bg-bg-muted",
      boxes:
        "h-9 min-w-16 rounded-lg border border-border-control bg-bg px-3 data-selected:border-fg-muted data-selected:bg-bg-surface pointer-coarse:h-11",
    },
    // A segment holds words at the boxes' width, or a glyph alone, as wide as a control is tall, muted until chosen.
    content: {
      words: "",
      glyph: "",
    },
  },
  compoundVariants: [
    { kind: "segmented", content: "words", class: "min-w-16 px-3" },
    { kind: "segmented", content: "glyph", class: "w-9 text-fg-muted data-selected:text-fg pointer-coarse:w-11" },
  ],
  defaultVariants: { content: "words" },
});
