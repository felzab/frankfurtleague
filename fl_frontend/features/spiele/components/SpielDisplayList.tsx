"use client";

import { useState } from "react";
import type { FLSpiel } from "../types";
import SpielDisplay from "./SpielDisplay";
import SpielinfoModal from "./SpielinfoModal";

export default function SpielDisplayList({
  spiele,
  today,
  adminMode = false,
  onAdminEdit,
}: {
  spiele: FLSpiel[];
  today: string;
  adminMode?: boolean;
  onAdminEdit?: (spiel: FLSpiel) => void;
}) {
  const [selectedSpiel, setSelectedSpiel] = useState<FLSpiel | null>(null);

  return (
    <div className="contents">
      {spiele.map((spiel) => (
        <SpielDisplay
          key={spiel.spiel_nr}
          spielData={spiel}
          onOpenInfoModal={() => setSelectedSpiel(spiel)}
          onOpenAdminModal={() => onAdminEdit?.(spiel)}
          adminMode={!!onAdminEdit}
        />
      ))}

      <SpielinfoModal
        spielData={selectedSpiel}
        today={today}
        isOpen={selectedSpiel !== null}
        onClose={() => setSelectedSpiel(null)}
      />
    </div>
  );
}
