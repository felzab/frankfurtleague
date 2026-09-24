"use client";

import { AdminCreateTeamForm } from "@/features/teams/components/forms/AdminCreateTeamForm";
import { TEAMS_CRUD_COPY } from "@/features/teams/constants";
import { Callout } from "@/shared/components/ui/Callout";
import { CreateModal } from "@/shared/components/ui/CreateModal";

import type { TeamCreateSaisonOption } from "@/features/teams/types";

/**
 * Props rather than a fetch: the trigger renders above the page's data boundary.
 *
 * `saisonOptions` is only the PLANNED seasons — any other would be a create the backend must
 * refuse (`REQ-ENTER-001`).
 */
export function AdminCreateTeamModal({
  saisonOptions,
  defaultSaisonId,
}: {
  saisonOptions: TeamCreateSaisonOption[];
  /** The season preselected in the form — the viewed one when it is planned, else the next planned. */
  defaultSaisonId: string | null;
}) {
  return (
    <CreateModal
      label={TEAMS_CRUD_COPY.createLabel}
      heading="Team anlegen">
      {(close) =>
        saisonOptions.length > 0 && defaultSaisonId !== null ? (
          <AdminCreateTeamForm
            saisonOptions={saisonOptions}
            defaultSaisonId={defaultSaisonId}
            onClose={close}
          />
        ) : (
          <Callout
            severity="info"
            title="Keine geplante Saison">
            Teams können nur in eine geplante Saison aufgenommen werden, und derzeit ist keine angelegt. Lege zuerst die kommende Saison an.
          </Callout>
        )
      }
    </CreateModal>
  );
}
