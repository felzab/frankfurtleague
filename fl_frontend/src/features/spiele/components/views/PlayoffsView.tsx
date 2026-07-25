"use client";

import { useState } from "react";

import SpielDetailsModal from "../modals/SpielDetailsModal";
import SpielCardUltraCompact from "../SpielCardUltraCompact";

import type { FLSpieltagWithSpiele } from "@/features/spieltage/schemas";
import type { FLSpiel } from "../../schemas";

export default function PlayoffBracketView({ playoffsSpieltage }: { playoffsSpieltage: FLSpieltagWithSpiele[] }) {
  // 1. The Single Modal State
  const [selectedSpiel, setSelectedSpiel] = useState<FLSpiel | null>(null);

  if (!playoffsSpieltage || playoffsSpieltage.length === 0) return null;

  return (
    // FIX: Added flex-1 and pb-12 so it respects the same native scrolling flow as the other pages
    <div className="animate-in fade-in slide-in-from-bottom-4 flex w-full min-w-0 flex-1 flex-col items-center pt-4 pb-12 duration-400">
      {/* Viewport scroller */}
      <div className="scrollbar-hide w-full snap-x snap-mandatory overflow-x-auto px-4 md:px-8">
        {/* Tree track */}
        <div className="flex h-fit min-w-max flex-row items-stretch gap-8">
          {playoffsSpieltage.map((playoffsSpieltag, roundIndex) => (
            /* Responsive column */
            <div
              key={playoffsSpieltag.id}
              className="flex w-[85vw] max-w-[380px] shrink-0 snap-center flex-col items-center md:w-[42vw] lg:w-[28vw]">
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
                          onClick={() => {
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
        isOpen={selectedSpiel !== null}
        onClose={() => setSelectedSpiel(null)}
      />
    </div>
  );
}
