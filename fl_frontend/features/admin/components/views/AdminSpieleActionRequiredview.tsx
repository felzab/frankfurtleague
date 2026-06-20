"use client";

import { ChevronsDownWide } from "@gravity-ui/icons";
import { Accordion } from "@heroui/react";
import AdminSpielCardList from "../collections/AdminSpielCardsList";
import { useServerConfig } from "@/core/providers/ServerConfigProvider";
import type { FLSpiel } from "@/features/spiele/schemas";

export default function AdminSpieleActionRequiredView({ overviewSpiele }: { overviewSpiele: FLSpiel[] }) {
  const { today } = useServerConfig();

  const spieleCategories: { [key: string]: { name: string; desc: string; spiele: FLSpiel[] } } = {
    ergebnis_pending: {
      name: "Ergebnis ausstehend",
      desc: "Spiele, die bereits gespielt wurden, aber kein eingetragenes Ergebnis haben",
      spiele: [],
    },
    datum_missing: { name: "Fehlendes Datum", desc: "Spiele ohne eingetragenes Datum", spiele: [] },
    uhrzeit_missing: { name: "Fehlende Uhrzeit", desc: "Spiele ohne eingetragene Uhrzeit", spiele: [] },
    ort_missing: { name: "Fehlender Ort", desc: "Spiele ohne eingetragenen Ort", spiele: [] },
    schiedsrichter_missing: { name: "Fehlender Schiedsrichter", desc: "Spiele ohne eingetragenen Schiedsrichter", spiele: [] },
    is_canceled: { name: "Abgesagt", desc: "Abgesagte Spiele", spiele: [] },
  };

  overviewSpiele.forEach((spiel) => {
    if (spiel.is_canceled) {
      spieleCategories.is_canceled.spiele.push(spiel);
      return;
    }

    if (spiel.datum === null) spieleCategories.datum_missing.spiele.push(spiel);
    if (spiel.uhrzeit === null) spieleCategories.uhrzeit_missing.spiele.push(spiel);
    if (spiel.ort === null) spieleCategories.ort_missing.spiele.push(spiel);
    if (spiel.schiedsrichter === null) spieleCategories.schiedsrichter_missing.spiele.push(spiel);

    if (spiel.datum !== null && spiel.datum < today && spiel.ergebnis === null) {
      spieleCategories.ergebnis_pending.spiele.push(spiel);
    }
  });

  return (
    <Accordion className="flex flex-col h-full w-[98%] max-w-[1550px] p-2 gap-y-2 text-text-black dark:text-text-white overflow-y-scroll scrollbar-hide">
      {Object.entries(spieleCategories).map(([category, data]) => (
        <Accordion.Item key={category}>
          <Accordion.Heading>
            <Accordion.Trigger className="w-full px-3 py-4 rounded-2xl bg-primary-light dark:bg-primary-dark border-2 border-quaternary-light dark:border-quaternary-dark">
              <div className="flex flex-col gap-0">
                <span className="text-fluid-lg font-bold tracking-tighter">{data.name}</span>
                <span className="text-fluid-xxs font-normal tracking-tighter text-muted/80 whitespace-normal leading-normal">{data.desc}</span>
              </div>
              <Accordion.Indicator>
                <ChevronsDownWide />
              </Accordion.Indicator>
            </Accordion.Trigger>
          </Accordion.Heading>

          <Accordion.Panel>
            <Accordion.Body className="flex flex-col items-center w-full pt-4 pb-10 overflow-y-scroll scrollbar-hide px-0">
              <AdminSpielCardList spiele={data.spiele} />

              {data.spiele.length === 0 && <span className="text-fluid-base"> Alles passt!</span>}
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}
