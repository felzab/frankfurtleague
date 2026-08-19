"use client";

import { useState } from "react";

import { adminSpielEditHref } from "../../utils";
import { SpielDetailsModal } from "../modals/SpielDetailsModal";
import { SpielCard } from "../ui/SpielCard";

import type { FLSpiel } from "../../schemas";

/** `isAdmin` gives every card an edit link, a URL being all the admin variant now needs. */
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
   * Keyed by `spiel_id`. A map rather than a field on the fixture, a fault being derived over the
   * whole season and arriving beside the matches rather than inside them.
   */
  faultsBySpielId?: ReadonlyMap<string, readonly string[]>;
}) {
  const [selectedSpiel, setSelectedSpiel] = useState<FLSpiel | null>(null);

  return (
    <div className="contents">
      {spiele.map((spielData) => {
        const faults = faultsBySpielId?.get(spielData.id);
        const hasFaults = faults !== undefined && faults.length > 0;
        const card = (
          <SpielCard
            key={hasFaults ? undefined : spielData.id}
            spielData={spielData}
            today={today}
            onOpenInfoModal={() => setSelectedSpiel(spielData)}
            adminEditHref={isAdmin ? adminSpielEditHref(spielData.id) : undefined}
            asListitem={!hasFaults}
          />
        );

        if (!hasFaults) return card;

        // The wrapper carries `role="listitem"` and the card gives its own up, or the fixture
        // announces twice. A real element, because the cascade staggers by `:nth-child`.
        return (
          <div
            key={spielData.id}
            role="listitem"
            className="flex w-full flex-col">
            <ul className="border-danger/30 bg-danger/5 text-danger-strong fluid-xxs flex w-full flex-col gap-y-1 rounded-xl border px-3.5 py-2.5 font-semibold">
              {faults.map((sentence) => (
                <li key={sentence}>{sentence}</li>
              ))}
            </ul>
            {/* The connectors: one short stem at each end of the note, mirrored,
                so the note and the card read as one drawn shape rather than a box floating over an
                unrelated card. `bg-danger/30` matches the note's border. */}
            <div
              aria-hidden="true"
              className="flex shrink-0 flex-row justify-between px-7">
              <span className="bg-danger/30 h-3 w-px" />
              <span className="bg-danger/30 h-3 w-px" />
            </div>
            {/* `*:grow` stretches the card to the cell's remaining height, which is what the grid's
                own align-stretch did for it while it was the listitem — so a faulted card and its
                unfaulted neighbour still bottom-align in one row. */}
            <div className="flex min-h-0 grow flex-col *:grow">{card}</div>
          </div>
        );
      })}

      {/* Guarded, so a list never clicked mounts no overlay: this is instantiated once per
          collection, and mounting unconditionally would put a dialog tree plus its react-aria
          machinery on first paint at each. The accepted cost is HeroUI's exit transition. */}
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
