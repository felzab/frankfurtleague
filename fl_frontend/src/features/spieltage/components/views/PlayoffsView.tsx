"use client";

import { useState } from "react";

import { SpielDetailsModal } from "@/features/spiele/components/modals/SpielDetailsModal";
import { SpielCardUltraCompact } from "@/features/spiele/components/ui/SpielCardUltraCompact";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { PAGE_RISE } from "@/shared/components/ui/motion";

import { orderRoundsByWiring, spieltagLabels } from "../../utils";

import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLSpieltagWithSpiele } from "../../schemas";

/**
 * The playoff bracket: one column per round, scrolling horizontally.
 *
 * **One modal instance for the whole bracket, driven by which Spiel is selected** — not a modal per
 * card. A bracket renders a few dozen cards, and giving each its own modal mounts a few dozen dialogs
 * with their own focus traps and portals for the one that might open.
 */
export function PlayoffsView({ playoffsSpieltage, today }: { playoffsSpieltage: FLSpieltagWithSpiele[]; today: string }) {
  const [selectedSpiel, setSelectedSpiel] = useState<FLSpiel | null>(null);

  // The expected state for most of a season: the playoff Spieltage do not exist until the group
  // phase finishes, and a blank content area would read as a fault.
  if (!playoffsSpieltage || playoffsSpieltage.length === 0) {
    return (
      <div className="flex w-full flex-1 items-start justify-center p-6">
        <EmptyState
          title="Noch keine Finalrunden"
          hint="Die Playoff-Paarungen werden festgelegt, sobald die Gruppenphase abgeschlossen ist."
        />
      </div>
    );
  }

  // The bracket lines below pair matches by index, so the indices have to follow the wiring: the
  // Spiele arrive in `datum` order, which puts 25 and 28 on one branch of a fixture whose sides name
  // 25 and 27. ADR-0034 stores the edges; a date respects none.
  const rounds = orderRoundsByWiring(playoffsSpieltage);
  // Labelled from the PLAYED order rather than from `rounds`, which `orderRoundsByWiring` re-arranges by
  // the bracket's wiring: the ordinal counts a matchday's place in its phase, not its column (ADR-0051).
  const labels = spieltagLabels(playoffsSpieltage);

  return (
    // The rise and not the card cascade: a bracket is a tree read column by column, and its cards are
    // joined by CSS bracket lines that do not animate. Staggering the cards would slide them away
    // from lines that stay put.
    <div className={`${PAGE_RISE} flex w-full min-w-0 flex-1 flex-col items-center pt-4 pb-12`}>
      {/* Viewport scroller. `@container` + `cqw` below, never `vw`: a `vw` column claims a share of
          the VIEWPORT, which the content area does not have once the sidebar appears, so the bracket
          overflows its own scroller. `cqw` measures this element instead. */}
      <div className="scrollbar-hide @container w-full snap-x snap-mandatory overflow-x-auto px-4 md:px-8">
        <div className="mx-auto flex h-fit w-max flex-row items-stretch gap-8">
          {rounds.map((playoffsSpieltag, roundIndex) => (
            <div
              key={playoffsSpieltag.id}
              className="flex w-[85cqw] max-w-[380px] shrink-0 snap-center flex-col items-center @2xl:w-[42cqw] @5xl:w-[28cqw]">
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
          isOpen={true}
          onClose={() => setSelectedSpiel(null)}
        />
      )}
    </div>
  );
}
