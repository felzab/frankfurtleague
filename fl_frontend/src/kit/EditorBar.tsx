"use client";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { StatusLine } from "./FieldParts";

import type { Copy } from "@/core/copy";
import type { FormStatus } from "./useFormAction";

/** A save whose change reaches beyond the record, such as the mails a moved match sends, asks this first. */
export type SaveWarning = { subject: Copy; consequence: Copy };

/**
 * The editor's one save: a bar at the bottom of the viewport, from the rail's separator to the edge, holding
 * the status line that is always there and „Speichern“, never disabled; on a phone it stands where the
 * bottom bar stood. A save with a consequence beyond the record asks first, naming it.
 */
export function EditorBar({
  status,
  isPending,
  warning,
  onSave,
}: {
  status: FormStatus;
  isPending: boolean;
  /** The question a save of the present changes asks first, or `null` where it asks none. */
  warning: SaveWarning | null;
  onSave: () => void;
}) {
  const save = (onPress?: () => void) => (
    <Button
      variant="primary"
      label={COPY.shared.verb.speichern}
      isBusy={isPending}
      onPress={onPress}
    />
  );
  return (
    // On desktop as tall as the rail's foot beside it (`--rail-foot`, set by the rail frame), so the two top
    // hairlines are one line.
    <div className="sticky bottom-0 z-10 flex h-14 items-center gap-4 border-t border-border bg-bg px-4 lg:h-(--rail-foot) lg:px-8">
      <StatusLine
        status={status}
        placement="row"
      />
      {warning === null ? (
        save(onSave)
      ) : (
        <ConfirmDialog
          verb="speichern"
          subject={warning.subject}
          consequence={warning.consequence}
          tone="primary"
          trigger={save()}
          onConfirm={onSave}
        />
      )}
    </div>
  );
}
