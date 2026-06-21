"use client";

import { Tabs } from "@heroui/react";

import SpielCardsList from "../collections/SpielCardsList";

import type { FLSpielplan } from "@/features/spieltage/schemas";

export default function SpielplanView({ spielplanData }: { spielplanData: FLSpielplan }) {
  return (
    <Tabs className="relative flex h-full w-full items-center justify-start lg:mt-2">
      {/** Container for the list of tabs, that can be selected. Is sticky!! */}
      <Tabs.ListContainer className="bg-tertiary-light dark:bg-tertiary-dark scrollbar-hide sticky z-20 flex max-h-[40px] min-h-[40px] max-w-[95%] items-center overflow-x-scroll rounded-2xl px-1 py-[2px] sm:max-h-[50px] sm:min-h-[50px] lg:px-0">
        <Tabs.List
          className={"scrollbar-hide flex min-h-fit w-full flex-row items-center justify-between gap-x-1 overflow-x-auto bg-transparent"}>
          {/** Tab options */
          spielplanData?.spieltage.map((spieltagData) => {
            return (
              <Tabs.Tab
                key={spieltagData.id}
                id={spieltagData.id}
                className={"text-text-black bg-senary-light dark:bg-senary-dark max-h-11"}>
                {spieltagData.name}
                <Tabs.Indicator className={"bg-quaternary-light dark:bg-quaternary-dark"} />
              </Tabs.Tab>
            );
          })}
        </Tabs.List>
      </Tabs.ListContainer>
      {/** A panel is generated for each game-day */
      spielplanData?.spieltage.map((spieltagData) => (
        <Tabs.Panel
          key={spieltagData.id}
          id={spieltagData.id}
          className="scrollbar-hide flex w-full flex-col items-center gap-y-1.5 overflow-y-scroll pt-2 pb-10">
          <SpielCardsList spiele={spieltagData.spiele.sort((spiel1, spiel2) => spiel1.spiel_nr - spiel2.spiel_nr)} />
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
