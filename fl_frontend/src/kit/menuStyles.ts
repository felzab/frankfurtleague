import { tv } from "./tv";

/*
 * The surface every list a control opens stands on, and the mark of its chosen entry, shared by a field's list and a
 * frame's menu. They stand apart from the fields' looks because every page draws a link or a menu, and a page holding
 * no field then loads none of the fields' looks.
 */

/** The menu a select, a combo box or a date's calendar opens, fading in and out. */
export const menuPopover = tv({
  base: "overflow-auto rounded-lg bg-bg-overlay p-1 shadow-menu transition-opacity duration-(--motion-in) data-entering:opacity-0 data-exiting:opacity-0 data-exiting:duration-(--motion-out)",
  variants: {
    // A list is as wide as its longest entry, never narrower than the field that opened it or wider than the
    // screen; a menu keeps a floor of 224 px, so a short list of words does not open as a sliver, and takes its
    // trigger's width where the trigger is a full-width row.
    fit: {
      content: "max-w-panel min-w-(--trigger-width)",
      menu: "min-w-56",
      trigger: "w-(--trigger-width) min-w-56",
    },
  },
});

/**
 * How a chosen entry is marked. In every list, a select's, a combo box's and a menu's, a navigating menu's current
 * place among them: its words in the link green and its check at the end, which the list draws, with no fill, so
 * the entry under the pointer or the keys, chosen or not, takes the one hover layer alone. The rail's current page is
 * a place of the frame rather than a list's choice, and keeps its own mark: the muted fill with the words in the link
 * green, drawn from the link's `aria-current`, so the page a screen reader hears marked is the one drawn marked.
 */
export const entryMark = tv({
  variants: {
    mark: {
      chosen: "data-selected:text-brand",
      // Tailwind writes an `aria-*` variant after `hover:` and `active:`, so the mark's words keep their green under
      // the pointer over an entry's own hover words.
      place: "aria-[current=page]:bg-bg-muted aria-[current=page]:text-brand",
    },
  },
});
