"use client";

import { SPIELORTE_CRUD_COPY } from "@/features/spielorte/constants";
import { CreateModal } from "@/shared/components/ui/CreateModal";

import { AdminCreateSpielortForm } from "../forms/AdminCreateSpielortForm";

export function AdminCreateSpielortModal() {
  return (
    <CreateModal
      label={SPIELORTE_CRUD_COPY.createLabel}
      heading="Spielort anlegen">
      {(close) => <AdminCreateSpielortForm onClose={close} />}
    </CreateModal>
  );
}
