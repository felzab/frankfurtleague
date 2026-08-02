"use client";

import { useState } from "react";

import { SpielDetailsModal } from "@/features/spiele/components/modals/SpielDetailsModal";
import { SpielCardUltraCompact } from "@/features/spiele/components/ui/SpielCardUltraCompact";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { PAGE_RISE } from "@/shared/components/ui/motion";

import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLSpieltagWithSpiele } from "../../schemas";

/**
 * The playoff bracket: one column per round, scrolling horizontally.
 *
 * **One modal instance for the whole bracket, driven by which Spiel is selected** — not a modal per
 * card. A bracket renders a few dozen cards, and giving each its own modal mounts a few dozen dialogs
 * with their own focus traps and portals for the one that might open.
 *
 * Layout note worth keeping: the columns are sized in container-query units (`cqw`), not viewport
 * units. With `vw`, each column claims a share of the *viewport*, which the content area does not have
 * once the sidebar appears — so the bracket overflowed its own scroller at desktop widths.
 */
export function PlayoffsView({ playoffsSpieltage, today }: { playoffsSpieltage: FLSpieltagWithSpiele[]; today: string }) {
  // 1. The Single Modal State
  const [selectedSpiel, setSelectedSpiel] = useState<FLSpiel | null>(null);

  // Was `return null`, which rendered a completely blank content area — and this is the expected
  // state for most of a season, because the playoff Spieltage do not exist until the group phase
  // finishes.
  /* Rendered in both branches — see the note in `SpielhistorieView`: the route must keep its only
     `h1` whether or not the season has data. */
  const pageHeading = <h1 className="sr-only">Finalrunden</h1>;

  if (!playoffsSpieltage || playoffsSpieltage.length === 0) {
    return (
      <div className="flex w-full flex-1 items-start justify-center p-6">
        {pageHeading}
        <EmptyState
          title="Noch keine Finalrunden"
          hint="Die Playoff-Paarungen werden festgelegt, sobald die Gruppenphase abgeschlossen ist."
        />
      </div>
    );
  }

  return (
    // flex-1 and pb-12 so it respects the same native scrolling flow as the other pages.
    // The rise and NOT the card cascade, even though this renders a few dozen `SpielCardUltraCompact`s:
    // a bracket is a tree read column by column, and its cards are joined by CSS bracket lines that do
    // not animate. Staggering the cards would slide them away from lines that stay put.
    <div className={`${PAGE_RISE} flex w-full min-w-0 flex-1 flex-col items-center pt-4 pb-12`}>
      {pageHeading}

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
              {/* Round header */}
              <h2 className="bg-surface border-border text-foreground fluid-sm my-4 w-fit rounded-xl border px-6 py-2 font-bold tracking-wide uppercase shadow-sm">
                {playoffsSpieltag.name}
              </h2>

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

                      {/* A. Inbound line, joining this match to the round it was fed from. */}
                      {!isFirstRound && <div className="bg-border absolute top-[calc(50%-1px)] -left-4 h-[2px] w-4" />}

                      {/* B. Outbound Bracket Lines */}
                      {!isLastRound && (
                        <>
                          {/* Top game */}
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

                      {/* C. The card, wrapped so `z-10` lifts it clear of the bracket lines above. */}
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
