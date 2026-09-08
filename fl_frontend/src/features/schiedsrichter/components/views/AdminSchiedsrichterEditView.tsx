"use client";

import { useTransition } from "react";

import { reactivateSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { AdminSchiedsrichterEditForm } from "@/features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/AdminSchiedsrichterEditForm";
import { AdminSchiedsrichterGeloeschtView } from "@/features/schiedsrichter/components/views/AdminSchiedsrichterGeloeschtView";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { RetiredBadge } from "@/shared/components/ui/RetiredBadge";
import { appToast } from "@/shared/utils/appToast";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

import type { FLKontakt } from "@/shared/schemas";

/**
 * Retiring is the referee list's own dialog; reactivating is here, a fact about the row rather than
 * a value the save bar commits, and it writes immediately through its own endpoint.
 */
export function AdminSchiedsrichterEditView({
  schiedsrichter,
  inactiveSince,
  anonymisiertAm,
}: {
  schiedsrichter: { id: string; name: string | null; schule: string | null; kontakt: FLKontakt; default_payment: number };
  /** The day this referee was retired, or `null` while they officiate — on no field of the form. */
  inactiveSince: string | null;
  /** The day their data were erased, or `null`. An erased row takes no save, so it takes no form either. */
  anonymisiertAm: string | null;
}) {
  const [isReactivating, startReactivating] = useTransition();

  const isRetired = inactiveSince !== null;
  const { name } = schiedsrichter;

  const handleReactivate = () => {
    startReactivating(async () => {
      const res = await reactivateSchiedsrichterAction({ id: schiedsrichter.id });
      if (res.success) appToast.success(res.message ?? "Schiedsrichter reaktiviert");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error ?? UNKNOWN_REFUSAL });
    });
  };

  // The stamp decides, and the nulled name is checked beside it so the form below receives a `string`:
  // the two move together, the erasure writing both in one `$set`.
  if (anonymisiertAm !== null || name === null) {
    return (
      <AdminSchiedsrichterGeloeschtView
        anonymisiertAm={anonymisiertAm}
        inactiveSince={inactiveSince}
        schule={schiedsrichter.schule}
        defaultPayment={schiedsrichter.default_payment}
      />
    );
  }

  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSchiedsrichterEditForm
        schiedsrichter={{ ...schiedsrichter, name }}
        isRetired={isRetired}
        pageHeader={{
          title: name,
          // The retirement date, which the rail's banner states as a state and never as a day.
          chip: isRetired ? <RetiredBadge since={inactiveSince} /> : undefined,
          reactivate: isRetired ? { isPending: isReactivating, onPress: handleReactivate } : undefined,
        }}
      />
    </div>
  );
}
