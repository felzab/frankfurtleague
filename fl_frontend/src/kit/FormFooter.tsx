"use client";

import { headGround } from "./cardStyles";
import { StatusLine } from "./FieldParts";
import { tv } from "./tv";

import type { ReactNode } from "react";
import type { FormStatus } from "./useFormAction";

/*
 * The footer of what a form sends, in the kit's one shape, as the editor's bar holds its save: the acts at the right
 * end, the main act last, and at the left the status line, which stands only once there is an outcome, under a note
 * where the form carries one. On a phone everything stands one under another, the note and the line first, then the
 * acts filling the row with the main act on top, where a stack's reader starts. No act stands centred or at the left.
 *
 * The document holds the acts in the row's order at every width and the CSS alone turns them on a phone, so the keys
 * meet a stacked footer's acts from its bottom. A section's strip holds equal acts, none the main one and no way back,
 * such as a link's „senden“, „ersetzen“ and „zurückziehen“: they keep the order they are read in at every width, one
 * under another on a phone and in a row from the left above it.
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
      row: { acts: "max-lg:flex-col-reverse" },
      // A box's strip, Konto's: under a hairline across the box, on the band a card's head stands on.
      strip: { root: `border-t border-border ${headGround()} px-4 py-3`, acts: "max-lg:flex-col-reverse" },
      // The strip ending a section of an editor, standing last among its fields: out through the box's 16-px inset to
      // its edges and its bottom, its corners the box's. Its acts are equal, so they keep their reading order.
      section: {
        root: `-mx-4 -mb-4 justify-self-stretch rounded-b-lg border-t border-border ${headGround()} px-4 py-3`,
        acts: "max-lg:flex-col",
      },
      // The sign-in's narrow centred column: across the column at every width, its one act filling it, as every button
      // of that column does. Its outcome stands in the column's one line under all of the page's acts, the passkey's
      // included, so the footer draws no line of its own.
      column: { root: "flex-col items-stretch justify-self-stretch", acts: "flex-col" },
    },
  },
});

export type FooterPlace = "row" | "strip" | "section" | "column";

/**
 * A form's footer: `status` the outcome its acts' last press reached, `note` a sentence the press rests on, such as
 * where a confirmation goes, and `children` the acts, the main one last, or a section's equal acts in their reading
 * order. A container of fields places it; a page never does.
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
  const slots = formFooter({ place });
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
      <div className={slots.acts()}>{children}</div>
    </div>
  );
}
