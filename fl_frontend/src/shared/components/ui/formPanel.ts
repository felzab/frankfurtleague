/**
 * SHARED · form section panel recipe
 *
 * One section of a form that owns a whole page. The counterpart for a form inside a dialog is no
 * panel at all — the reasoning for the split is on `overlayPanel` and in ADR-0050.
 */

import { tv } from "tailwind-variants";

/**
 * A titled section of a page-owned form.
 *
 * **Depth is a property of the container, not of the section** (ADR-0050). Inside a dialog a bordered
 * section is a second border around the same fields, which costs more comprehension than the grouping
 * buys. On a page there is no outer border to nest inside, so this is the FIRST level of grouping and
 * it does what a horizontal rule cannot: it gives each group its own edges on a narrow screen, where a
 * rule between two stacks of fields is indistinguishable from a rule inside one.
 *
 * **A titled header rather than a heading floating in the body**, and that is the fix for the thing
 * the owner named: the previous version used `FORM_SECTION_HEADING` — an uppercase `fluid-xs`
 * micro-label — as the largest element in each panel, smaller than the inputs beneath it, which left
 * the page with no hierarchy to read. The panel now carries a real `fluid-base` title in its own
 * bordered strip, and that micro-label is demoted to marking sub-groups inside the body.
 *
 * **`rounded-t-2xl` on the header, and never `overflow-hidden` on the root.** Clipping the root is the
 * obvious way to make the header's corners follow the panel's, and it also clips every Autocomplete
 * popover the body contains — the trap `AdminSpieleActionRequiredView` documents for the same reason.
 * The header rounds its own top corners instead.
 *
 * `p-4 sm:p-5` on both slots: the phone needs the width more than it needs the inset, and that is the
 * surface the owner declared imperative.
 *
 * `tone="danger"` is for a section whose control does something the admin cannot undo by editing a
 * value back — the cancellation switch is the only one today. It follows the app's colour rule
 * exactly: `bg-danger/5` is a tint, `text-danger-strong` is text on a tint, and no `-solid` appears,
 * because nothing here is text on an opaque fill.
 */
export const formPanel = tv({
  slots: {
    root: "bg-surface border-border flex w-full flex-col rounded-2xl border shadow-sm",
    header: "border-border flex flex-col gap-y-0.5 rounded-t-2xl border-b p-4 sm:p-5",
    /** The title row, so an `InfoHint` can sit beside the heading without a wrapper at each site. */
    headingRow: "flex w-full flex-row items-center gap-x-2",
    heading: "fluid-base text-foreground font-extrabold tracking-tight",
    hint: "fluid-xxs text-foreground-muted font-medium",
    body: "flex w-full flex-col gap-y-5 p-4 sm:p-5",
  },
  variants: {
    tone: {
      neutral: {},
      danger: {
        root: "border-danger/30",
        header: "border-danger/20 bg-danger/5",
        heading: "text-danger-strong",
      },
    },
  },
  defaultVariants: { tone: "neutral" },
});
