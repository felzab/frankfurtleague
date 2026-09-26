"use client";

import { SCHIEDSRICHTER_CRUD_COPY } from "@/features/schiedsrichter/constants";
import { CreateModal } from "@/shared/components/ui/CreateModal";

import { AdminCreateSchiedsrichterForm } from "../forms/AdminCreateSchiedsrichterForm";

export function AdminCreateSchiedsrichterModal() {
  return (
    <CreateModal
      label={SCHIEDSRICHTER_CRUD_COPY.createLabel}
      heading="Schiedsrichter anlegen">
      {(close) => <AdminCreateSchiedsrichterForm onClose={close} />}
    </CreateModal>
  );
}
