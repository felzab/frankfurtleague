"use client";

import { AdminCreateSaisonForm } from "@/features/saisons/components/forms/AdminCreateSaisonForm";
import { SAISONS_CRUD_COPY } from "@/features/saisons/constants";
import { CreateModal } from "@/shared/components/ui/CreateModal";

/**
 * Takes no data: a season has nothing to be entered into, so this trigger renders immediately with no
 * `Suspense` boundary and no fallback to reserve its height.
 */
export function AdminCreateSaisonModal() {
  return (
    <CreateModal
      label={SAISONS_CRUD_COPY.createLabel}
      heading="Saison anlegen">
      {(close) => <AdminCreateSaisonForm onClose={close} />}
    </CreateModal>
  );
}
