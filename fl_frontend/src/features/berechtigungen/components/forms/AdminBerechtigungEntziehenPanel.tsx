"use client";

import { useRouter } from "next/navigation";

import TrashBin from "@gravity-ui/icons/TrashBin";

import { deleteBerechtigungAction } from "@/features/berechtigungen/actions";
import { entziehenLabels, NUR_INHABER_ENTZIEHT, ZUGANG_ENTZIEHEN_CONSEQUENCE } from "@/features/berechtigungen/constants";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

/**
 * One grant's revoke, escalated where the row stands, as the ban list's removal is: a revoke keeps
 * nothing to restore, which `ConfirmDeleteModal`'s retirement wording would promise. Closed, with its
 * reason, to an administrator holding no `owner` grant.
 */
export function AdminBerechtigungEntziehenPanel({
  berechtigungId,
  adresse,
  erteiltAm,
  darfEntziehen,
}: {
  berechtigungId: string;
  /** `null` where the address is withheld, the grant's day then naming the row. */
  adresse: string | null;
  erteiltAm: string;
  darfEntziehen: boolean;
}) {
  const { resting, armed } = entziehenLabels(adresse, erteiltAm);
  // The enrolment's window, as the action's: the prompt asks before a press the server would refuse.
  const twoPress = useTwoPressConfirm({ stepUp: "enrolment" });
  const router = useRouter();
  const { isConfirming, press } = twoPress;

  const handleEntziehen = () => {
    press(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await deleteBerechtigungAction({ id: berechtigungId }).catch(rejectedWrite(router));

      if (!res.success) {
        appToast.failure("Zugang nicht entzogen", res);
        return;
      }

      appToast.success("Zugang entzogen", { description: res.message });
    });
  };

  return (
    <div className="flex w-full flex-col gap-3">
      {isConfirming && (
        <ConfirmReveal>
          <p className="fluid-xxs leading-normal font-medium text-foreground">{ZUGANG_ENTZIEHEN_CONSEQUENCE}</p>
        </ConfirmReveal>
      )}

      <ConfirmActionRow confirm={twoPress}>
        {/* Named by its row, so each control in the list is one a screen reader can tell from the next. */}
        <ConfirmPressButton
          confirm={twoPress}
          reason={darfEntziehen ? null : NUR_INHABER_ENTZIEHT}
          resting={resting}
          armed={armed}
          running="Entzieht..."
          icon={
            <TrashBin
              className="size-4.5"
              aria-hidden="true"
            />
          }
          onPress={handleEntziehen}
        />
      </ConfirmActionRow>
    </div>
  );
}
