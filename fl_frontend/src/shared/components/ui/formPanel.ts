import { tv } from "tailwind-variants";

/**
 * **Depth is a property of the container rather than the section**: a form in a dialog groups by heading instead.
 * **`rounded-t-2xl` on the header, never `overflow-hidden` on the root**, which also clips the body's popovers.
 */
export const formPanel = tv({
  slots: {
    root: "bg-surface border-border flex w-full flex-col rounded-2xl border shadow-sm",
    header: "border-border flex flex-col gap-y-0.5 rounded-t-2xl border-b p-4 sm:p-5",
    /** Carries the panel's `InfoHint` inline, so the explanation lives on the title rather than as a standing sentence. */
    heading: "fluid-base text-foreground font-extrabold tracking-tight",
    body: "flex w-full flex-col gap-y-5 p-4 sm:p-5",
    /**
     * A `Switch.Content` row and its `Switch.Control` track, tinted from the tone rather than at the
     * call site: a colour retyped per switch is one that drifts from the panel around it.
     */
    switchContent: "fluid-sm flex h-fit w-fit flex-row items-center gap-x-3 font-bold",
    switchControl: "",
  },
  variants: {
    tone: {
      neutral: { switchContent: "text-foreground" },
      /** Grades the act ON OFFER, so a panel takes it only where there is still something to press. */
      danger: {
        root: "border-danger/30",
        header: "border-danger/20 bg-danger/5",
        heading: "text-danger-strong",
        switchContent: "text-danger",
        // `in-`, never a flag the call site passes down: `data-selected` sits on the switch above
        // the track, so the track cannot read whether it is on.
        switchControl: "in-data-selected:bg-danger",
      },
    },
  },
  defaultVariants: { tone: "neutral" },
});
