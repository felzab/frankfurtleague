"use client";

import { tv } from "tailwind-variants/lite";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";

import type { Copy } from "@/core/copy";
import type { EditorStatus } from "./useEditor";

/** A save whose change reaches beyond the record, such as the mails a moved match sends, asks this first. */
export type SaveWarning = { subject: Copy; consequence: Copy };

const statusLine = tv({
  base: "line-clamp-2 min-w-0 flex-1 text-sm",
  variants: {
    tone: {
      none: "",
      changes: "text-fg",
      saved: "text-success",
      error: "text-danger",
    },
  },
});

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
  status: EditorStatus;
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
    <div className="sticky bottom-0 z-10 flex h-14 items-center gap-4 border-t border-border bg-bg px-4 lg:h-auto lg:px-8 lg:py-3">
      <p className={statusLine({ tone: status?.tone ?? "none" })}>{status?.text}</p>
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
