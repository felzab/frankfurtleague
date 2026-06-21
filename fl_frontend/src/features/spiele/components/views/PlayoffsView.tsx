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
    <div className="animate-in fade-in slide-in-from-bottom-4 flex w-full min-w-0 flex-col items-center duration-400">
      {/* Viewport scroller */}
      <div className="scrollbar-hide w-full snap-x snap-mandatory overflow-x-auto px-4 md:px-8">
        {/* Tree track */}
        <div className="flex h-fit min-w-max flex-row items-stretch gap-8">
          {playoffsSpieltage.map((playoffsSpieltag, roundIndex) => (
            /* Responsive column */
            <div
              key={playoffsSpieltag.id}
              className="flex w-[85vw] max-w-[380px] shrink-0 snap-center flex-col items-center md:w-[42vw] lg:w-[28vw]">
              {/* Round Header */}
              <h4 className="text-fluid-base bg-quaternary-light dark:bg-quaternary-dark my-4 w-fit rounded-2xl px-6 py-1.5 font-extrabold tracking-wide uppercase shadow-lg">
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
                      {/* --- UNBREAKABLE CSS BRACKET BRIDGES ---
                          Track (horizontal) gap is gap-8 (32px).
                          Outbound line reaches right w-4 (16px).
                          Inbound line reaches left w-4 (16px).
                          16px + 16px = 32px. Perfect connection, regardless of screen size!
                      */}

                      {/* A. Inbound Line */}
                      {!isFirstRound && (
                        <div className="bg-quaternary-light dark:bg-quaternary-dark absolute top-[calc(50%-1px)] -left-4 h-[2px] w-4" />
                      )}

                      {/* B. Outbound Bracket Lines */}
                      {!isLastRound && (
                        <>
                          {/* Top Game */}
                          {isTopNode && hasPartner && (
                            <div className="border-quaternary-light dark:border-quaternary-dark absolute top-[calc(50%-1px)] -right-4 h-[calc(50%+1px)] w-4 rounded-tr-xl border-t-2 border-r-2" />
                          )}

                          {/* Bottom Game */}
                          {isBottomNode && (
                            <div className="border-quaternary-light dark:border-quaternary-dark absolute -right-4 bottom-[calc(50%-1px)] h-[calc(50%+1px)] w-4 rounded-br-xl border-r-2 border-b-2" />
                          )}

                          {/* Bye (Straight line) */}
                          {isTopNode && !hasPartner && (
                            <div className="bg-quaternary-light dark:bg-quaternary-dark absolute top-[calc(50%-1px)] -right-4 h-[2px] w-4" />
                          )}
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
