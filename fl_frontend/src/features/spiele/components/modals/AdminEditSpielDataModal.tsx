"use client";

import { FormModal } from "@/shared/components/ui/FormModal";

import AdminEditSpielDataForm from "../forms/AdminEditSpielDataForm/AdminEditSpielDataForm";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";
import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLSpielort } from "@/features/spielorte/schemas";
import type { FLTeam } from "@/features/teams/schemas";

export default function AdminEditSpielDataModal({
  spielData,
  teams,
  spielorte,
  schiedsrichter,
  isOpen,
  onClose,
}: {
  spielData: FLSpiel | null;
  teams: FLTeam[];
  spielorte: FLSpielort[];
  schiedsrichter: FLSchiedsrichter[];
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!spielData) return null;

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Spielinformationen bearbeiten">
      <AdminEditSpielDataForm
        key={spielData.id}
        spielData={spielData}
        teams={teams}
        spielorte={spielorte}
        schiedsrichter={schiedsrichter}
        onClose={onClose}
      />
    </FormModal>
  );
}
