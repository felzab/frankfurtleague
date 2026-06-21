"use client";

import { useState } from "react";

import SpielDetailsModal from "../modals/SpielDetailsModal";
import SpielCard from "../SpielCard";

import type { FLSpiel } from "../../schemas";

export default function SpielCardsList({ spiele, onAdminEdit }: { spiele: FLSpiel[]; onAdminEdit?: (spiel: FLSpiel) => void }) {
  const [selectedSpiel, setSelectedSpiel] = useState<FLSpiel | null>(null);

  return (
    <div className="contents">
      {spiele.map((spielData) => (
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
