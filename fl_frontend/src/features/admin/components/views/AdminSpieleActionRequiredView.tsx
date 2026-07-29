"use client";

import { ChevronsDownWide } from "@gravity-ui/icons";

import { Accordion } from "@heroui/react";

import AdminSpielCardsList from "../collections/AdminSpielCardsList";

import type { FLSpiel } from "@/features/spiele/schemas";

export default function AdminSpieleActionRequiredView({ overviewSpiele, today }: { overviewSpiele: FLSpiel[]; today: string }) {
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
    <div className="relative flex w-full flex-1 flex-col items-center px-4 pt-6 pb-12 sm:px-8">
      <Accordion className="text-foreground flex w-full max-w-[1400px] flex-col gap-y-4">
        {Object.entries(spieleCategories).map(([category, data]) => {
          const hasItems = data.spiele.length > 0;

          return (
            <Accordion.Item
              key={category}
              /* Removed overflow-hidden so nothing gets clipped */
              className="bg-surface border-border rounded-2xl border shadow-sm transition-all">
              <Accordion.Heading>
                <Accordion.Trigger className="hover:bg-muted/80 flex w-full flex-row items-center justify-between rounded-2xl px-6 py-5 text-left transition-colors outline-none">
                  <div className="flex flex-col gap-y-1">
                    <div className="flex items-center gap-x-3">
                      <span className="text-fluid-base text-foreground font-extrabold tracking-tight">{data.name}</span>
                      <span
                        className={`inline-flex items-center justify-center rounded-lg px-2.5 py-0.5 text-xs font-extrabold shadow-sm ${
                          hasItems ? "bg-danger dark:bg-danger/90 text-white" : "bg-success dark:bg-success/90 text-white"
                        }`}>
                        {data.spiele.length}
                      </span>
                    </div>
                    <span className="text-fluid-xxs text-foreground-muted font-medium">{data.desc}</span>
                  </div>
                  <Accordion.Indicator className="text-foreground-muted transition-transform duration-200">
                    <ChevronsDownWide
                      width={18}
                      height={18}
                    />
                  </Accordion.Indicator>
                </Accordion.Trigger>
              </Accordion.Heading>

              <Accordion.Panel>
                <Accordion.Body className="border-border flex w-full flex-col items-center border-t px-2 py-6 lg:px-6">
                  {hasItems ? (
                    <div className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                      <AdminSpielCardsList
                        spiele={data.spiele}
                        today={today}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <p className="text-fluid-sm text-success font-bold">Keine Spiele in dieser Kategorie!</p>
                    </div>
                  )}
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>
    </div>
  );
}
