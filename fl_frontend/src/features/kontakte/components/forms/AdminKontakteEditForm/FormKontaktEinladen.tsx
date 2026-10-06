"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import PaperPlane from "@gravity-ui/icons/PaperPlane";

import { Button } from "@heroui/react/button";

import { einladeKontaktAction } from "@/features/kontakte/actions";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { formButton } from "@/shared/components/ui/formButtons";
import { StepUpRefused } from "@/shared/components/ui/StepUpRefused";
import { useStepUp } from "@/shared/hooks/useStepUp";
import { LINK_ERNEUT_OHNE_ANTWORT } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { benannt } from "@/shared/utils/benannt";
import { pressLinkWrite } from "@/shared/utils/linkWrite";

import type { FLKontaktRolle } from "@/features/bewerbungen/schemas";

/**
 * A fresh link for one stored, unconfirmed seat, on the referee's pattern
 * (`fl_frontend/src/features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/FormBestaetigungSection.tsx`):
 * a seat stored before any link was minted has no other way to one.
 */
export function FormKontaktEinladen({
  teamId,
  saisonId,
  rolle,
  label,
  isDirty,
}: {
  teamId: string;
  saisonId: string;
  rolle: FLKontaktRolle;
  /** The seat's own name, so three controls on one page are three different presses to a screen reader. */
  label: string;
  /** The editor's unsaved typing, which the refreshed page would replace. */
  isDirty: boolean;
}) {
  const router = useRouter();
  const [sendet, setSendet] = useState(false);
  const stepUp = useStepUp();
  // Not „erneut“: a seat stored before links existed never had one, and the page cannot tell which.
  const sendeLabel = benannt("Bestätigungslink senden", label);

  const sende = async () => {
    // Every press mints a bearer link and voids the seat's earlier one.
    const res = await pressLinkWrite({
      isDirty,
      stepUp,
      router,
      pending: setSendet,
      write: () => einladeKontaktAction({ team_id: teamId, saison_id: saisonId, rolle: rolle }),
      repair: LINK_ERNEUT_OHNE_ANTWORT,
    });
    if (res === null) return;

    if (!res.success) {
      appToast.failure("Bestätigungslink nicht gesendet", res);
      return;
    }

    appToast.success("Bestätigungslink gesendet", { description: res.message });
  };

  return (
    <div className="flex w-full flex-col items-start">
      <FocusSlot name={`erneut-${rolle}`}>
        <Button
          type="button"
          isPending={sendet}
          aria-label={sendeLabel}
          onPress={() => void sende()}
          className={`${formButton({ intent: "nav", size: "xs" })} gap-x-2`}>
          <PaperPlane
            className="size-3.5"
            aria-hidden="true"
          />
          <span>{sendet ? stepUp.running("Sendet...") : "Bestätigungslink senden"}</span>
        </Button>
      </FocusSlot>
      <StepUpRefused refused={stepUp.refused} />
    </div>
  );
}
