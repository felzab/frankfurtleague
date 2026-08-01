"use client";

import { useState } from "react";

import { SpielDetailsModal } from "../modals/SpielDetailsModal";
import { SpielCard } from "../ui/SpielCard";

import type { FLSpiel } from "../../schemas";

export function SpielCardsList({ spiele, today, onAdminEdit }: { spiele: FLSpiel[]; today: string; onAdminEdit?: (spiel: FLSpiel) => void }) {
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

      {/* Guarded, so a list that has never been clicked mounts no overlay at all (R4 §16.4). This
          component is instantiated once per collection — six on the admin action-required accordion,
          two on the landing grid, one each on spielsuche, spielhistorie and the active spielplan tab
          — and each instance used to mount a full Modal.Backdrop / Container / Dialog tree plus its
          react-aria overlay machinery on first paint, to show nothing.
          The cost is the close animation: unmounting on `null` skips HeroUI's exit transition, so
          the modal disappears rather than fading. Accepted by the owner, 2026-07-31, who valued the
          mount saving over the transition. `AdminEditSpielDataModal` has always behaved this way. */}
      {selectedSpiel && (
        <SpielDetailsModal
          spielData={selectedSpiel}
          today={today}
          isOpen={true}
          onClose={() => setSelectedSpiel(null)}
        />
      )}
    </div>
  );
}
