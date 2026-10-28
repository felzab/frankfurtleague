import { SectionTitle } from "./Section";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

/**
 * A few of a dialog's fields under one short name, the address's lines and then the record's terms, as
 * GitHub Primer's Subhead parts a form: the name, the section title an editor's box carries, then 8 px under
 * it a hairline running the dialog's full width out to both its edges, then 16 px before the fields (the
 * Subhead's condensed padding and normal gap). Above the name stands the dialog's own 16-px gap after the
 * field before, whose message line reserves 16 px more, so the name sits nearer its fields than the ones
 * above it. A `fieldset` with its `legend`, the heading inside the legend as GOV.UK's fieldset takes it, so a
 * screen reader says the group's name with each field and lists it among the dialog's headings, a step
 * under its title.
 */
export function FieldGroup({ name, children }: { name: Copy; children: ReactNode }) {
  return (
    // `min-w-0`: a fieldset is at least as wide as its content by default, which would push a row of fields past the dialog.
    <fieldset className="grid w-full min-w-0 justify-items-start gap-4">
      {/* A legend is drawn outside its box's flow; floated, it is an ordinary child (Bootstrap's reboot), so the grid
          lays it out. Stretched out through the dialog's 24-px padding, its hairline meets both of the dialog's edges,
          the name kept at the fields' edge by the same padding inside it. */}
      <legend className="float-left -mx-6 justify-self-stretch border-b border-border px-6 pb-2">
        <SectionTitle
          level={3}
          text={name}
        />
      </legend>
      {children}
    </fieldset>
  );
}
