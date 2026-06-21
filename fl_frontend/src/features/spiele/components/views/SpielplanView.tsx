"use client";

import { Tabs } from "@heroui/react";
import SpielCardsList from "../collections/SpielCardsList";
import type { FLSpielplan } from "@/features/spieltage/schemas";

export default function SpielplanView({ spielplanData }: { spielplanData: FLSpielplan }) {
  return (
    <Tabs className="relative flex items-center justify-start h-full w-full lg:mt-2">
      {/** Container for the list of tabs, that can be selected. Is sticky!! */}
      <Tabs.ListContainer className="sticky flex items-center min-h-[40px] sm:min-h-[50px] max-h-[40px] sm:max-h-[50px] max-w-[95%] px-1 lg:px-0 py-[2px] rounded-2xl bg-tertiary-light dark:bg-tertiary-dark overflow-x-scroll scrollbar-hide z-20">
        <Tabs.List
          className={"flex flex-row items-center justify-between gap-x-1 w-full min-h-fit bg-transparent overflow-x-auto scrollbar-hide"}>
          {/** Tab options */
          spielplanData?.spieltage.map((spieltagData) => {
            return (
              <Tabs.Tab
                key={spieltagData.id}
                id={spieltagData.id}
                className={"max-h-11 text-text-black bg-senary-light dark:bg-senary-dark"}>
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
          className="flex flex-col items-center gap-y-1.5 w-full pt-2 pb-10 overflow-y-scroll scrollbar-hide">
          <SpielCardsList spiele={spieltagData.spiele.sort((spiel1, spiel2) => spiel1.spiel_nr - spiel2.spiel_nr)} />
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
