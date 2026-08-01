"use client";

import { Tabs } from "@heroui/react";

import SpielCardsList from "@/features/spiele/components/collections/SpielCardsList";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { TAB_INDICATOR, TAB_ITEM, TAB_TRACK } from "@/shared/components/ui/formFieldStyles";

import type { FLSpielplan } from "../../schemas";

export default function SpielplanView({ spielplanData, today }: { spielplanData: FLSpielplan; today: string }) {
  /* Rendered in both branches — see the note in `SpielhistorieView`: the route must keep its only
     `h1` whether or not the season has data. */
  const pageHeading = <h1 className="sr-only">Spielplan</h1>;

  // Without this the empty case renders a bordered, empty 44px tab bar and no panels (R4 §12.2).
  if (!spielplanData?.spieltage?.length) {
    return (
      <div className="flex w-full flex-1 items-start justify-center p-6">
        {pageHeading}
        <EmptyState
          title="Für diese Saison steht noch kein Spielplan fest."
          hint="Sobald die Spieltage angelegt sind, erscheinen sie hier."
        />
      </div>
    );
  }

  return (
    // Updated to flex-1 and flex-col so it handles height naturally without jumping.
    // The arrival animation lives here rather than on each panel (NEW-R3): this element mounts once
    // per page visit and never again on a tab press, so the rise plays exactly when it should — the
    // page settling into place — and cannot be replayed or interrupted by switching Spieltag.
    // Note this is an ancestor of the `sticky` tab bar below. That is safe: a transformed ancestor
    // redefines the containing block for `position: fixed`, not for `position: sticky`, which resolves
    // against its nearest scrollport (`<main>`, further up and untransformed). And the animation only
    // ever runs at mount, when the scroller is still at the top and nothing is stuck yet — measured
    // at rest, the root's `transform` is `none` with zero live animations.
    <Tabs className="animate-in fade-in slide-in-from-bottom-4 relative flex w-full flex-1 flex-col items-center duration-400">
      {pageHeading}

      <Tabs.ListContainer className="bg-background sticky top-0 z-20 flex w-full flex-col items-center px-4 py-4 sm:px-8 lg:py-8 [&>div]:max-w-full [&>div]:min-w-0">
        {/* The width boundaries for mobile vs desktop */}
        <Tabs.List
          className={`${TAB_TRACK} scrollbar-hide lg:max-w-toolbar flex w-full max-w-full flex-row items-center gap-1 overflow-x-auto p-1.5 shadow-sm lg:w-[90%]`}>
          {/** Tab options */}
          {spielplanData?.spieltage.map((spieltagData) => {
            return (
              <Tabs.Tab
                key={spieltagData.id}
                id={spieltagData.id}
                /* shrink-0 removed! whitespace-nowrap handles the sizing naturally. */
                className={`${TAB_ITEM} flex h-11 items-center px-5 whitespace-nowrap md:px-6`}>
                {spieltagData.name}
                <Tabs.Indicator className={TAB_INDICATOR} />
              </Tabs.Tab>
            );
          })}
        </Tabs.List>
      </Tabs.ListContainer>

      {/** A panel is generated for each game-day */}
      {spielplanData?.spieltage.map((spieltagData) => (
        <Tabs.Panel
          key={spieltagData.id}
          id={spieltagData.id}
          className="max-w-page w-full px-4 pt-0 pb-4 outline-none sm:px-8">
          {/* The entry animation lives here and NOT on `Tabs.Panel`. RAC keeps a deselected panel
              mounted until `panel.getAnimations()` all settle (`useExitAnimation`), and
              `getAnimations()` does not look at descendants — so an `animate-in` on the panel itself
              made a fast tab switch hold the previous panel on screen for the rest of its enter
              animation, which is the leftover-cards flicker. Identical visually.

              The rise moved up to the `Tabs` root, which mounts once, so it no longer replays on
              every press (NEW-R3). The switch animation is now `cards-cascade` (defined in
              `globals.css`) and it sits on the CARDS, not on this container.

              That took three goes, and the first two were aimed at the wrong thing. Timing was never
              it: 400ms, 150ms and a fade-from-50% all flickered identically, which is the tell — if
              very different durations look the same, duration is not the variable. The owner named
              the real cause: every card lands at exactly the screen position the previous Spieltag's
              card occupied, so animating this container fades the whole grid as one block and still
              reads as the content mutating in place. Staggering the cards puts them in sequence
              instead, and the eye follows a sequence rather than catching a single flash. */}
          <div
            role="list"
            className="cards-cascade grid w-full grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {/* Using spread operator to safely sort without mutating the original array in Strict Mode */}
            <SpielCardsList
              spiele={[...spieltagData.spiele].sort((spiel1, spiel2) => spiel1.spiel_nr - spiel2.spiel_nr)}
              today={today}
            />
          </div>
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
