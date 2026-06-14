"use client";

import { useState } from "react";
import type { FLSpiel } from "@/features/spiele/types";
import SpielCardsList from "@/features/spiele/components/collections/SpielCardsList";
import dynamic from "next/dynamic";

const AdminEditSpielDataModal = dynamic(() => import("../modals/AdminEditSpielDataModal"), { ssr: false });

export default function AdminSpielCardsList({ spiele }: { spiele: FLSpiel[] }) {
  const [selectedAdminSpiel, setSelectedAdminSpiel] = useState<FLSpiel | null>(null);

  return (
    <div className="contents">
      <SpielCardsList
        spiele={spiele}
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
