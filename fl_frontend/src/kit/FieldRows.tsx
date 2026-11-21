import { FieldGroup } from "./FieldGroup";
import { FieldStack } from "./FieldStack";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

const fieldRows = tv({
  slots: {
    // Each row across the stack's whole width, its label at the far left and its control at the far right.
    // The row lays out its field's own parts, so a field needs no form of its own for it: the label fills the row's
    // start, on one line and centred on the control beside it, and the control stands at the row's end at its width.
    // A message, while the field has one, takes the row's whole width under them and ends under the control, so it runs
    // left past a short field's edge rather than being cut there.
    row: "w-full [&_[data-kit-message]]:col-span-full [&_[data-kit-message]]:text-end [&>*]:grid [&>*]:grid-cols-[minmax(0,1fr)_auto] [&>*]:gap-x-3 [&>*]:gap-y-1.5 [&>*>:first-child]:self-center [&>*>:first-child]:truncate",
  },
});

/**
 * Values of one kind, or a span's two ends, as rows: each row its label at the far left and its field at the far right,
 * at every width, so no label wraps and a phone's narrow box holds them as a wide one does. `label` names the group over
 * its rows as a `FieldGroup`. A lone field keeps its label above it, and two fields of two kinds stand as a
 * `FieldPair`.
 */
export function FieldRows({ label, children }: { label?: Copy; children: readonly [ReactNode, ReactNode, ...ReactNode[]] }) {
  const slots = fieldRows();
  const rows = children.map((child, index) => (
    <div
      // The fields are fixed in number and order, so their place is their identity.
      key={index}
      className={slots.row()}>
      {child}
    </div>
  ));
  return label === undefined ? <FieldStack>{rows}</FieldStack> : <FieldGroup name={label}>{rows}</FieldGroup>;
}
