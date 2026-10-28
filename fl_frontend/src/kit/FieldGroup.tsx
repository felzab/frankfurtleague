import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

/**
 * A few of a dialog's fields under one short name, the address's lines and then the record's terms, as
 * GitHub Primer's Subhead parts a form: the name above a hairline across the dialog's content, 8 px
 * under the name and 16 before the fields, the fields below. A `fieldset` with its `legend`, the HTML
 * shape GOV.UK's fieldset takes, so a screen reader says the group's name with each field. The name
 * takes the rung the rail sets over its groups, 12 px medium muted: a dialog is one box under its 20-px
 * title, so its groups are named a step below it as an editor's boxes are named a step below the page,
 * and the fields' own 14-px labels stay the heaviest words among the fields.
 */
export function FieldGroup({ name, children }: { name: Copy; children: ReactNode }) {
  return (
    // `min-w-0`: a fieldset is at least as wide as its content by default, which would push a row of fields past the dialog.
    <fieldset className="grid w-full min-w-0 justify-items-start gap-4">
      {/* A legend is drawn outside its box's flow; floated, it is an ordinary child (Bootstrap's reboot), so the grid
          lays it out and the hairline runs the full width. */}
      <legend className="float-left w-full border-b border-border pb-2 text-xs font-medium text-fg-muted">{name}</legend>
      {children}
    </fieldset>
  );
}
