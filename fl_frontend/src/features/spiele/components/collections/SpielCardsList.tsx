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

        // A faulted fixture is a NOTE plus a card, and the note sits OUTSIDE the card so the card
        // stays purely what it is (decided 2026-08-08). The wrapper carries the `role="listitem"` the
        // grid expects — a note rendered as a bare sibling would be a non-listitem child of the list —
        // and the card inside gives its own role up, or every faulted fixture would announce twice.
        // A real element rather than `display: contents`, because the cascade staggers by
        // `:nth-child` over the listitems and a contents wrapper would take the card out of that
        // count. The short stem between note and card is what says they belong together: without it
        // the note reads as floating copy above an unrelated card.
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
            {/* The connectors: one short stem at each end of the note, mirrored (decided 2026-08-08),
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

      {/* Guarded, so a list that has never been clicked mounts no overlay at all. This
          component is instantiated once per collection — eight on the admin action-required accordion,
          two on the landing grid, one each on spielsuche and the active spielplan tab
          — so mounting unconditionally would put a full Modal.Backdrop / Container / Dialog tree
          plus its react-aria overlay machinery on first paint at every one of them, to show nothing.
          The cost is the close animation: unmounting on `null` skips HeroUI's exit transition, so the
          modal disappears rather than fading. Accepted 2026-07-31 — the mount
          saving is valued over the transition. */}
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
