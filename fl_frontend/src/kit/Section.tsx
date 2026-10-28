import { tv } from "tailwind-variants/lite";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { HelpPopover } from "./HelpPopover";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { ConfirmDialogProps } from "./ConfirmDialog";

/**
 * An irreversible or retiring act, which stands as one row in an editor's last box: its name and its
 * consequence at the left, its button at the right, which asks before it acts.
 */
export type DangerAct = {
  name: Copy;
  consequence: Copy;
  /** The question its button opens; the button carries the question's verb and tone. */
  confirm: Omit<ConfirmDialogProps, "trigger">;
};

function DangerRow({ act }: { act: DangerAct }) {
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_45%,var(--border))] px-4 py-2 lg:min-h-13">
      <div className="grid min-w-0 flex-1 text-sm">
        <span className="font-semibold">{act.name}</span>
        <span className="text-xs text-fg-muted">{act.consequence}</span>
      </div>
      <ConfirmDialog
        {...act.confirm}
        trigger={
          <Button
            variant={act.confirm.tone}
            label={COPY.shared.verb[act.confirm.verb]}
          />
        }
      />
    </div>
  );
}

/**
 * A section's title, 16 px semibold, one step under the page's: an editor's or a Konto page's box, a read
 * page's group, the filter sheet, and a dialog's group of fields, one level under the dialog's own title.
 */
export function SectionTitle({ text, level = 2 }: { text: Copy; level?: 2 | 3 }) {
  const Heading = level === 2 ? "h2" : "h3";
  return <Heading className="text-base font-semibold">{text}</Heading>;
}

/**
 * The rung a few entries or fields are named on, 12 px medium muted, a step under a section's title: the
 * rail's groups and the phone sheet's, a dialog's groups of fields. Each place adds its own spacing.
 */
export const groupHeading = tv({ base: "text-xs font-medium text-fg-muted" });

/**
 * A form's or a settings page's group of fields: a box exactly as tall as its content under its 16-px
 * title, a one-control section included. One ⓘ may follow the title. An editor's last box holds the
 * danger rows, the one place its irreversible and retiring acts stand.
 */
export function Section({
  title,
  help,
  danger,
  children,
}: {
  title: Copy;
  /** The section's one short help text, behind the ⓘ after its title. */
  help?: Copy;
  /** An editor's irreversible and retiring acts, one row each, after the box's fields. */
  danger?: ReadonlyArray<DangerAct>;
  children?: ReactNode;
}) {
  return (
    <section className="grid gap-4 rounded-lg border border-border bg-bg p-4">
      {/* The ⓘ stands beside the heading, not in it, so the heading is named by its title alone. */}
      <div className="flex items-center gap-2">
        <SectionTitle text={title} />
        {help !== undefined && (
          <HelpPopover
            subject={title}
            text={help}
          />
        )}
      </div>
      {/* Each child at its own width: a field fills the column itself, a button among the fields keeps its. 8 px
          apart, each field's message line, always there, holding the rest of the space between two fields. */}
      {children !== undefined && <div className="grid justify-items-start gap-2">{children}</div>}
      {danger?.map((act) => (
        <DangerRow
          key={act.name}
          act={act}
        />
      ))}
    </section>
  );
}
