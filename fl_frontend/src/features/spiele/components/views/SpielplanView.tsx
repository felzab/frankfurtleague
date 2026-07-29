"use client";

import { Tabs } from "@heroui/react";

import SpielCardsList from "../collections/SpielCardsList";

import type { FLSpielplan } from "@/features/spieltage/schemas";

export default function SpielplanView({ spielplanData }: { spielplanData: FLSpielplan }) {
  return (
    // Updated to flex-1 and flex-col so it handles height naturally without jumping
    <Tabs className="relative flex w-full flex-1 flex-col items-center">
      <Tabs.ListContainer className="bg-background sticky top-0 z-20 flex w-full flex-col items-center px-4 py-4 sm:px-8 lg:py-8 [&>div]:max-w-full [&>div]:min-w-0">
        {/* The width boundaries for mobile vs desktop */}
        <Tabs.List className="scrollbar-hide border-border bg-surface flex w-full max-w-full flex-row items-center gap-1 overflow-x-auto rounded-xl border p-1.5 shadow-sm lg:w-[90%] lg:max-w-[1200px]">
          {/** Tab options */}
          {spielplanData?.spieltage.map((spieltagData) => {
            return (
              <Tabs.Tab
                key={spieltagData.id}
                id={spieltagData.id}
                /* shrink-0 removed! whitespace-nowrap handles the sizing naturally. */
                className="text-foreground-muted data-[selected=true]:text-foreground text-fluid-sm hover:text-foreground-muted flex h-11 items-center px-5 font-bold whitespace-nowrap transition-colors hover:opacity-100 md:px-6">
                {spieltagData.name}
                <Tabs.Indicator className="bg-brand-solid rounded-lg shadow-sm" />
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
          className="animate-in fade-in slide-in-from-bottom-4 grid w-full max-w-[1400px] grid-cols-1 gap-5 px-4 pt-0 pb-4 duration-400 outline-none sm:grid-cols-2 sm:px-8 xl:grid-cols-3">
          {/* Using spread operator to safely sort without mutating the original array in Strict Mode */}
          <SpielCardsList spiele={[...spieltagData.spiele].sort((spiel1, spiel2) => spiel1.spiel_nr - spiel2.spiel_nr)} />
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
