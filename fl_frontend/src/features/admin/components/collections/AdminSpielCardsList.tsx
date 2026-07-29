"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

import SpielCardsList from "@/features/spiele/components/collections/SpielCardsList";

import type { FLSpiel } from "@/features/spiele/schemas";

const AdminEditSpielDataModal = dynamic(() => import("../modals/AdminEditSpielDataModal"), { ssr: false });

export default function AdminSpielCardsList({ spiele, today }: { spiele: FLSpiel[]; today: string }) {
  const [selectedAdminSpiel, setSelectedAdminSpiel] = useState<FLSpiel | null>(null);

  return (
    <div className="contents">
      <SpielCardsList
        spiele={spiele}
        today={today}
        onAdminEdit={(spiel) => setSelectedAdminSpiel(spiel)}
      />

      {selectedAdminSpiel && (
        <AdminEditSpielDataModal
          spielData={selectedAdminSpiel}
          isOpen={selectedAdminSpiel !== null}
          onClose={() => setSelectedAdminSpiel(null)}
        />
      )}
    </div>
  );
}
