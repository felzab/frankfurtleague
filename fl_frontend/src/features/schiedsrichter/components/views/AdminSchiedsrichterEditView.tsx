"use client";

import { reactivateSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { AdminSchiedsrichterEditForm } from "@/features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/AdminSchiedsrichterEditForm";
import { SCHIEDSRICHTER_OHNE_NAMEN_LABEL } from "@/features/schiedsrichter/constants";
import { returnMayMint } from "@/features/schiedsrichter/linkMint";
import { Leer } from "@/shared/components/ui/Angabe";
import { PAGE_RISE_CLASSES } from "@/shared/components/ui/motion";
import { RetiredBadge } from "@/shared/components/ui/RetiredBadge";
import { useReactivation } from "@/shared/hooks/useReactivation";

import type { ComponentProps } from "react";

/**
 * Retiring is the referee list's own dialog; reactivating is here, a fact about the row rather than
 * a value the save bar commits, and it writes immediately through its own endpoint.
 */
export function AdminSchiedsrichterEditView({
  schiedsrichter,
  istFassungBekannt,
  inactiveSince,
}: {
  // Taken off the form rather than restated: this view adds nothing to the record and a second
  // spelling is one the form's next field would leave behind.
  schiedsrichter: ComponentProps<typeof AdminSchiedsrichterEditForm>["schiedsrichter"];
  /** Whether the registry holds the stored label. */
  istFassungBekannt: boolean | null;
  /** The day this referee was retired, or `null` while they officiate — on no field of the form. */
  inactiveSince: string | null;
}) {
  const { isReactivating, isPrompting, reactivate } = useReactivation({ action: reactivateSchiedsrichterAction, noun: "Schiedsrichter" });

  const isRetired = inactiveSince !== null;
  const { name } = schiedsrichter;

  return (
    <div className={`${PAGE_RISE_CLASSES} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSchiedsrichterEditForm
        schiedsrichter={schiedsrichter}
        istFassungBekannt={istFassungBekannt}
        isRetired={isRetired}
        pageHeader={{
          // The list's word for the same row, so one state is not two phrases across two surfaces.
          title: name ?? <Leer>{SCHIEDSRICHTER_OHNE_NAMEN_LABEL}</Leer>,
          // The retirement date, which the rail's banner states as a state and never as a day.
          chip: isRetired ? <RetiredBadge since={inactiveSince} /> : undefined,
          reactivate: isRetired
            ? {
                isPending: isReactivating,
                isPrompting,
                // A return that mints the referee a link is a step-up write.
                onPress: () => reactivate({ id: schiedsrichter.id }, { stepUp: returnMayMint(schiedsrichter) }),
              }
            : undefined,
        }}
      />
    </div>
  );
}
