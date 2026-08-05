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

      {/* Guarded, so a list that has never been clicked mounts no overlay at all. This
          component is instantiated once per collection — eight on the admin action-required accordion,
          two on the landing grid, one each on spielsuche, spielhistorie and the active spielplan tab
          — so mounting unconditionally would put a full Modal.Backdrop / Container / Dialog tree
          plus its react-aria overlay machinery on first paint at every one of them, to show nothing.
          The cost is the close animation: unmounting on `null` skips HeroUI's exit transition, so the
          modal disappears rather than fading. Accepted by the owner, 2026-07-31, who valued the mount
          saving over the transition. `AdminEditSpielDataModal` behaves the same way. */}
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
