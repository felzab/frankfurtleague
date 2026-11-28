import { smallCaps } from "./cardStyles";
import { FieldStack } from "./FieldStack";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

const fieldGroup = tv({
  slots: {
    // `min-w-0`: a fieldset is at least as wide as its content by default, which would push a row of fields past its
    // box. Set further off the field above it than two fields are, unless it opens the fields it stands among.
    root: "grid w-full min-w-0 not-first:mt-2",
    name: smallCaps({ class: "mb-2" }),
  },
});

/**
 * A few fields under one short name, in a dialog as in a page's box: the address's lines, a record's terms, a season's
 * points over the win, the draw and the loss, each field at its own width or as `FieldRows`' rows. The name is set as
 * the kit's subhead in small capitals, the label rung, over the fields in their one rhythm. A `fieldset` and its
 * `legend`, the platform's own group with a name, which a screen reader says before each field's label; the legend is
 * no heading, so the group takes no rung in the page's or the dialog's outline.
 */
export function FieldGroup({ name, children }: { name: Copy; children: ReactNode }) {
  const slots = fieldGroup();
  return (
    <fieldset className={slots.root()}>
      <legend className={slots.name()}>{name}</legend>
      <FieldStack>{children}</FieldStack>
    </fieldset>
  );
}
