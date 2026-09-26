"use client";

import { SPERRLISTE_CRUD_COPY } from "@/features/sperrliste/constants";
import { CreateModal } from "@/shared/components/ui/CreateModal";

import { AdminCreateSperreForm } from "../forms/AdminCreateSperreForm";

export function AdminCreateSperreModal() {
  return (
    <CreateModal
      label={SPERRLISTE_CRUD_COPY.createLabel}
      heading="Adresse sperren">
      {(close) => <AdminCreateSperreForm onClose={close} />}
    </CreateModal>
  );
}
