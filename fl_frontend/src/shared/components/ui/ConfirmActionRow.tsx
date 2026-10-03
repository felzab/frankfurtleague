"use client";

import { useEffect, useRef } from "react";

import { Button } from "@heroui/react/button";

import { CONFIRM_PRESS_MARK } from "./ConfirmPressButton";
import { formButton } from "./formButtons";
import { StepUpRefused } from "./StepUpRefused";

import type { TwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import type { ReactNode, RefObject } from "react";

/**
 * The row a two-press control's buttons stand in, with the cancel that belongs to the armed state.
 * **A column of full-width buttons below `sm`**: an armed label is a sentence, not a word.
 */
export function ConfirmActionRow({
  confirm,
  armedBy,
  children,
}: {
  confirm: TwoPressConfirm;
  /** The control that arms the row where it is not the shared one; a cancel hands the focus back to it. */
  armedBy?: RefObject<HTMLElement | null>;
  /** The primary control, whose label, icon and gate are the panel's own. */
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Set by the cancel's press alone: `confirm.cancel` is also a surface's blur or outside-press
  // escape, which must not pull the focus back to the control it left.
  const abgebrochen = useRef(false);

  useEffect(() => {
    // An arming control the armed state hides unmounts under the caret that pressed it; the cancel
    // takes the focus rather than the page, and never the armed press, which a stray Enter would send.
    if (confirm.isConfirming) {
      if (document.activeElement === null || document.activeElement === document.body) cancelRef.current?.focus();
      return;
    }
    if (!abgebrochen.current) return;
    abgebrochen.current = false;

    // The cancel unmounts with the armed state, so the control that armed takes the focus back, or the
    // refusal laid over it where one now closes it.
    const row = rowRef.current;
    const armer = armedBy?.current ?? row?.querySelector<HTMLElement>(`[${CONFIRM_PRESS_MARK}]`) ?? null;
    if (armer !== null && armer.closest("[inert]") === null) {
      armer.focus();
      return;
    }
    const stops = row?.querySelectorAll<HTMLElement>("button, [tabindex]") ?? [];
    [...stops].find((stop) => stop.closest("[inert]") === null)?.focus();
  }, [confirm.isConfirming, armedBy]);

  // `items-center` waits for `sm` with the row: in a column it would hold `Hint`'s wrapper — and the
  // button inside it — at content width instead of the column's.
  return (
    <div
      ref={rowRef}
      className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      {children}
      {/* Armed alone: a standing „Abbrechen“ beside an unarmed control offers to cancel nothing. */}
      {confirm.isConfirming && (
        <Button
          ref={cancelRef}
          type="button"
          variant="secondary"
          // Held rather than hidden in flight, so the row does not reflow under the pointer mid-press.
          isPending={confirm.isPending}
          onPress={() => {
            abgebrochen.current = true;
            confirm.cancel();
          }}
          className={formButton({ intent: "cancel", stacks: true })}>
          Abbrechen
        </Button>
      )}
      <StepUpRefused refused={confirm.passkeyRefused} />
    </div>
  );
}
