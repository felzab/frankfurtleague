"use client";

/**
 * TEAMS · the season's fixtures, on a rail
 *
 * The boundary is drawn at this section on purpose: it holds the details modal's state and hands
 * each card the callback that opens it, which a Server Component may not pass across
 * (`docs/frontend/spec.md :: I13`).
 *
 * Invariants:
 * - The compact card is this rail's alone and is never merged with its two siblings (ADR-0005).
 */
import { useState } from "react";

import { SpielDetailsModal } from "@/features/spiele/components/modals/SpielDetailsModal";
import { SpielCardCompact } from "@/features/spiele/components/ui/SpielCardCompact";
import { computeErgebnisFor } from "@/features/spiele/utils";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { sortByDate } from "@/shared/utils/date";

import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLSpielErgebnisFor } from "@/features/spiele/utils";

/**
 * The W/D/L dots are 10px bold glyphs on an opaque fill, so they need the `-solid` fills rather
 * than the tint-grade accents. On the plain accents a white "D" measured 1.92:1
 * in the light theme and 1.32:1 in dark — the draw marker was effectively invisible. The ring
 * stays on the tint accent: it is decoration around the dot, not a foreground.
 */
const badgeColor = (ergebnisFor: FLSpielErgebnisFor): string => {
  switch (ergebnisFor) {
    case "W":
      return "bg-success-solid text-success-solid-foreground ring-success/30";
    case "D":
      return "bg-warning-solid text-warning-solid-foreground ring-warning/30";
    case "L":
      return "bg-danger-solid text-danger-solid-foreground ring-danger/30";
    default:
      return "bg-muted text-foreground-muted ring-border";
  }
};

export function TeamSaisonSpieleTimeline({ teamSpiele, teamId, today }: { teamSpiele: FLSpiel[]; teamId: string; today: string }) {
  // One modal for the whole timeline, PlayoffsView-style.
  const [selectedSpiel, setSelectedSpiel] = useState<FLSpiel | null>(null);

  return (
    <section className="flex size-full flex-col gap-y-6">
      <h3 className="fluid-lg text-foreground font-extrabold tracking-tight">Saisonspiele</h3>

      {/* Without this the empty case renders the dashed rail with no items -- a bare vertical line
          under the heading. */}
      {teamSpiele.length === 0 ? (
        <EmptyState
          title="Für diese Saison sind noch keine Spiele angesetzt."
          hint="Sobald der Spielplan steht, erscheinen die Begegnungen dieses Teams hier."
        />
      ) : (
        // Same list semantics as the six card grids: this is a repeated collection too, so a
        // screen-reader user gets a count and a position here as well.
        <div
          role="list"
          className="border-border relative ml-2 border-l-2 border-dashed">
          {sortByDate({ arr: teamSpiele, key: "datum" }).map((spielData) => {
            const ergebnisFor = computeErgebnisFor({ spiel: spielData, teamId });

            return (
              <div
                role="listitem"
                key={spielData.id}
                className="relative mb-8 pl-6">
                <div
                  className={`absolute top-4 left-[-11px] size-[20px] rounded-full ring-4 ${badgeColor(ergebnisFor)} flex items-center justify-center text-[10px] font-bold shadow-sm`}>
                  {ergebnisFor}
                </div>

                <SpielCardCompact
                  spielData={spielData}
                  onOpenInfoModal={() => setSelectedSpiel(spielData)}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Guarded like `SpielCardsList`'s: no overlay tree until a card is opened. */}
      {selectedSpiel && (
        <SpielDetailsModal
          spielData={selectedSpiel}
          today={today}
          isOpen={true}
          onClose={() => setSelectedSpiel(null)}
        />
      )}
    </section>
  );
}
