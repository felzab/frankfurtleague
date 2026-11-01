import { tv } from "./tv";

/**
 * A card's look, shared by the server-rendered `Card`, `CardLink` and `CardRow` and the client `CardFold`, so a
 * ruling on the card's surface, its head's fill or a row's hover changes one recipe. Kept apart from the
 * client module, whose every export a Server Component would receive as a reference it cannot call.
 *
 * A box with the hairline and the card corners, its head on the surface colour. Its body is rows, or fields
 * with the card's padding around them.
 */
export const card = tv({
  slots: {
    root: "grid overflow-hidden rounded-lg border border-border bg-bg text-fg",
    head: "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 border-b border-border bg-bg-surface px-4 py-3",
    title: "text-base font-semibold break-words",
    count: "col-start-2 row-start-1 font-numeric text-sm text-fg-muted",
    line: "col-span-2 text-sm text-fg-muted",
    body: "",
    foot: "flex justify-end p-4",
    chevron: "",
    row: "relative flex min-h-14 items-stretch gap-3 border-t border-border px-4 py-2 text-sm transition-colors duration-(--motion-state) first:border-t-0 hover:bg-bg-surface lg:min-h-13",
  },
  variants: {
    body: {
      rows: {},
      fields: { body: "p-4" },
    },
    // The head is the fold's button, the whole width, its title after the chevron. A folded card is its head
    // alone, so the line between head and body is the body's, and goes with it; the chevron turns to point
    // down while the body shows.
    fold: {
      true: {
        root: "group/fold",
        head: "w-full cursor-default border-b-0 text-left",
        title: "flex items-center gap-2",
        body: "border-t border-border",
        chevron: "flex shrink-0 text-fg-muted transition-transform duration-(--motion-state) group-data-expanded/fold:rotate-90",
      },
    },
  },
});
