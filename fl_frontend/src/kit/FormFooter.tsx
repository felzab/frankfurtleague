import { headGround } from "./cardStyles";
import { StatusLine } from "./FieldParts";
import { tv } from "./tv";

import type { ReactNode } from "react";
import type { FormStatus } from "./useFormAction";

/*
 * The footer of what a form sends, in the kit's one shape, as the editor's bar holds its save: the acts at the right
 * end, the main act last, and at the left the status line, which speaks only once there is an outcome, under a note
 * where the form carries one. On a phone the acts fill the row, one under another with the main act on top, and the
 * note and the line stand under them. No act stands centred or at the left.
 */
const formFooter = tv({
  slots: {
    root: "flex items-center justify-end gap-3 max-lg:flex-col-reverse max-lg:items-stretch",
    lead: "grid min-w-0 flex-1 gap-1 text-sm text-fg-muted",
  },
  variants: {
    place: {
      // A dialog's row and a page form's: the footer under the fields, in the dialog's or the column's own flow.
      row: {},
      // A box's strip, Konto's: under a hairline across the box, on the band a card's head stands on.
      strip: { root: `border-t border-border ${headGround()} px-4 py-3` },
      // The strip ending a section of an editor, standing last among its fields: out through the box's 16-px inset to
      // its edges and its bottom, its corners the box's.
      section: { root: `-mx-4 -mb-4 justify-self-stretch rounded-b-lg border-t border-border ${headGround()} px-4 py-3` },
    },
  },
});

export type FooterPlace = "row" | "strip" | "section";

/**
 * A form's footer: `status` the outcome its acts' last press reached, `note` a sentence the press rests on, such as
 * where a confirmation goes, and `children` the acts, the main one last. A container of fields places it; a page
 * never does.
 */
export function FormFooter({
  place = "row",
  status,
  note,
  children,
}: {
  place?: FooterPlace;
  status: FormStatus;
  note?: ReactNode;
  children: ReactNode;
}) {
  const slots = formFooter({ place });
  const line = (
    <StatusLine
      status={status}
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
      {children}
    </div>
  );
}

/** A footer while its form is read: its note's placeholder where it has one, and its acts' where they will stand. */
export function FormFooterPlaceholder({ place = "row", note, children }: { place?: FooterPlace; note?: ReactNode; children: ReactNode }) {
  const slots = formFooter({ place });
  return (
    <div className={slots.root()}>
      {note !== undefined && <div className={slots.lead()}>{note}</div>}
      {children}
    </div>
  );
}
