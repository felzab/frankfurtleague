"use client";

import type { FLSpiel, FLSpieltagWithSpiele } from "../../types";
import SpielDetailsModal from "../modals/SpielDetailsModal";
import SpielCardUltraCompact from "../SpielCardUltraCompact";
import { useState } from "react";

export default function PlayoffBracketView({ playoffsSpieltage }: { playoffsSpieltage: FLSpieltagWithSpiele[] }) {
  // 1. The Single Modal State
  const [selectedSpiel, setSelectedSpiel] = useState<FLSpiel | null>(null);

  if (!playoffsSpieltage || playoffsSpieltage.length === 0) return null;

  return (
    <div className="min-w-0 w-full flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-400">
      {/* Viewport scroller */}
      <div className="w-full overflow-x-auto snap-x snap-mandatory scrollbar-hide px-4 md:px-8">
        {/* Tree track */}
        <div className="flex flex-row items-stretch min-w-max h-fit gap-8">
          {playoffsSpieltage.map((playoffsSpieltag, roundIndex) => (
            /* Responsive column */
            <div
              key={playoffsSpieltag.id}
              className="flex flex-col items-center snap-center shrink-0 w-[85vw] md:w-[42vw] lg:w-[28vw] max-w-[380px]">
              {/* Round Header */}
              <h4 className="w-fit px-6 py-1.5 my-4 rounded-2xl shadow-lg text-fluid-base font-extrabold tracking-wide uppercase bg-quaternary-light dark:bg-quaternary-dark">
                {playoffsSpieltag.name}
              </h4>

              {/* Spiele column*/}
              <div className="flex flex-col flex-1 w-full relative">
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
                      className="flex-1 flex flex-col justify-center relative w-full py-3">
                      {/* --- UNBREAKABLE CSS BRACKET BRIDGES ---
                          Track (horizontal) gap is gap-8 (32px).
                          Outbound line reaches right w-4 (16px).
                          Inbound line reaches left w-4 (16px).
                          16px + 16px = 32px. Perfect connection, regardless of screen size!
                      */}

                      {/* A. Inbound Line */}
                      {!isFirstRound && (
                        <div className="absolute top-[calc(50%-1px)] -left-4 w-4 h-[2px] bg-quaternary-light dark:bg-quaternary-dark" />
                      )}

                      {/* B. Outbound Bracket Lines */}
                      {!isLastRound && (
                        <>
                          {/* Top Game */}
                          {isTopNode && hasPartner && (
                            <div className="absolute top-[calc(50%-1px)] -right-4 w-4 h-[calc(50%+1px)] border-r-2 border-t-2 border-quaternary-light dark:border-quaternary-dark rounded-tr-xl" />
                          )}

                          {/* Bottom Game */}
                          {isBottomNode && (
                            <div className="absolute bottom-[calc(50%-1px)] -right-4 w-4 h-[calc(50%+1px)] border-r-2 border-b-2 border-quaternary-light dark:border-quaternary-dark rounded-br-xl" />
                          )}

                          {/* Bye (Straight line) */}
                          {isTopNode && !hasPartner && (
                            <div className="absolute top-[calc(50%-1px)] -right-4 w-4 h-[2px] bg-quaternary-light dark:bg-quaternary-dark" />
                          )}
                        </>
                      )}

                      {/* 6. THE CARD (Wrapped to ensure it sits above the lines) */}
                      <div className="w-full relative z-10">
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
