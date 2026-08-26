"use client";

import { Tabs } from "@heroui/react";

import { SpielCardsList } from "@/features/spiele/components/collections/SpielCardsList";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { TAB_INDICATOR, TAB_ITEM, TAB_TRACK } from "@/shared/components/ui/formFieldStyles";
import { CARDS_CASCADE, PAGE_RISE } from "@/shared/components/ui/motion";

import { spieltagLabels } from "../../utils";

import type { FLSpielplan } from "../../schemas";

export function SpielplanView({ spielplanData, today }: { spielplanData: FLSpielplan; today: string }) {
  // The list arrives in the backend's played order and nothing here may re-sort it: the tabs run
  // left to right in the order the season is played.
  const labels = spieltagLabels(spielplanData.spieltage);
  // Without this the empty case renders a bordered, empty 44px tab bar and no panels.
  if (!spielplanData.spieltage.length) {
    return (
      <div className="flex w-full flex-1 items-start justify-center p-6">
        <EmptyState title="Noch kein Spielplan" />
      </div>
    );
  }

  return (
    // Height from the content, so the page does not jump between Spieltage of different sizes. The
    // arrival animation is here rather than per panel: this mounts once per visit.
    <Tabs className={`${PAGE_RISE} relative flex w-full flex-1 flex-col items-center`}>
      {/* `Tabs.ListContainer` sits inside the sticky bar holding only the track, which is what its
          chevron buttons position against. The fuller note is in `AdminSpieleActionRequiredView`. */}
      <div className="bg-background sticky top-0 z-20 flex w-full flex-col items-center px-4 py-4 sm:px-8 lg:py-8">
        <div className="lg:max-w-toolbar flex w-full max-w-full flex-row items-center justify-center lg:w-[90%]">
          {/* **No `overflow-x-auto` or `scrollbar-hide` here.** The chevrons show only while the
              `ScrollShadow` reports the strip can scroll, detected by letting the list grow — a
              self-scrolling list hides that and no chevron appears. */}
          <Tabs.ListContainer className="max-w-full min-w-0 bg-transparent [&>div]:max-w-full [&>div]:min-w-0 [&>div]:[--scroll-shadow-size:24px]!">
            {/* `min-w-fit` undoes the container's `min-w-full`, whose floor stretched the track
                across the whole rail; `w-max` lets the list outgrow it. */}
            <Tabs.List className={`${TAB_TRACK} flex w-max min-w-fit flex-row items-center gap-1 p-1.5 shadow-sm`}>
              {spielplanData.spieltage.map((spieltagData) => {
                return (
                  <Tabs.Tab
                    key={spieltagData.id}
                    id={spieltagData.id}
                    /* `w-fit` undoes HeroUI's `w-full` on `.tabs__tab` — left at full width inside
                       a `min-w-full` list, six Spieltage share the rail as six equal slabs. */
                    className={`${TAB_ITEM} flex h-11 w-fit items-center px-5 whitespace-nowrap md:px-6`}>
                    {labels.get(spieltagData.id)?.label}
                    <Tabs.Indicator className={TAB_INDICATOR} />
                  </Tabs.Tab>
                );
              })}
            </Tabs.List>
          </Tabs.ListContainer>
        </div>
      </div>

      {spielplanData.spieltage.map((spieltagData) => (
        <Tabs.Panel
          key={spieltagData.id}
          id={spieltagData.id}
          className="w-full px-4 pt-0 pb-4 outline-none sm:px-8">
          {/* The switch animation belongs on the CARDS. RAC holds a deselected panel mounted until
              `panel.getAnimations()` settle and ignores descendants, so `animate-in` here leaves
              the previous panel on screen. */}
          {/* Staggered rather than faded as one block: every card lands where the previous
              Spieltag's card sat, so a single fade reads as the content mutating in place. */}
          <div
            role="list"
            className={`${CARDS_CASCADE} max-w-page mx-auto grid w-full grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3`}>
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
