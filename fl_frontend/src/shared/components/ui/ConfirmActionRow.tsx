"use client";

import { Button } from "@heroui/react";

import { formButton } from "./formButtons";

import type { ReactNode } from "react";

/** The row a two-press control's buttons stand in, with the cancel that belongs to the armed state. */
export function ConfirmActionRow({
  isConfirming,
  isPending,
  onCancel,
  children,
}: {
  /** Renders the cancel. A standing „Abbrechen“ beside an unarmed control offers to cancel nothing. */
  isConfirming: boolean;
  /** Closes the cancel rather than hiding it, so the row does not reflow under the pointer mid-press. */
  isPending: boolean;
  onCancel: () => void;
  /** The primary control, whose label, icon and gate are the panel's own. */
  children: ReactNode;
}) {
  return (
    <div className="flex w-full flex-row flex-wrap items-center gap-3">
      {children}
      {isConfirming && (
        <Button
          type="button"
          variant="secondary"
          isDisabled={isPending}
          onPress={onCancel}
          className={formButton({ intent: "cancel" })}>
          Abbrechen
        </Button>
      )}
    </div>
  );
}
