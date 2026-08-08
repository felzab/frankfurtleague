"use client";

import { useState } from "react";

import { adminSpielEditHref } from "../../utils";
import { SpielDetailsModal } from "../modals/SpielDetailsModal";
import { SpielCard } from "../ui/SpielCard";

import type { FLSpiel } from "../../schemas";

/**
 * `isAdmin` gives every card an edit link. A boolean rather than the callback this took before: since the
 * editor became a page (ADR-0050) the only thing the admin variant needs is a URL, and a URL is derived
 * from the fixture rather than handed down — so the admin list that used to own the modal's state has
 * nothing left to own.
 */
export function SpielCardsList({
  spiele,
  today,
  isAdmin = false,
  faultsBySpielId,
}: {
  spiele: FLSpiel[];
  today: string;
  isAdmin?: boolean;
  /**
   * Why each fixture needs a person, keyed by `spiel_id` — the admin triage list's, and nobody else's.
   *
   * A map rather than a field on the fixture, because a fault is derived over the whole season and
   * arrives beside the matches rather than inside them (ADR-0047). Absent on every public list, where
   * the concept does not exist.
   */
  faultsBySpielId?: ReadonlyMap<string, readonly string[]>;
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
          adminEditHref={isAdmin ? adminSpielEditHref(spielData.id) : undefined}
          faults={faultsBySpielId?.get(spielData.id)}
        />
      ))}

      {/* Guarded, so a list that has never been clicked mounts no overlay at all. This
          component is instantiated once per collection — eight on the admin action-required accordion,
          two on the landing grid, one each on spielsuche and the active spielplan tab
          — so mounting unconditionally would put a full Modal.Backdrop / Container / Dialog tree
          plus its react-aria overlay machinery on first paint at every one of them, to show nothing.
          The cost is the close animation: unmounting on `null` skips HeroUI's exit transition, so the
          modal disappears rather than fading. Accepted by the owner, 2026-07-31, who valued the mount
          saving over the transition. */}
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
