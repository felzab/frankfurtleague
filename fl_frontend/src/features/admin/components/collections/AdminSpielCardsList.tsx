"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

import SpielCardsList from "@/features/spiele/components/collections/SpielCardsList";

import { useAdmin } from "../providers/AdminContextProvider";

import type { FLSpiel } from "@/features/spiele/schemas";

const AdminEditSpielDataModal = dynamic(() => import("@/features/spiele/components/modals/AdminEditSpielDataModal"), { ssr: false });

export default function AdminSpielCardsList({ spiele, today }: { spiele: FLSpiel[]; today: string }) {
  const [selectedAdminSpiel, setSelectedAdminSpiel] = useState<FLSpiel | null>(null);

  // Read here rather than inside the form: the lists are admin's to aggregate, and the form lives
  // in `spiele`, which must not depend on `admin`.
  const { teams, spielorte, schiedsrichter } = useAdmin();

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
          teams={teams}
          spielorte={spielorte}
          schiedsrichter={schiedsrichter}
          isOpen={selectedAdminSpiel !== null}
          onClose={() => setSelectedAdminSpiel(null)}
        />
      )}
    </div>
  );
}
