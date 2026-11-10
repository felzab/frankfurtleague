import { hoverLook } from "./hoverStyles";
import { tv } from "./tv";

/*
 * The look every field shares, kept in one place so a ruling changes it in one edit: the label, the
 * frame, the message line, the drawn box of a checkbox, radio or switch, and the menu a select or a
 * combo box opens. Each is a `tv()` recipe, which the class lint reads. A border's colour is named
 * because a border naming none takes its element's text colour.
 *
 * The touch rule: every pressable control's press target is at least the kit's control height on a touch screen,
 * 40 px (32 with a mouse), as WCAG 2.5.8's target size asks with the kit's own figure; a link inside running text is
 * the exception that criterion makes for inline targets. A control drawn at that height is its own target; one drawn
 * smaller keeps its look and reaches the height through its row (`toggleRow`) or through a target laid over its
 * frame's inset (`choiceButton`'s segment). A field's frame draws its 1-px edge as an inset ring, which takes no room,
 * so a part filling the frame, a date's calendar button, a combo box's arrow or a search's text, is the frame's whole
 * height.
 */

/**
 * A field's label, its frame and its message line, one under another. It fills its column, so a box's grid
 * can place every child at its own width without a field narrowing to its label.
 */
export const fieldRoot = tv({ base: "group flex w-full min-w-0 flex-col gap-1" });

export const fieldLabel = tv({ base: "self-start text-sm font-medium text-fg" });

/** The asterisk after a required field's label. */
export const requiredMark = tv({ base: "text-danger" });

/**
 * At least one line, always there, so a message that fits it moves nothing. A longer one wraps at its field's width
 * and takes a second line rather than being cut, since its end is what a person acts on. Its words add nothing to the
 * width a field is laid out at, so it never widens a field sized by its content, such as a pair's short side; a note
 * inside a list's entry sets its own width instead, the entry being sized by its words.
 */
export const messageLine = tv({
  base: "min-h-4 text-xs",
  variants: {
    width: {
      field: "contain-inline-size",
      words: "",
    },
    tone: {
      description: "text-fg-muted",
      consequence: "text-warn",
      error: "text-danger",
    },
  },
  defaultVariants: { width: "field" },
});

/**
 * A form's status line, at its acts: always there and at least one line tall, so an outcome appearing moves
 * nothing, and never cut, since a sentence's end is what says what happened. Beside the acts in a row it takes the
 * room the acts leave, wrapping there; under them in a column, as on the sign-in, it takes the whole width. A line
 * can hold an address, so a word wraps anywhere: `wrap-anywhere` rather than `wrap-break-word`, whose word still
 * counts whole in the width of a grid track around the line and pushes the acts out of their box.
 */
export const statusLine = tv({
  base: "min-h-5 text-sm wrap-anywhere",
  variants: {
    placement: {
      row: "min-w-0 flex-1",
      column: "",
    },
    tone: {
      none: "",
      changes: "text-fg",
      // A danger row's second line at rest, its act's consequence in the small muted face.
      resting: "text-xs text-fg-muted",
      saved: "text-success",
      // An act that partly happened: neither of the two beside it.
      warn: "text-warn",
      error: "text-danger",
    },
  },
});

/**
 * The edge a value is typed into: 32 px with a mouse, 40 px and 16-px text on a touch screen, transparent inside
 * its control edge, as every control is, so it takes the fill of the page or the card it stands on, as the
 * secondary button does. The edge is an inset ring, as the switch's track draws its own, so the frame's parts fill
 * its whole height by the touch rule at this file's head, the edge lying inside the frame's inset.
 */
export const fieldFrame = tv({
  base: "rounded-lg bg-transparent text-sm text-fg inset-ring inset-ring-border-control transition-[color,outline-color,box-shadow] duration-(--motion-state) group-data-invalid:inset-ring-danger data-disabled:opacity-50 data-invalid:inset-ring-danger pointer-coarse:text-base",
  variants: {
    // A field's width says what it holds, since a person reads the length of a field as the length of its answer:
    // three widths at one left edge, each with the same 12-px inset, so the values of a box start at one x whatever
    // their length.
    width: {
      // A value of a known length, a score, a minute, a price: as wide as that value, by `holds`.
      short: "h-8 pointer-coarse:h-10",
      // Every value whose length varies, a name, an address, a date, a time, a choice: one width
      // (`--container-field`), which a narrower column, a phone's row among them, cuts to its own.
      standard: "h-8 w-full max-w-field pointer-coarse:h-10",
      // Free text: its box's whole width, at four lines.
      full: "min-h-26 w-full resize-none py-2",
    },
    // How many characters a short field holds, as the GOV.UK Design System counts its fixed-width inputs: the count
    // and one more for the caret, measured in the field's own figures so the width grows with the reader's font
    // size, inside the two 12-px insets with 2 px to spare (1.625 rem together). A unit after the value stands
    // inside the frame, which is then as wide as the two (`fieldUnit`).
    holds: {
      // A score, a shirt number, a count.
      2: "w-[calc(3ch+1.625rem)]",
      // A minute, a price, a postcode, a house number.
      5: "w-[calc(6ch+1.625rem)]",
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
      true: "font-numeric",
    },
  },
});

/**
 * A short field whose value has a unit, as „€“ follows a price: the unit stands inside the frame at its end, so the
 * figure and its unit read as one value and the field keeps the box's one left edge. The frame is as wide as the
 * value's room and the unit together. The value's room is `fieldFrame`'s count less the frame's insets, set on the
 * input, whose figures the count is measured in; the unit keeps the page's face.
 */
export const fieldUnit = tv({
  slots: {
    frame: "flex w-fit items-center gap-1.5 group-data-disabled:opacity-50",
    value: "h-full min-w-0 bg-transparent font-numeric",
    unit: "shrink-0 text-fg",
  },
  variants: {
    holds: {
      2: { value: "w-[calc(3ch+0.125rem)]" },
      5: { value: "w-[calc(6ch+0.125rem)]" },
    },
  },
});

/** The button at a field's end, a date's calendar or a combo box's arrow: as tall and as wide as the field. */
export const fieldButton = tv({
  base: `flex h-full w-8 shrink-0 items-center justify-center text-fg-muted transition-colors duration-(--motion-state) pointer-coarse:w-10 ${hoverLook({ host: "aria", answer: "full" })}`,
});

/** A calendar's way to the month before or after: a control of its own size, since the calendar's head has no height to fill. */
export const monthArrow = tv({
  base: `flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors duration-(--motion-state) data-disabled:cursor-default data-disabled:opacity-50 pointer-coarse:size-10 ${hoverLook({ host: "aria", answer: "full" })}`,
});

/** The text a combo box or a search field is typed into, filling its frame between the frame's other parts. */
export const groupInput = tv({ base: "h-full min-w-0 flex-1 bg-transparent" });

/** A search field's magnifier, at the frame's start. */
export const searchGlyph = tv({ base: "flex shrink-0 items-center ps-3 pe-2 text-fg-muted" });

/** A search field's text, without the clearing cross WebKit draws inside a search input. */
export const searchInput = tv({ base: "h-full min-w-0 flex-1 bg-transparent [&::-webkit-search-cancel-button]:hidden" });

/** A search field's clearing button, there only once something is typed. */
export const searchClear = tv({ extend: fieldButton, base: "group-data-empty:invisible" });

/** The six code boxes, centred in the column as every code entry sets them, with the code's one input laid over them. */
export const codeRow = tv({ base: "relative flex justify-center gap-2" });

/**
 * One drawn code box, in a field's frame and transparent fill whatever the pointer, its digit large and centred: a square
 * sharing the row with the other five, at most 44 px, so on a phone narrower than the six at full size they
 * stay square and narrow together.
 */
export const codeBox = tv({
  base: "flex aspect-square max-w-11 min-w-0 flex-1 items-center justify-center rounded-lg border border-border-control bg-transparent font-numeric text-xl font-semibold text-fg transition-colors duration-(--motion-state) group-data-disabled:opacity-50 group-data-invalid:border-danger",
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

/**
 * A day in a date's calendar, as large as a control; the chosen day inverts. React Aria's calendar moves its focus by
 * the keys alone and marks the day under the pointer `data-hovered`, so the pointer lays the one hover layer on a day
 * as the keys' focus does (`focus.css`), over the chosen day's inverted mark too.
 */
export const calendarCell = tv({
  base: `flex size-8 cursor-pointer items-center justify-center rounded-md font-numeric text-sm transition-colors duration-(--motion-state) data-disabled:cursor-default data-disabled:opacity-50 data-outside-month:text-fg-muted data-selected:bg-fg data-selected:text-bg pointer-coarse:size-10 ${hoverLook({ host: "aria" })}`,
});

/**
 * A checkbox or a switch with its message line: the drawn box's column, then the label's, so the line under
 * the row starts where the label does, whatever the box's width.
 */
export const toggleField = tv({ base: "grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1" });

/**
 * A checkbox, a radio or a switch: the drawn box, its label 10 px to the right. The row is the control's press
 * target, its label included, and on a touch screen it is the kit's control height at least, 10 px over and under
 * a line's 20 px, by the touch rule at this file's head.
 */
export const toggleRow = tv({
  base: "group/toggle cursor-pointer items-start text-sm text-fg data-disabled:cursor-default data-disabled:opacity-50 pointer-coarse:py-2.5",
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
  base: `mt-px flex size-4.5 shrink-0 items-center justify-center border transition-colors duration-(--motion-state) ${hoverLook({ host: "toggle" })}`,
  variants: {
    shape: {
      square: "rounded-sm",
      round: "rounded-full",
    },
    selected: {
      true: "border-brand bg-brand text-bg",
      false: "bg-transparent",
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
 */
export const toggleLine = tv({ base: "col-start-2 grid" });

/**
 * A radio group's answers: one under another, or, where each answer is described, side by side as cards,
 * one equal column per answer on desktop so the row is always full.
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
 */
export const choiceCard = tv({
  slots: {
    card: `grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 rounded-lg border border-border-control bg-transparent p-4 text-sm text-fg transition-colors duration-(--motion-state) data-disabled:cursor-default data-disabled:opacity-50 data-selected:border-brand data-selected:inset-ring-1 data-selected:inset-ring-brand ${hoverLook({ host: "aria" })}`,
    words: "grid gap-1",
    title: "font-semibold",
    line: "text-xs text-fg-muted",
  },
});

/**
 * The dot inside a chosen radio, in the page's ground.
 */
export const radioDot = tv({ base: "size-2.5 rounded-full bg-bg" });

/**
 * A switch's track, its thumb resting two pixels inside it. On, it fills with the link green; off, it keeps
 * the muted fill inside a 1-px edge in the fields' edge colour, so it shows against the page in either theme.
 */
export const switchTrack = tv({
  base: `mt-px flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors duration-(--motion-state) ${hoverLook({ host: "toggle" })}`,
  variants: {
    selected: {
      // In the ground's colour as its thumb is, so the layer steps the fill as it does a chosen box's.
      true: "bg-brand text-bg",
      // Drawn inside the track, so the edge moves neither the track nor its thumb.
      false: "bg-bg-muted inset-ring inset-ring-border-control",
    },
  },
});

/**
 * The switch's thumb: the control edge's grey on the off track, the page's ground on the brand fill once on,
 * sliding to the track's end when on.
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
  base: "overflow-auto rounded-lg bg-bg-overlay p-1 shadow-menu transition-opacity duration-(--motion-in) data-entering:opacity-0 data-exiting:opacity-0 data-exiting:duration-(--motion-out)",
  variants: {
    // A list is as wide as the field that opened it, or as its longest entry, never narrower than its field or
    // wider than the screen; a menu keeps a floor of 224 px, so a short list of words does not open as a
    // sliver, and takes its trigger's width where the trigger is a full-width row.
    fit: {
      field: "w-(--trigger-width)",
      content: "max-w-panel min-w-(--trigger-width)",
      menu: "min-w-56",
      trigger: "w-(--trigger-width) min-w-56",
    },
  },
});

/**
 * The pop-up the help behind a section's ⓘ opens in, anchored to its control and dimming nothing: a few sentences set
 * at 320 px so they wrap at one measure, never wider than the screen, in the control edge, which stands apart from the
 * row or the box beneath it where the hairline is lost on it.
 */
export const popoverSurface = tv({
  base: "max-w-panel rounded-lg border border-border-control bg-bg-overlay p-3 text-sm text-fg shadow-menu transition-opacity duration-(--motion-in) data-entering:opacity-0 data-exiting:opacity-0 data-exiting:duration-(--motion-out)",
  variants: {
    width: {
      help: "w-popover",
    },
  },
});

/** One entry of that menu: a fill when the pointer or the arrow keys reach it. */
export const menuItem = tv({
  base: "flex min-h-8 cursor-pointer items-center justify-between gap-2 rounded-md px-3 text-sm text-fg data-disabled:cursor-default data-disabled:opacity-50 pointer-coarse:min-h-10 pointer-coarse:text-base",
});

/**
 * How a chosen entry is marked. In every list, a select's, a combo box's and a menu's, a navigating menu's current
 * place among them: its words in the link green and its check at the end, which the list draws, with no fill, so
 * the entry under the pointer or the keys, chosen or not, takes the one hover layer alone (`focus.css`). The rail's
 * current page is a place of the frame rather than a list's choice, and keeps its own mark: the muted fill with the
 * words in the link green.
 */
export const entryMark = tv({
  variants: {
    mark: {
      chosen: "data-selected:text-brand",
      place: "data-selected:bg-bg-muted data-selected:text-brand",
    },
  },
});

/**
 * A short choice drawn as buttons: the segmented control of a single choice, its segments in one frame, and the
 * toggle boxes of a small multi-select, each box standing alone; both transparent inside their edges. A choice the
 * write refused (`data-invalid`) takes the red edge a refused field's frame takes: the segments' frame, and each box
 * not chosen, a chosen one keeping the mark that says it is chosen.
 */
export const choiceGroup = tv({
  base: "flex flex-wrap",
  variants: {
    kind: {
      segmented:
        "inline-flex h-8 self-start rounded-lg border border-border-control bg-transparent p-0.5 data-invalid:border-danger pointer-coarse:h-10",
      boxes: "gap-2 data-invalid:*:not-data-selected:border-danger",
    },
  },
});

/**
 * One answer of that choice, semibold once chosen. The chosen segment is raised out of its frame, the
 * highlight fill inside a 1-px control edge, as GitHub Primer's segmented control draws it; a chosen box takes the
 * link green's edge and its 12 % tint, as a chosen form value is tinted, so an accepted box stands apart from a
 * declined one on a card as on the page. Under the pointer and pressed, chosen or not, each takes the one hover layer.
 */
export const choiceButton = tv({
  base: "inline-flex cursor-pointer items-center justify-center text-sm font-medium whitespace-nowrap text-fg transition-colors duration-(--motion-state) data-disabled:cursor-default data-disabled:opacity-50 data-selected:font-semibold",
  variants: {
    kind: {
      // Drawn inside its frame's 2-px inset and 1-px edge, 26 px with a mouse and 34 on a touch screen; its press target
      // reaches over both, the frame's whole 32 or 40 px, so the raised segment keeps its look and the frame its
      // height beside the fields, by the touch rule at this file's head. The target is laid from the segment's own
      // inner edge: its 1-px edge, then the frame's inset and edge, 4 px up and down, its own edge at the sides.
      segmented: `relative h-full rounded-md border border-transparent before:absolute before:-inset-x-px before:-inset-y-1 data-selected:border-border-control data-selected:bg-bg-muted ${hoverLook({ host: "aria" })}`,
      boxes: `h-8 min-w-16 rounded-lg border border-border-control bg-transparent px-3 data-selected:border-brand data-selected:bg-brand/12 pointer-coarse:h-10 ${hoverLook({ host: "aria" })}`,
    },
    // A segment holds words at the boxes' width, or a glyph alone, as wide as a control is tall, muted until chosen.
    content: {
      words: "",
      glyph: "",
    },
  },
  compoundVariants: [
    { kind: "segmented", content: "words", class: "min-w-16 px-3" },
    {
      kind: "segmented",
      content: "glyph",
      class: `w-8 text-fg-muted data-selected:text-fg pointer-coarse:w-10 ${hoverLook({ host: "aria", answer: "words" })}`,
    },
  ],
  defaultVariants: { content: "words" },
});
