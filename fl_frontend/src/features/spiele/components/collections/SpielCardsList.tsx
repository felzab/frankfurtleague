"use client";

import { useState } from "react";

import SpielDetailsModal from "../modals/SpielDetailsModal";
import SpielCard from "../SpielCard";

import type { FLSpiel } from "../../schemas";

export default function SpielCardsList({
  spiele,
  today,
  onAdminEdit,
}: {
  spiele: FLSpiel[];
  today: string;
  onAdminEdit?: (spiel: FLSpiel) => void;
}) {
  const [selectedSpiel, setSelectedSpiel] = useState<FLSpiel | null>(null);

  return (
    <div className="contents">
      {spiele.map((spielData) => (
        <SpielCard
          key={spielData.id}
          spielData={spielData}
          today={today}
          onOpenInfoModal={() => setSelectedSpiel(spielData)}
          onOpenAdminModal={onAdminEdit ? () => onAdminEdit(spielData) : undefined}
        />
      ))}

      <SpielDetailsModal
        spielData={selectedSpiel}
        today={today}
        isOpen={selectedSpiel !== null}
        onClose={() => setSelectedSpiel(null)}
      />
    </div>
  );
}
