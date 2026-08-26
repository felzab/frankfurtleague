"use client";

import { useTransition } from "react";

import { reactivateSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { AdminSchiedsrichterEditForm } from "@/features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/AdminSchiedsrichterEditForm";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

import type { FLKontakt } from "@/shared/schemas";

/**
 * Retiring is the referee list's own dialog; reactivating is here, a fact about the row rather than
 * a value the save bar commits, and it writes immediately through its own endpoint.
 */
export function AdminSchiedsrichterEditView({
  schiedsrichter,
  inactiveSince,
}: {
  schiedsrichter: { id: string; name: string; schule: string | null; kontakt: FLKontakt; default_payment: number };
  /** The day this referee was retired, or `null` while they officiate — on no field of the form. */
  inactiveSince: string | null;
}) {
  const [isReactivating, startReactivating] = useTransition();

  const isRetired = inactiveSince !== null;

  const handleReactivate = () => {
    startReactivating(async () => {
      const res = await reactivateSchiedsrichterAction({ id: schiedsrichter.id });
      if (res.success) appToast.success(res.message ?? "Schiedsrichter reaktiviert.");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error ?? UNKNOWN_REFUSAL });
    });
  };

  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSchiedsrichterEditForm
        schiedsrichter={schiedsrichter}
        isRetired={isRetired}
        pageHeader={{
          title: schiedsrichter.name,
          // The retirement date, which the rail's banner states as a state and never as a day.
          chip: isRetired ? (
            <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Stillgelegt seit {formatSpielDatum(inactiveSince)}</span>
          ) : undefined,
          reactivate: isRetired ? { isPending: isReactivating, onPress: handleReactivate } : undefined,
        }}
      />
    </div>
  );
}
