"use client";

import { useRouter } from "next/navigation";

import TrashBin from "@gravity-ui/icons/TrashBin";

import { deleteSperreAction } from "@/features/sperrliste/actions";
import { SPERRE_AUFHEBEN_CONSEQUENCE } from "@/features/sperrliste/constants";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

/**
 * One row's removal, escalated where the row stands rather than in a dialog:
 * `fl_frontend/src/shared/components/ui/ConfirmDeleteModal.tsx` asks about a retirement in words
 * („stilllegen“) that no ban is, this delete keeping nothing (`docs/frontend/spec.md :: I37`).
 */
export function AdminSperreAufhebenPanel({ sperreId, gesperrtAm }: { sperreId: string; gesperrtAm: string }) {
  const twoPress = useTwoPressConfirm();
  const router = useRouter();
  const { isConfirming, press } = twoPress;

  const handleAufheben = () => {
    press(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await deleteSperreAction({ id: sperreId }).catch(rejectedWrite(router));

      if (!res.success) {
        appToast.failure("Sperre nicht aufgehoben", res);
        return;
      }

      appToast.success("Sperre aufgehoben", { description: res.message });
    });
  };

  return (
    <div className="flex w-full flex-col gap-3">
      {isConfirming && (
        <ConfirmReveal>
          <p className="fluid-xxs text-foreground leading-normal font-medium">{SPERRE_AUFHEBEN_CONSEQUENCE}</p>
        </ConfirmReveal>
      )}

      <ConfirmActionRow confirm={twoPress}>
        {/* The day and never the reason: the reason runs to 500 characters an administrator typed,
            the card prints it directly above this control, and a name quoting it reads it out
            twice — once at rest and once armed. */}
        <ConfirmPressButton
          confirm={twoPress}
          reason={null}
          resting={`Sperre vom ${gesperrtAm} aufheben`}
          armed={`Ja, Sperre vom ${gesperrtAm} endgültig aufheben`}
          running="Hebt auf..."
          icon={
            <TrashBin
              className="size-4.5"
              aria-hidden="true"
            />
          }
          onPress={handleAufheben}
        />
      </ConfirmActionRow>
    </div>
  );
}
