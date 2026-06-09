"use client";

import { useState } from "react";
import type { FLSpiel } from "@/features/spiele/types";
import SpielDisplayList from "@/features/spiele/components/SpielDisplayList";
import AdminEditGameDataModal from "./AdminEditSpielDataModal";

export default function AdminSpielDisplaylist({ spiele, today }: { spiele: FLSpiel[]; today: string }) {
  const [selectedAdminSpiel, setSelectedAdminSpiel] = useState<FLSpiel | null>(null);

  return (
    <div className="contents">
      <SpielDisplayList
        spiele={spiele}
        today={today}
        onAdminEdit={(spiel) => setSelectedAdminSpiel(spiel)}
      />

      <AdminEditGameDataModal
        spielData={selectedAdminSpiel}
        isOpen={selectedAdminSpiel !== null}
        onClose={() => setSelectedAdminSpiel(null)}
      />
    </div>
  );
}
