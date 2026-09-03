"use client";

import { useTransition } from "react";

import { reactivateSpielortAction } from "@/features/spielorte/actions";
import { AdminSpielortEditForm } from "@/features/spielorte/components/forms/AdminSpielortEditForm/AdminSpielortEditForm";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { RetiredBadge } from "@/shared/components/ui/RetiredBadge";
import { appToast } from "@/shared/utils/appToast";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

import type { FLAddress } from "@/shared/schemas";

/**
 * Retiring is the list's dialog; reactivating is here, a fact about the row rather than a value the
 * save bar commits.
 */
export function AdminSpielortEditView({
  spielort,
  inactiveSince,
}: {
  spielort: { id: string; name: string; address: FLAddress; default_mietpreis: number };
  /** The day this venue was retired, or `null` while it is in use — on no field of the form. */
  inactiveSince: string | null;
}) {
  const [isReactivating, startReactivating] = useTransition();

  const isRetired = inactiveSince !== null;

  const handleReactivate = () => {
    startReactivating(async () => {
      const res = await reactivateSpielortAction({ id: spielort.id });
      if (res.success) appToast.success(res.message ?? "Spielort reaktiviert");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error ?? UNKNOWN_REFUSAL });
    });
  };

  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSpielortEditForm
        spielort={spielort}
        isRetired={isRetired}
        pageHeader={{
          title: spielort.name,
          // The retirement date, which the rail's banner states as a state and never as a day.
          chip: isRetired ? <RetiredBadge since={inactiveSince} /> : undefined,
          reactivate: isRetired ? { isPending: isReactivating, onPress: handleReactivate } : undefined,
        }}
      />
    </div>
  );
}
