"use client";

import { useState } from "react";
import type { FLSpiel, FLSpielWithChipData } from "../types";
import SpielDisplay from "./SpielDisplay";
import SpielinfoModal from "./SpielinfoModal";
import { computeSpielPhase, computeSpielStatus } from "../utils";

export default function SpielDisplayList({
  spiele,
  today,
  onAdminEdit,
}: {
  spiele: FLSpiel[];
  today: string;
  onAdminEdit?: (spiel: FLSpiel) => void;
}) {
  const spieleWithChipData: FLSpielWithChipData[] = spiele.map((spielData) => ({
    ...spielData,
    status: computeSpielStatus({ datum: spielData.datum, isCanceled: spielData.is_canceled, today: today }),
    phase: computeSpielPhase(spielData.spiel_nr),
  }));
  const [selectedSpiel, setSelectedSpiel] = useState<FLSpielWithChipData | null>(null);

  return (
    <div className="contents">
      {spieleWithChipData.map((spielData) => (
        <SpielDisplay
          key={spielData.spiel_nr}
          spielData={spielData}
          onOpenInfoModal={() => setSelectedSpiel(spielData)}
          onOpenAdminModal={() => onAdminEdit?.(spielData)}
          adminMode={!!onAdminEdit}
        />
      ))}

      <SpielinfoModal
        spielData={selectedSpiel}
        isOpen={selectedSpiel !== null}
        onClose={() => setSelectedSpiel(null)}
      />
    </div>
  );
}
