"use client";

import { Children } from "react";

import { headGround } from "./cardStyles";
import { StatusLine } from "./FieldParts";
import { tv } from "./tv";
import { useDesktop } from "./useDesktop";

import type { ReactNode } from "react";
import type { FormStatus } from "./useFormAction";

/*
 * The footer of what a form sends, in the kit's one shape, as the editor's bar holds its save: the acts at the right
 * end, the main act last, and at the left the status line, which speaks only once there is an outcome, under a note
 * where the form carries one. On a phone everything stands one under another, the note and the line first, then the
 * acts filling the row with the main act on top, where a stack's reader starts. No act stands centred or at the left.
 *
 * The keys meet the acts in the order the screen shows them, so the document holds the main act first where the acts
 * stack and last where they stand in a row. Which layout stands is known only once the page's code runs, so the CSS
 * draws the acts' direction at every width for whichever order the document holds (`order`): the server's markup,
 * written in the row's order, already draws the main act on top on a phone, and the order turns under it after
 * hydration with nothing moving on the screen. A reversed column alone would part the keys from the screen.
 *
 * That turn is for a footer with one main act and a way back, a dialog's, a form's, a mailed page's. A section's strip
 * holds equal acts, none the main one and no way back, such as a link's „senden“, „ersetzen“ and „zurückziehen“: they
 * keep the order they are read in at every width, one under another on a phone and in a row from the left above it.
 */
const formFooter = tv({
  slots: {
    root: "flex items-center justify-end gap-3 max-lg:flex-col max-lg:items-stretch",
    lead: "grid min-w-0 flex-1 gap-1 text-sm text-fg-muted",
    acts: "flex gap-3",
  },
  variants: {
    place: {
      // A dialog's row and a page form's: the footer under the fields, in the dialog's or the column's own flow.
      row: {},
      // A box's strip, Konto's: under a hairline across the box, on the band a card's head stands on.
      strip: { root: `border-t border-border ${headGround()} px-4 py-3` },
      // The strip ending a section of an editor, standing last among its fields: out through the box's 16-px inset to
      // its edges and its bottom, its corners the box's. Its acts are equal, so they keep their reading order.
      section: { root: `-mx-4 -mb-4 justify-self-stretch rounded-b-lg border-t border-border ${headGround()} px-4 py-3` },
      // The sign-in's narrow centred column: across the column at every width, its acts filling it one under another,
      // as every button of that column does. Its outcome stands in the column's one line under all of the page's acts,
      // the passkey's included, so the footer draws no line of its own.
      column: { root: "flex-col items-stretch justify-self-stretch", acts: "flex-col" },
    },
    // Where the document holds the main act: last, the row's order, or first, the stack's; or none, a section's equal
    // acts in their reading order.
    order: { row: {}, stack: {}, reading: { acts: "max-lg:flex-col" } },
  },
  compoundVariants: [
    { place: ["row", "strip"], order: "row", class: { acts: "max-lg:flex-col-reverse" } },
    { place: ["row", "strip"], order: "stack", class: { acts: "flex-col lg:flex-row-reverse" } },
  ],
});

export type FooterPlace = "row" | "strip" | "section" | "column";

/** Where the document holds the acts: a section's in their reading order, the column's stacked, any other's by layout. */
const orderOf = (place: FooterPlace, isDesktop: boolean) => {
  if (place === "section") return "reading";
  return place === "column" || !isDesktop ? "stack" : "row";
};

/**
 * A form's footer: `status` the outcome its acts' last press reached, `note` a sentence the press rests on, such as
 * where a confirmation goes, and `children` the acts, the main one last, or a section's equal acts in their reading
 * order, each a child of its own rather than inside a fragment or a wrapper, which the footer could not reorder. A
 * container of fields places it; a page never does.
 */
export function FormFooter({
  place = "row",
  status,
  note,
  children,
}: ({ place?: Exclude<FooterPlace, "column">; status: FormStatus } | { place: "column"; status?: never }) & {
  note?: ReactNode;
  children: ReactNode;
}) {
  // The server answers the row until the browser's own answer replaces it (`useDesktop`); the column always stacks, and
  // a section keeps its reading order.
  const order = orderOf(place, useDesktop());
  const slots = formFooter({ place, order });
  const acts = Children.toArray(children);
  const line = place !== "column" && (
    <StatusLine
      status={status ?? null}
      placement="row"
    />
  );
  return (
    <div className={slots.root()}>
      {note === undefined ? (
        line
      ) : (
        <div className={slots.lead()}>
          {note}
          {line}
        </div>
      )}
      {/* Each act keeps its key from `toArray` as the order turns, so React moves it rather than mounting it anew, and
          React's commit gives a moved act back the focus the move took from it. */}
      <div className={slots.acts()}>{order === "stack" ? acts.reverse() : acts}</div>
    </div>
  );
}

/**
 * A footer while its form is read: its note's placeholder where it has one, and its acts' where they will stand, in
 * the order the server's markup of the footer holds, which the CSS draws as the footer's own.
 */
export function FormFooterPlaceholder({ place = "row", note, children }: { place?: FooterPlace; note?: ReactNode; children: ReactNode }) {
  // The server's answer, as `useDesktop`'s: the rail's width.
  const slots = formFooter({ place, order: orderOf(place, true) });
  return (
    <div className={slots.root()}>
      {note !== undefined && <div className={slots.lead()}>{note}</div>}
      <div className={slots.acts()}>{place === "column" ? Children.toArray(children).reverse() : children}</div>
    </div>
  );
}
