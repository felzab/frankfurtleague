"use client";

import { useState } from "react";

import { reactivateSpielortAction } from "@/features/spielorte/actions";
import { AdminSpielortEditForm } from "@/features/spielorte/components/forms/AdminSpielortEditForm/AdminSpielortEditForm";
import { AdminDeleteSpielortModal } from "@/features/spielorte/components/modals/AdminDeleteSpielortModal";
import { PAGE_RISE_CLASSES } from "@/shared/components/ui/motion";
import { RetiredBadge } from "@/shared/components/ui/RetiredBadge";
import { useReactivation } from "@/shared/hooks/useReactivation";
import { focusAfterWrite } from "@/shared/utils/focusAfterWrite";

import type { FLAddress } from "@/shared/schemas";

/**
 * Retiring and reactivating are facts about the row rather than values the save bar commits, each writing through its
 * own endpoint: retiring through the venue list's own dialog.
 */
export function AdminSpielortEditView({
  spielort,
  inactiveSince,
}: {
  spielort: { id: string; name: string; address: FLAddress; default_mietpreis: number };
  /** The day this venue was retired, or `null` while it is in use — on no field of the form. */
  inactiveSince: string | null;
}) {
  const { isReactivating, reactivate } = useReactivation({ action: reactivateSpielortAction, noun: "Spielort" });
  // The landing read as the dialog opens, which takes the focus off the pressed control.
  const [retiring, setRetiring] = useState<{ landed: () => void } | null>(null);

  const isRetired = inactiveSince !== null;

  return (
    <div className={`${PAGE_RISE_CLASSES} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSpielortEditForm
        spielort={spielort}
        isRetired={isRetired}
        pageHeader={{
          title: spielort.name,
          // The retirement date, which the rail's banner states as a state and never as a day.
          chip: isRetired ? <RetiredBadge since={inactiveSince} /> : undefined,
          stilllegung: {
            isRetired,
            reactivate: { isPending: isReactivating, onPress: () => reactivate({ id: spielort.id }) },
            retire: { onPress: (pressed) => setRetiring(focusAfterWrite(pressed)) },
          },
        }}
      />
      <AdminDeleteSpielortModal
        ortData={spielort}
        isOpen={retiring !== null}
        onClose={() => setRetiring(null)}
        onRetired={() => retiring?.landed()}
      />
    </div>
  );
}
