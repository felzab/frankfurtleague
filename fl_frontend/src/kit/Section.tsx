import { COPY, textOf } from "@/core/copy";

import { Button } from "./Button";
import { cardSurface, stacked } from "./cardStyles";
import { FieldStack } from "./FieldStack";
import { HelpPopover } from "./HelpPopover";
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
 * The muted lines under an editor's title, over its first box: the Vorschau and the lock line, one step apart as a
 * box's title and its line are (`boxHead`).
 */
export const editorHead = tv({ base: "grid gap-1 text-sm text-fg-muted" });

/**
 * The lock line's place: one line at every width, the same height whether it names a lock, a closed record's reason or
 * nothing, so the first box stands at one place under the title on every editor. `h-5` is `text-sm`'s 1.25-rem line;
 * the words are chosen to fit a 360-px phone, and the cut with „…“ only guards a larger font.
 */
export const lockSlot = tv({ base: "h-5 truncate" });

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
 * A form's or a settings page's group of fields: a box exactly as tall as its content, its 16-px title over a
 * hairline, a one-control section included, whose one field takes its label as the title alone (`labelHidden`). One ⓘ
 * may follow the title. An editor's danger box is one too, its edge and title in the danger hue, holding the danger
 * rows, the one place its irreversible and retiring acts stand: flat rows across the box under the rule, each parted
 * from the next by a hairline, with no box of their own.
 */
export function Section({
  title,
  help,
  danger,
  list,
  children,
}: {
  title: Copy;
  /** The section's help behind the ⓘ after its title: a few short declarative lines, one statement each. */
  help?: readonly [Copy, ...Copy[]];
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
