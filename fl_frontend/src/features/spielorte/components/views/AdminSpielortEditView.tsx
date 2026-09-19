"use client";

import { reactivateSpielortAction } from "@/features/spielorte/actions";
import { AdminSpielortEditForm } from "@/features/spielorte/components/forms/AdminSpielortEditForm/AdminSpielortEditForm";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { RetiredBadge } from "@/shared/components/ui/RetiredBadge";
/**
 * Retiring is the list's dialog; reactivating is here, a fact about the row rather than a value the
 * save bar commits.
 */
import { useReactivation } from "@/shared/hooks/useReactivation";

import type { FLAddress } from "@/shared/schemas";

export function AdminSpielortEditView({
  spielort,
  inactiveSince,
}: {
  spielort: { id: string; name: string; address: FLAddress; default_mietpreis: number };
  /** The day this venue was retired, or `null` while it is in use — on no field of the form. */
  inactiveSince: string | null;
}) {
  const { isReactivating, reactivate } = useReactivation({ action: reactivateSpielortAction, noun: "Spielort" });

  const isRetired = inactiveSince !== null;

  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSpielortEditForm
        spielort={spielort}
        isRetired={isRetired}
        pageHeader={{
          title: spielort.name,
          // The retirement date, which the rail's banner states as a state and never as a day.
          chip: isRetired ? <RetiredBadge since={inactiveSince} /> : undefined,
          reactivate: isRetired ? { isPending: isReactivating, onPress: () => reactivate({ id: spielort.id }) } : undefined,
        }}
      />
    </div>
  );
}
