"use client";

import { useState } from "react";

import { SpielDetailsModal } from "@/features/spiele/components/modals/SpielDetailsModal";
import { SpielCardUltraCompact } from "@/features/spiele/components/ui/SpielCardUltraCompact";
import { BRACKET_SWEEP_CLASSES } from "@/shared/components/ui/motion";
import { SeasonEmptyState } from "@/shared/components/ui/SeasonEmptyState";

import { orderRoundsByWiring, spieltagLabels } from "../../utils";

import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLSpieltagWithSpiele } from "../../schemas";

// A round's share of the scroller once the `gap-8` gutters are out, capped at 380px, so every round is on
// screen wherever all of them fit at the floor. One literal per count: Tailwind emits only whole class names.
const COLUMN_WIDTH_BY_ROUNDS_CLASSES: Readonly<Record<number, string>> = {
  1: "w-[clamp(min(85cqw,19.5rem),100cqw,380px)]",
  2: "w-[clamp(min(85cqw,19.5rem),calc((100cqw-2rem)/2),380px)]",
  3: "w-[clamp(min(85cqw,19.5rem),calc((100cqw-4rem)/3),380px)]",
  4: "w-[clamp(min(85cqw,19.5rem),calc((100cqw-6rem)/4),380px)]",
};

// At 19.5rem a `SpielCardUltraCompact` holds „WO“ and a shoot-out beside its date at its largest type;
// `85cqw` keeps the next round peeking in on a phone. „Verlierer von Spiel 29“ takes three lines at either.
const COLUMN_FLOOR_CLASSES = "w-[min(85cqw,19.5rem)]";

/**
 * **One modal instance for the whole bracket, driven by which Spiel is selected** — a modal per card
 * mounts a few dozen dialogs with their own focus traps and portals for the one that might open.
 */
export function PlayoffsView({
  playoffsSpieltage,
  today,
  isFinishedSaison,
}: {
  playoffsSpieltage: FLSpieltagWithSpiele[];
  today: string;
  isFinishedSaison: boolean;
}) {
  const [selectedSpiel, setSelectedSpiel] = useState<FLSpiel | null>(null);

  // The expected state for most of a running season: the playoff Spieltage do not exist until the
  // group phase finishes, and a blank content area would read as a fault.
  if (!playoffsSpieltage || playoffsSpieltage.length === 0) {
    return (
      <div className="flex w-full flex-1 items-start justify-center p-6">
        <SeasonEmptyState
          nothing="keine Finalrunden"
          hint="Die Paarungen stehen fest, sobald die Gruppenphase abgeschlossen ist."
          isFinishedSaison={isFinishedSaison}
        />
      </div>
    );
  }

  // The bracket lines below pair matches by index, so the indices have to follow the wiring:
  // `teamN_quelle` stores the edges, and the arrival `datum` order respects none of them.
  const rounds = orderRoundsByWiring(playoffsSpieltage);
  // From the served list, not from `rounds`: the label reads each matchday's own `position`, so the
  // column order the wiring imposes cannot renumber anything.
  const labels = spieltagLabels(playoffsSpieltage);
  const columnWidth = COLUMN_WIDTH_BY_ROUNDS_CLASSES[rounds.length] ?? COLUMN_FLOOR_CLASSES;

  return (
    // The sweep below is the whole arrival: a second fade over the same frames would compound with it.
    <div className="flex w-full min-w-0 flex-1 flex-col items-center pt-4 pb-12">
      {/* Viewport scroller. `@container` + `cqw` below, never `vw`: a `vw` column claims a share of
          the VIEWPORT, which the content area does not have once the sidebar appears, so the bracket
          overflows its own scroller. `cqw` measures this element instead. */}
      {/* The scrollbar stays: a mouse has no swipe, so a hidden bar strands every round past the edge.
          Snapping is for touch alone, as a mandatory snap moves wherever a dragged thumb stops onto the
          nearest column. */}
      <div className="@container w-full overflow-x-auto px-4 md:px-8 pointer-coarse:snap-x pointer-coarse:snap-mandatory">
        {/* On the row and not the scroller: the sweep steps its direct children, which are the rounds. */}
        <div className={`${BRACKET_SWEEP_CLASSES} mx-auto flex h-fit w-max flex-row items-stretch gap-8`}>
          {rounds.map((playoffsSpieltag, roundIndex) => (
            <div
              key={playoffsSpieltag.id}
              className={`${columnWidth} flex shrink-0 snap-center flex-col items-center`}>
              <h2 className="bg-surface border-border text-foreground fluid-sm my-4 w-fit rounded-xl border px-6 py-2 font-bold tracking-wide uppercase shadow-sm">
                {labels.get(playoffsSpieltag.id)?.label}
              </h2>

              <div className="relative flex w-full flex-1 flex-col">
                {playoffsSpieltag.spiele.map((spielData, spielIndex) => {
                  const isFirstRound = roundIndex === 0;
                  const isLastRound = roundIndex === rounds.length - 1;
                  const isTopNode = spielIndex % 2 === 0;
                  const isBottomNode = spielIndex % 2 !== 0;
                  const hasPartner = isTopNode ? spielIndex + 1 < playoffsSpieltag.spiele.length : true;

                  return (
                    <div
                      key={spielData.id}
                      className="relative flex w-full flex-1 flex-col justify-center py-3">
                      {/* The inbound line, joining this match to the round it was fed from. */}
                      {!isFirstRound && <div className="bg-border absolute top-[calc(50%-1px)] -left-4 h-[2px] w-4" />}

                      {!isLastRound && (
                        <>
                          {isTopNode && hasPartner && (
                            <div className="border-border absolute top-[calc(50%-1px)] -right-4 h-[calc(50%+1px)] w-4 rounded-tr-xl border-t-2 border-r-2" />
                          )}

                          {isBottomNode && (
                            <div className="border-border absolute -right-4 bottom-[calc(50%-1px)] h-[calc(50%+1px)] w-4 rounded-br-xl border-r-2 border-b-2" />
                          )}

                          {isTopNode && !hasPartner && <div className="bg-border absolute top-[calc(50%-1px)] -right-4 h-[2px] w-4" />}
                        </>
                      )}

                      {/* Wrapped so `z-10` lifts the card clear of the bracket lines above. */}
                      <div className="relative z-10 w-full">
                        <SpielCardUltraCompact
                          spielData={spielData}
                          isFinishedSaison={isFinishedSaison}
                          onPress={() => {
                            setSelectedSpiel(spielData);
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

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
    </div>
  );
}
