"use client";

import { useState } from "react";
import type { FLSpiel, FLSpielWithChipData } from "../../types";
import SpielCard from "../SpielCard";
import SpielDetailsModal from "../modals/SpielDetailsModal";
import { computeSpielPhase, computeSpielStatus } from "../../utils";
import { useServerConfig } from "@/core/providers/ServerConfigProvider";

export default function SpielCardsList({ spiele, onAdminEdit }: { spiele: FLSpiel[]; onAdminEdit?: (spiel: FLSpiel) => void }) {
  const { today } = useServerConfig();
  const spieleWithChipData: FLSpielWithChipData[] = spiele.map((spielData) => ({
    ...spielData,
    status: computeSpielStatus({ datum: spielData.datum, isCanceled: spielData.is_canceled, today: today }),
    phase: computeSpielPhase(spielData.spiel_nr),
  }));
  const [selectedSpiel, setSelectedSpiel] = useState<FLSpielWithChipData | null>(null);

  return (
    <div className="contents">
      {spieleWithChipData.map((spielData) => (
        <SpielCard
          key={spielData.spiel_nr}
          spielData={spielData}
          onOpenInfoModal={() => setSelectedSpiel(spielData)}
          onOpenAdminModal={onAdminEdit ? () => onAdminEdit(spielData) : undefined}
        />
      ))}

      <SpielDetailsModal
        spielData={selectedSpiel}
        isOpen={selectedSpiel !== null}
        onClose={() => setSelectedSpiel(null)}
      />
    </div>
  );
}
