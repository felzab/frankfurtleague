"use client";

import { BERECHTIGUNGEN_CRUD_COPY } from "@/features/berechtigungen/constants";
import { CreateModal } from "@/shared/components/ui/CreateModal";

import { AdminCreateBerechtigungForm } from "../forms/AdminCreateBerechtigungForm";

export function AdminCreateBerechtigungModal() {
  return (
    <CreateModal
      label={BERECHTIGUNGEN_CRUD_COPY.createLabel}
      heading={BERECHTIGUNGEN_CRUD_COPY.createLabel}>
      {(close) => <AdminCreateBerechtigungForm onClose={close} />}
    </CreateModal>
  );
}
