"use client";

import { useState } from "react";

import SpielDetailsModal from "@/features/spiele/components/modals/SpielDetailsModal";
import SpielCardUltraCompact from "@/features/spiele/components/SpielCardUltraCompact";
import { EmptyState } from "@/shared/components/ui/EmptyState";

import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLSpieltagWithSpiele } from "../../schemas";

export default function PlayoffBracketView({ playoffsSpieltage, today }: { playoffsSpieltage: FLSpieltagWithSpiele[]; today: string }) {
  // 1. The Single Modal State
  const [selectedSpiel, setSelectedSpiel] = useState<FLSpiel | null>(null);

  // Was `return null`, which rendered a completely blank content area — and this is the expected
  // state for most of a season, because the playoff Spieltage do not exist until the group phase
  // finishes (R4 §12.2).
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

  return (
    // FIX: Added flex-1 and pb-12 so it respects the same native scrolling flow as the other pages
    <div className="animate-in fade-in slide-in-from-bottom-4 flex w-full min-w-0 flex-1 flex-col items-center pt-4 pb-12 duration-400">
      {/* Viewport scroller. @container + cqw below: the columns used to be sized in vw, so once the
          sidebar appears they each claim a share of the viewport the content area does not have and
          the bracket overflows into the scroller. cqw measures this element instead. */}
      <div className="scrollbar-hide @container w-full snap-x snap-mandatory overflow-x-auto px-4 md:px-8">
        {/* Tree track */}
        <div className="mx-auto flex h-fit w-max flex-row items-stretch gap-8">
          {playoffsSpieltage.map((playoffsSpieltag, roundIndex) => (
            /* Responsive column */
            <div
              key={playoffsSpieltag.id}
              className="flex w-[85cqw] max-w-[380px] shrink-0 snap-center flex-col items-center @2xl:w-[42cqw] @5xl:w-[28cqw]">
              {/* Round Header
                  FIX: Swapped quaternary colors for the sleek surface/border combination
              */}
              <h4 className="bg-surface border-border text-foreground text-fluid-sm my-4 w-fit rounded-xl border px-6 py-2 font-bold tracking-wide uppercase shadow-sm">
                {playoffsSpieltag.name}
              </h4>

              {/* Spiele column*/}
              <div className="relative flex w-full flex-1 flex-col">
                {playoffsSpieltag.spiele.map((spielData, spielIndex) => {
                  const isFirstRound = roundIndex === 0;
                  const isLastRound = roundIndex === playoffsSpieltage.length - 1;
                  const isTopNode = spielIndex % 2 === 0;
                  const isBottomNode = spielIndex % 2 !== 0;
                  const hasPartner = isTopNode ? spielIndex + 1 < playoffsSpieltag.spiele.length : true;

                  return (
                    /* Game slice*/
                    <div
                      key={spielData.id}
                      className="relative flex w-full flex-1 flex-col justify-center py-3">
                      {/* --- UNBREAKABLE CSS BRACKET BRIDGES --- */}

                      {/* A. Inbound Line (FIX: Replaced quaternary with bg-border) */}
                      {!isFirstRound && <div className="bg-border absolute top-[calc(50%-1px)] -left-4 h-[2px] w-4" />}

                      {/* B. Outbound Bracket Lines */}
                      {!isLastRound && (
                        <>
                          {/* Top Game (FIX: Replaced quaternary with border-border) */}
                          {isTopNode && hasPartner && (
                            <div className="border-border absolute top-[calc(50%-1px)] -right-4 h-[calc(50%+1px)] w-4 rounded-tr-xl border-t-2 border-r-2" />
                          )}

                          {/* Bottom Game */}
                          {isBottomNode && (
                            <div className="border-border absolute -right-4 bottom-[calc(50%-1px)] h-[calc(50%+1px)] w-4 rounded-br-xl border-r-2 border-b-2" />
                          )}

                          {/* Bye (Straight line) */}
                          {isTopNode && !hasPartner && <div className="bg-border absolute top-[calc(50%-1px)] -right-4 h-[2px] w-4" />}
                        </>
                      )}

                      {/* 6. THE CARD (Wrapped to ensure it sits above the lines) */}
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

      <SpielDetailsModal
        spielData={selectedSpiel}
        today={today}
        isOpen={selectedSpiel !== null}
        onClose={() => setSelectedSpiel(null)}
      />
    </div>
  );
}
