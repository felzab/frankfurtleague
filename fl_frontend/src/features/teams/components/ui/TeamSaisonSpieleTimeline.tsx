"use client";

import { useState } from "react";

import { SpielDetailsModal } from "@/features/spiele/components/modals/SpielDetailsModal";
import { SpielCardCompact } from "@/features/spiele/components/ui/SpielCardCompact";
import { computeErgebnisFor } from "@/features/spiele/utils";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { sortByDate } from "@/shared/utils/date";

import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLSpielErgebnisFor } from "@/features/spiele/utils";

/**
 * The `-solid` fills rather than the tint accents: these are small bold glyphs on an opaque fill,
 * and a white "D" on the plain accent measured 1.92:1 in light and 1.32:1 in dark. The ring keeps
 * the tint accent, being decoration.
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

/**
 * `"use client"` is required: this section holds the details modal's state and hands each card the
 * callback that opens it, which a Server Component may not pass (`docs/frontend/spec.md :: I13`).
 */
export function TeamSaisonSpieleTimeline({ teamSpiele, teamId, today }: { teamSpiele: FLSpiel[]; teamId: string; today: string }) {
  // One modal for the whole timeline, PlayoffsView-style.
  const [selectedSpiel, setSelectedSpiel] = useState<FLSpiel | null>(null);

  return (
    <section className="flex size-full flex-col gap-y-6">
      <h2 className="fluid-lg text-foreground font-extrabold tracking-tight">Saisonspiele</h2>

      {/* Without this the empty case renders the dashed rail with no items — a bare vertical line. */}
      {teamSpiele.length === 0 ? (
        <EmptyState
          title="Für diese Saison sind noch keine Spiele angesetzt."
          hint="Sobald der Spielplan steht, erscheinen die Begegnungen dieses Teams hier."
        />
      ) : (
        // Same list semantics as the card grids, so a screen-reader user gets a count and a position.
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
