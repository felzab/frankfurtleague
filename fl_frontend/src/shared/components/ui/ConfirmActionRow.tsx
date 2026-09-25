"use client";

import { Button } from "@heroui/react/button";

import { formButton } from "./formButtons";

import type { TwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import type { ReactNode } from "react";

/**
 * The row a two-press control's buttons stand in, with the cancel that belongs to the armed state.
 * **A column of full-width buttons below `sm`**: an armed label is a sentence, not a word.
 */
export function ConfirmActionRow({
  confirm,
  children,
}: {
  confirm: TwoPressConfirm;
  /** The primary control, whose label, icon and gate are the panel's own. */
  children: ReactNode;
}) {
  // `items-center` waits for `sm` with the row: in a column it would hold `Hint`'s wrapper — and the
  // button inside it — at content width instead of the column's.
  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      {children}
      {/* Armed alone: a standing „Abbrechen“ beside an unarmed control offers to cancel nothing. */}
      {confirm.isConfirming && (
        <Button
          type="button"
          variant="secondary"
          // Held rather than hidden in flight, so the row does not reflow under the pointer mid-press.
          isPending={confirm.isPending}
          onPress={confirm.cancel}
          className={formButton({ intent: "cancel", stacks: true })}>
          Abbrechen
        </Button>
      )}
    </div>
  );
}
