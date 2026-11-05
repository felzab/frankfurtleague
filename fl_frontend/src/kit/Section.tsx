import { textOf } from "@/core/copy";

import { cardSurface } from "./cardStyles";
import { FieldColumns, FieldPairPlaceholder, FieldPlaceholder, subgroup } from "./FieldPair";
import { HelpPopover } from "./HelpPopover";
import { PlaceholderLine } from "./Skeleton";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { ReactNode } from "react";

const sectionTitle = tv({
  base: "text-base font-semibold",
  variants: { tone: { danger: "text-danger" } },
});

/**
 * A section's title, 16 px semibold, one step under the page's: an editor's or a Konto page's box, a read
 * page's group, the filter sheet, and a dialog's group of fields, one level under the dialog's own title. A danger
 * box's title takes the danger hue its edge takes (`dangerEdge`).
 */
export function SectionTitle({ text, level = 2, tone }: { text: Words; level?: 2 | 3; tone?: "danger" }) {
  const Heading = level === 2 ? "h2" : "h3";
  return <Heading className={sectionTitle({ tone })}>{textOf(text)}</Heading>;
}

/**
 * The edge of a box holding acts that destroy or retire, an editor's danger box and Konto's deletion box: the danger
 * hue in place of the hairline, as GitHub's danger zone marks its box, the red fill kept for the buttons that destroy.
 */
export const dangerEdge = tv({ base: "border-danger" });

/**
 * The rung a few entries are named on, 12 px medium muted, a step under a section's title: the rail's
 * groups and the phone sheet's. Each place adds its own spacing.
 */
export const groupHeading = tv({ base: "text-xs font-medium text-fg-muted" });

/**
 * The head of a box of a form, an editor's section and a Konto box alike: its title and the line under it on the box's
 * own fill, then, `ruled` where content follows, a hairline touching both of the box's edges, as GitHub Primer's
 * Subhead heads a settings section. The content stands under the rule in the box's padding.
 */
export const boxHead = tv({
  slots: {
    head: "grid gap-1 p-4",
    content: "grid justify-items-start p-4",
  },
  variants: {
    ruled: { true: { head: "border-b border-border" } },
  },
});

/**
 * One row of a section's fields as its placeholder draws it: one field at a long field's width, two in one row as
 * `FieldPair` sets them, `FieldColumns`' short fields of one kind at their width class, or a subgroup's name over the
 * rows after it.
 */
export type FieldRow = "field" | "pair" | "subhead" | { columns: 2 | 3; width: "C2" | "C10" };

function RowPlaceholder({ row }: { row: FieldRow }) {
  if (row === "pair") return <FieldPairPlaceholder />;
  if (row === "field") return <FieldPlaceholder width="W3" />;
  if (row === "subhead")
    return (
      <PlaceholderLine
        // The subgroup's space above its name, and under it the grid's 8-px gap in place of the name's own.
        text={subgroup().name({ class: "mb-0 not-first:mt-2" })}
        width="w-24"
      />
    );
  const [first, second, ...rest] = Array.from({ length: row.columns }, (_, index) => (
    <FieldPlaceholder
      key={index}
      width={row.width}
    />
  ));
  return <FieldColumns>{[first, second, ...rest]}</FieldColumns>;
}

/**
 * A section while the record filling it is read: the section's own box, its title's line over its rule, and its
 * fields' placeholders row by row, 8 px apart as its fields stand, so the box stands as tall as the section will.
 */
export function SectionPlaceholder({ rows }: { rows: ReadonlyArray<FieldRow> }) {
  const slots = boxHead({ ruled: true });
  return (
    <div className={cardSurface({ class: "grid" })}>
      <div className={slots.head()}>
        <PlaceholderLine
          text="text-base font-semibold"
          width="w-1/3"
        />
      </div>
      <div className={slots.content({ class: "gap-2" })}>
        {rows.map((row, index) => (
          <RowPlaceholder
            key={index}
            row={row}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A form's or a settings page's group of fields: a box exactly as tall as its content, its 16-px title over a
 * hairline, a one-control section included. One ⓘ may follow the title. An editor's danger box is one too, its edge
 * and title in the danger hue, holding the danger rows, the one place its irreversible and retiring acts stand: flat
 * rows across the box under the rule, each parted from the next by a hairline, with no box of their own.
 */
export function Section({
  title,
  help,
  note,
  danger,
  children,
}: {
  title: Copy;
  /** The section's help behind the ⓘ after its title: a few short declarative lines, one statement each. */
  help?: readonly [Copy, ...Copy[]];
  /** Why the fields under the title cannot change, in the hue a closed act's reason takes, visible under the title. */
  note?: Copy;
  /** An editor's irreversible and retiring acts, one row each, filling the box's width: `EditorPage`'s danger rows. */
  danger?: ReactNode;
  children?: ReactNode;
}) {
  const slots = boxHead({ ruled: children !== undefined || danger !== undefined });
  return (
    <section className={cardSurface({ class: danger === undefined ? "grid" : `grid ${dangerEdge()}` })}>
      <div className={slots.head()}>
        {/* The ⓘ stands beside the heading, not in it, so the heading is named by its title alone. Its button is taller
            than the title's line, and reaches into the head's padding rather than raising one head above another. */}
        <div className="flex items-center gap-2">
          <SectionTitle
            text={title}
            {...(danger === undefined ? {} : { tone: "danger" })}
          />
          {help !== undefined && (
            <span className="-my-1 flex pointer-coarse:-my-2">
              <HelpPopover
                subject={title}
                lines={help}
              />
            </span>
          )}
        </div>
        {note !== undefined && <p className="text-sm text-warn">{note}</p>}
      </div>
      {/* Each child at its own width: a field fills the column itself, a button among the fields keeps its. 8 px
          apart, each field's message line, always there, holding the rest of the space between two fields. */}
      {children !== undefined && <div className={slots.content({ class: "gap-2" })}>{children}</div>}
      {danger !== undefined && <div className="grid">{danger}</div>}
    </section>
  );
}
