import { smallCaps } from "./cardStyles";
import { FieldPlaceholder } from "./FieldPair";
import { fieldButton, fieldFrame, fieldLabel, fieldRoot, messageLine } from "./fieldStyles";
import { placeholderBar, PlaceholderLine } from "./Skeleton";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

/**
 * A group of a box's fields under its name, set as the kit's subhead in small capitals, such as a season's points over
 * the win, the draw and the loss: 8 px more above it than between two fields, unless it opens the box, and 8 px under
 * its name. A fieldset and its legend, the platform's own group with a name, which a screen reader says before each
 * field's label.
 */
export const subgroup = tv({
  slots: {
    root: "grid w-full min-w-0 not-first:mt-2",
    name: smallCaps({ class: "mb-2" }),
  },
});

/**
 * A few of a box's fields under their name, each field at its own width, as a school's address stands inside the
 * application's first box, and `FieldRows`' rows under theirs: the fields 8 px apart. A dialog parts its fields with
 * `./FieldGroup.tsx` instead, whose hairline runs to the dialog's edges, which a box inside a page does not have.
 */
export function FieldSubgroup({ name, children }: { name: Copy; children: ReactNode }) {
  const group = subgroup();
  return (
    <fieldset className={group.root()}>
      <legend className={group.name()}>{name}</legend>
      <div className="grid justify-items-start gap-2">{children}</div>
    </fieldset>
  );
}

const fieldRows = tv({
  slots: {
    // 8 px apart, as the fields of a box are.
    root: "grid w-full min-w-0 gap-2",
    // The row lays out its field's own parts, so a field needs no form of its own for it: the label fills the row's
    // start, on one line and centred on the control beside it, and the control stands at the row's end at its width
    // class. The message line, always there as every field's is, takes the row's whole width under them and ends under
    // the control, so a message runs left past a short field's edge rather than being cut there.
    row: "[&_[data-kit-message]]:col-span-full [&_[data-kit-message]]:text-end [&>*]:grid [&>*]:grid-cols-[minmax(0,1fr)_auto] [&>*]:gap-x-3 [&>*>:first-child]:self-center [&>*>:first-child]:truncate",
  },
});

/**
 * Values of one kind, or a span's two ends, as rows: each row its label at the far left and its field at the far right,
 * at every width, so no label wraps and a phone's narrow box holds them as a wide one does. `label` names the group over
 * its rows as a subgroup (`subgroup`). A lone field keeps its label above it, and two fields of two kinds stand as a
 * `FieldPair`.
 */
export function FieldRows({ label, children }: { label?: Copy; children: readonly [ReactNode, ReactNode, ...ReactNode[]] }) {
  const slots = fieldRows();
  const rows = (
    <div className={slots.root()}>
      {children.map((child, index) => (
        <div
          // The fields are fixed in number and order, so their place is their identity.
          key={index}
          className={slots.row()}>
          {child}
        </div>
      ))}
    </div>
  );
  return label === undefined ? rows : <FieldSubgroup name={label}>{rows}</FieldSubgroup>;
}

/**
 * Rows of fields while the record filling them is read, each field's placeholder in the block's own row: counts, each
 * two characters wide, or days. A row's control stands in a column as wide as its content, so a day's bar holds the
 * room of a day's figures and its calendar button, as the field in the row does.
 */
export function FieldRowsPlaceholder({ rows, holds }: { rows: 2 | 3; holds: "count" | "day" }) {
  const [first, second, ...rest] = Array.from({ length: rows }, (_, index) =>
    holds === "count" ? (
      <FieldPlaceholder
        key={index}
        width="short"
        holds={2}
      />
    ) : (
      <div
        key={index}
        className={fieldRoot()}>
        <PlaceholderLine
          textClass={fieldLabel({ class: "self-stretch" })}
          widthClass="w-full max-w-24"
        />
        <span
          className={placeholderBar(
            `rounded-lg text-sm pointer-coarse:text-base ${fieldFrame({ width: "standard", inset: "start", layout: "group", figures: true })}`,
          )}>
          <span className="w-[9ch]" />
          <span className={fieldButton()} />
        </span>
        <span className={messageLine()} />
      </div>
    ),
  );
  return <FieldRows>{[first, second, ...rest]}</FieldRows>;
}
