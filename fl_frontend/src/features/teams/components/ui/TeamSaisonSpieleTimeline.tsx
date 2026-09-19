"use client";

import { useState } from "react";

import { SpielDetailsModal } from "@/features/spiele/components/modals/SpielDetailsModal";
import { SpielCardCompact } from "@/features/spiele/components/ui/SpielCardCompact";
import { IM_ELFMETERSCHIESSEN, IM_ELFMETERSCHIESSEN_GESPROCHEN } from "@/features/spiele/utils";
import { SeasonEmptyState } from "@/shared/components/ui/SeasonEmptyState";
import { sortByDate } from "@/shared/utils/date";

import { computeEntscheidungFor } from "../../utils";

import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLSpielErgebnisFor } from "@/features/spiele/utils";

/**
 * The `-solid` fills rather than the tint accents: these are small bold glyphs on an opaque fill,
 * and a white "U" on the plain accent measured 3.44:1 in light and 2.70:1 in dark. The ring keeps
 * the tint accent, being decoration.
 */
const badgeColor = (ergebnisFor: FLSpielErgebnisFor): string => {
  switch (ergebnisFor) {
    case "S":
      return "bg-success-solid text-success-solid-foreground ring-success/30";
    case "U":
      return "bg-warning-solid text-warning-solid-foreground ring-warning/30";
    case "N":
      return "bg-danger-solid text-danger-solid-foreground ring-danger/30";
    default:
      // The outcome grammar's own null, never the category chip `TeamSaisonVerlauf` gives the
      // same fixture: a `?` here says nothing is claimed, and S, U and N carry the tones.
      return "bg-muted text-foreground-muted ring-border";
  }
};

/** What a screen reader hears in place of the badge, which would otherwise spell its letter out. */
const ERGEBNIS_WORT: Record<FLSpielErgebnisFor, string> = {
  S: "Sieg",
  U: "Unentschieden",
  N: "Niederlage",
  "?": "Kein Ergebnis",
};

/**
 * `"use client"` is required: this section holds the details modal's state and hands each card the
 * callback that opens it, which a Server Component may not pass (`docs/frontend/spec.md :: I13`).
 */
export function TeamSaisonSpieleTimeline({
  teamSpiele,
  teamId,
  today,
  isFinishedSaison,
}: {
  teamSpiele: FLSpiel[];
  teamId: string;
  today: string;
  isFinishedSaison: boolean;
}) {
  // One modal for the whole timeline, PlayoffsView-style.
  const [selectedSpiel, setSelectedSpiel] = useState<FLSpiel | null>(null);

  return (
    <section className="flex size-full flex-col gap-y-6">
      <h2 className="fluid-lg text-foreground font-extrabold tracking-tight">Saisonspiele</h2>

      {/* Without this the empty case renders the dashed rail with no items — a bare vertical line. */}
      {teamSpiele.length === 0 ? (
        <SeasonEmptyState
          nothing="keine Spiele"
          hint="Sobald der Spielplan steht, erscheinen die Begegnungen dieses Teams hier."
          isFinishedSaison={isFinishedSaison}
        />
      ) : (
        // Same list semantics as the card grids, so a screen-reader user gets a count and a position.
        <div
          role="list"
          className="border-border relative ml-2 border-l-2 border-dashed">
          {sortByDate({ arr: teamSpiele, key: "datum" }).map((spielData) => {
            const { ergebnisFor, imElfmeterschiessen } = computeEntscheidungFor({ spiel: spielData, teamId });

            return (
              <div
                role="listitem"
                key={spielData.id}
                className="relative mb-8 pl-6">
                <span className="sr-only">
                  {imElfmeterschiessen ? `${ERGEBNIS_WORT[ergebnisFor]} ${IM_ELFMETERSCHIESSEN_GESPROCHEN}` : ERGEBNIS_WORT[ergebnisFor]}
                </span>

                <div
                  aria-hidden="true"
                  className={`absolute top-4 left-[-11px] size-[20px] rounded-full ring-4 ${badgeColor(ergebnisFor)} flex items-center justify-center text-[10px] font-bold shadow-sm`}>
                  {ergebnisFor}
                </div>

                {/* Under the glyph and never inside it: the circle holds one letter at this size. The
                    `bg-muted` pill is the `?` badge's own ground, which is what hides the dashed rail
                    running behind it. */}
                {imElfmeterschiessen && (
                  <span
                    aria-hidden="true"
                    className="bg-muted text-foreground-muted absolute top-[42px] left-[-15px] w-[28px] rounded-full text-center text-[10px] leading-4 font-bold whitespace-nowrap">
                    {IM_ELFMETERSCHIESSEN}
                  </span>
                )}

                <SpielCardCompact
                  spielData={spielData}
                  isFinishedSaison={isFinishedSaison}
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
          isFinishedSaison={isFinishedSaison}
          isOpen={true}
          onClose={() => setSelectedSpiel(null)}
        />
      )}
    </section>
  );
}
