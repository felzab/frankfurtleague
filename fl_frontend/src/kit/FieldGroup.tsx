import { FieldStack } from "./FieldStack";
import { SectionTitle } from "./Section";
import { PlaceholderLine } from "./Skeleton";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

const fieldGroup = tv({
  slots: {
    // `min-w-0`: a fieldset is at least as wide as its content by default, which would push a row of fields past the
    // dialog. 8 px more above it than between two fields, unless it opens the dialog's fields, as a box's subgroup sets
    // itself off (`subgroup`), and 16 px from its hairline to its fields, a box's own inset.
    root: "grid w-full min-w-0 gap-4 not-first:mt-2",
    // A legend is drawn outside its box's flow; floated, it is an ordinary child (Bootstrap's reboot), so the grid lays it
    // out. Stretched out through the dialog's padding, which the box declares, its hairline meets both of the dialog's
    // edges, the name kept at the fields' edge by the same padding inside it. Outside a dialog the padding is unset and
    // the hairline runs the group's width.
    head: "float-left -mx-(--dialog-padding) justify-self-stretch border-b border-border px-(--dialog-padding) pb-2",
  },
});

/**
 * A few of a dialog's fields under one short name, the address's lines and then the record's terms, as
 * GitHub Primer's Subhead parts a form: the name, the section title an editor's box carries, then 8 px under
 * it a hairline running the dialog's full width out to both its edges, then the fields in their one rhythm
 * (`FieldStack`). A `fieldset` with its `legend`, the heading inside the legend as GOV.UK's fieldset takes it, so
 * a screen reader says the group's name with each field and lists it among the dialog's headings, a step under
 * its title.
 */
export function FieldGroup({ name, children }: { name: Copy; children: ReactNode }) {
  const { root, head } = fieldGroup();
  return (
    <fieldset className={root()}>
      <legend className={head()}>
        <SectionTitle
          level={3}
          text={name}
        />
      </legend>
      <FieldStack>{children}</FieldStack>
    </fieldset>
  );
}

/** The group while its fields are read: its name's line over its hairline, and the fields' placeholders. */
export function FieldGroupPlaceholder({ children }: { children: ReactNode }) {
  const { root, head } = fieldGroup();
  return (
    <div className={root()}>
      <span className={head()}>
        <PlaceholderLine
          textClass="text-base font-semibold"
          widthClass="w-1/3"
        />
      </span>
      <FieldStack>{children}</FieldStack>
    </div>
  );
}
