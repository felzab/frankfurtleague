"use client";

import ArrowRightFromSquare from "@gravity-ui/icons/ArrowRightFromSquare";

import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";

/**
 * „Alle anderen abmelden“, two presses because it ends every device but this one at once. Its own
 * component so its armed state is its own (`docs/frontend/spec.md :: I66`), beside the cards' rows.
 */
export function AndereAbmelden({ onEnd }: { onEnd: () => Promise<void> }) {
  const twoPress = useTwoPressConfirm();

  return (
    <div className="flex flex-col gap-3">
      {twoPress.isConfirming && (
        <ConfirmReveal>
          <p className="fluid-sm text-pretty text-foreground">Alle anderen Anmeldungen werden beendet.</p>
        </ConfirmReveal>
      )}
      <ConfirmActionRow confirm={twoPress}>
        <ConfirmPressButton
          confirm={twoPress}
          reason={null}
          resting="Alle anderen abmelden"
          armed="Ja, alle anderen abmelden"
          running="Meldet ab..."
          icon={
            <ArrowRightFromSquare
              aria-hidden="true"
              className="size-4.5 shrink-0"
            />
          }
          onPress={() => twoPress.press(onEnd)}
        />
      </ConfirmActionRow>
    </div>
  );
}
