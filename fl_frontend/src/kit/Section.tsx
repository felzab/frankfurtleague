import { isValidElement } from "react";

import { COPY, textOf } from "@/core/copy";

import { Button } from "./Button";
import { buttonPlaceholder } from "./buttonStyles";
import { cardSurface, stacked } from "./cardStyles";
import { FieldPairPlaceholder, FieldPlaceholder } from "./FieldPair";
import { FieldRowsPlaceholder, subgroup } from "./FieldRows";
import { FieldStack } from "./FieldStack";
import { fieldFrame, fieldRoot, statusLine } from "./fieldStyles";
import { FormFooterPlaceholder } from "./FormFooter";
import { HelpPopover } from "./HelpPopover";
import { ScoreRowsPlaceholder } from "./ScoreRows";
import { placeholderBar, PlaceholderLine, PlaceholderSentence } from "./Skeleton";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { ReactElement, ReactNode } from "react";

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
 * hue in place of the hairline, as GitHub's danger zone marks its box, its buttons outlined with words in the same hue
 * (`askingLook`), the red fill kept for the question's press that destroys.
 */
export const dangerEdge = tv({ base: "border-danger" });

/**
 * The head of a box of a form, an editor's section and a Konto box alike: its title and the line under it on the box's
 * own fill, then, `ruled` where content follows, a hairline touching both of the box's edges, as GitHub Primer's
 * Subhead heads a settings section. The content stands under the rule in the box's padding.
 */
export const boxHead = tv({
  slots: {
    head: "grid gap-1 p-4",
    // The box's 16 px on every side, around the content's `FieldStack`.
    content: "grid p-4",
  },
  variants: {
    ruled: { true: { head: "border-b border-border" } },
  },
});

/**
 * A hairline between two parts of a section that one title holds, such as a match's score and its Sonderereignis:
 * across the box's whole width as the rule under the title, the fields' 16 px from the parts over and under it, which
 * is the box's own inset.
 */
export function SectionRule() {
  return <hr className="-mx-4 justify-self-stretch border-t border-border" />;
}

/**
 * One flat row of an editor's danger box: its name and its consequence at the left, its button at the right, parted
 * from the row above by the hairline every stacked part takes.
 */
export const dangerRow = tv({ base: `flex min-h-14 items-center gap-3 px-4 py-2 lg:min-h-13 ${stacked()}` });

/**
 * One row of a section as its placeholder draws it: one field at the standard width, two forming one value as
 * `FieldPair` sets them, `FieldRows`' rows of one kind by what they hold, a match's score, the hairline between two
 * groups of fields (`SectionRule`), a subgroup's name over the rows after it, a field whose label the section's title
 * is (`titled`, at its width), the section's footer strip with its acts (`SectionAct`) by their labels, last, or the
 * placeholder of whatever else the section holds, such as its facts' or a table's.
 */
export type FieldRow =
  | "field"
  | "pair"
  | "subhead"
  | "score"
  | "rule"
  | { rows: 2 | 3; holds: "count" | "day" }
  | { titled: "field" | "paragraph" }
  | { acts: readonly [Copy, ...Copy[]] }
  | ReactElement;

/** A titled field's frame: a single line at the standard width, or a paragraph at the box's. */
const TITLED_CLASSES = { field: fieldFrame.variants.width.standard, paragraph: fieldFrame.variants.width.full } as const;

function RowPlaceholder({ row }: { row: FieldRow }) {
  if (isValidElement(row)) return row;
  if (row === "rule") return <SectionRule />;
  if (row === "pair") return <FieldPairPlaceholder />;
  if (row === "field") return <FieldPlaceholder />;
  if (row === "score") return <ScoreRowsPlaceholder />;
  if (row === "subhead")
    return (
      <PlaceholderLine
        // The subgroup's space above its name, and under it the name's own 8 px, taken back out of the stack's 16.
        textClass={subgroup().name({ class: "-mb-2 not-first:mt-2" })}
        widthClass="w-24"
      />
    );
  if ("titled" in row)
    return (
      <div className={fieldRoot()}>
        <span className={placeholderBar(`rounded-lg ${TITLED_CLASSES[row.titled]}`)} />
      </div>
    );
  if ("acts" in row)
    return (
      <FormFooterPlaceholder place="section">
        {row.acts.map((act) => (
          <span
            key={act}
            className={buttonPlaceholder()}>
            {act}
          </span>
        ))}
      </FormFooterPlaceholder>
    );
  return (
    <FieldRowsPlaceholder
      rows={row.rows}
      holds={row.holds}
    />
  );
}

/**
 * A danger row while its record is read: its name, what the act does and the button's words, the first two set unseen so
 * each stands as many lines as it will beside the button.
 */
export type DangerRowWait = { name: Copy; consequence: Copy; act: Copy };

/**
 * A section while the record filling it is read: the section's own box, its title's line over its rule, and its
 * fields' placeholders row by row in the fields' own `FieldStack`, so the box stands as tall as the section will. `note`
 * is the words of the line a section's closed state stands under its title, set unseen, where the section can carry
 * one. An editor's danger box takes `danger` in their place, one flat row each, and a box holding a list edge to edge
 * `list`, the list's own placeholder, over `rows` where the section holds fields or acts under its list.
 */
export function SectionPlaceholder(
  props:
    | { rows: ReadonlyArray<FieldRow>; note?: Copy; danger?: never; list?: ReactElement }
    | { danger: ReadonlyArray<DangerRowWait>; rows?: never; note?: never; list?: never }
    | { list: ReactElement; rows?: never; note?: never; danger?: never },
) {
  const slots = boxHead({ ruled: true });
  return (
    <div className={cardSurface({ class: props.danger === undefined ? "grid" : `grid ${dangerEdge()}` })}>
      <div className={slots.head()}>
        <PlaceholderLine
          textClass="text-base font-semibold"
          widthClass="w-1/3"
        />
        {props.note !== undefined && (
          <PlaceholderSentence
            textClass="text-sm"
            words={props.note}
          />
        )}
      </div>
      {props.list !== undefined && <div className="grid">{props.list}</div>}
      {props.rows !== undefined && (
        <div className={slots.content()}>
          <FieldStack>
            {props.rows.map((row, index) => (
              <RowPlaceholder
                key={index}
                row={row}
              />
            ))}
          </FieldStack>
        </div>
      )}
      {props.danger !== undefined && (
        <div className="grid">
          {props.danger.map(({ name, consequence, act }) => (
            <div
              key={name}
              className={dangerRow()}>
              <div className="grid min-w-0 flex-1">
                <PlaceholderSentence
                  textClass="text-sm font-semibold"
                  words={name}
                />
                <PlaceholderSentence
                  textClass={statusLine({ placement: "column", tone: "resting" })}
                  words={consequence}
                />
              </div>
              <span className={buttonPlaceholder()}>{act}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A form's or a settings page's group of fields: a box exactly as tall as its content, its 16-px title over a
 * hairline, a one-control section included, whose one field takes its label as the title alone (`labelHidden`). One ⓘ
 * may follow the title. An editor's danger box is one too, its edge and title in the danger hue, holding the danger
 * rows, the one place its irreversible and retiring acts stand: flat rows across the box under the rule, each parted
 * from the next by a hairline, with no box of their own.
 */
export function Section({
  title,
  help,
  note,
  danger,
  list,
  children,
}: {
  title: Copy;
  /** The section's help behind the ⓘ after its title: a few short declarative lines, one statement each. */
  help?: readonly [Copy, ...Copy[]];
  /** Why the fields under the title cannot change, in the hue a closed act's reason takes, visible under the title. */
  note?: Copy;
  /** An editor's irreversible and retiring acts, one row each, filling the box's width: `EditorPage`'s danger rows. */
  danger?: ReactNode;
  /**
   * A list whose own hairlines reach the box's edges, such as a list of records (`RecordRows`): it fills the box's
   * width under the rule and brings its own insets, where `children` stand in the box's padding, under the list where a
   * section holds both, such as a table over the strip of its acts (`SectionAct`).
   */
  list?: ReactNode;
  children?: ReactNode;
}) {
  const slots = boxHead({ ruled: children !== undefined || danger !== undefined || list !== undefined });
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
                lines={help}>
                <Button
                  icon="info"
                  label={COPY.shared.help}
                />
              </HelpPopover>
            </span>
          )}
        </div>
        {note !== undefined && <p className="text-sm text-warn">{note}</p>}
      </div>
      {list !== undefined && <div className="grid">{list}</div>}
      {children !== undefined && (
        <div className={slots.content()}>
          <FieldStack>{children}</FieldStack>
        </div>
      )}
      {danger !== undefined && <div className="grid">{danger}</div>}
    </section>
  );
}
