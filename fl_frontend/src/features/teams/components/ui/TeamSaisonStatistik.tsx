import { Card } from "@heroui/react/card";

import { card } from "@/shared/components/ui/card";

import { Tordifferenz } from "./Tordifferenz";

import type { FLTeamStatistik } from "../../schemas";

// Each step is n tiles of 9.5rem plus the `gap-4` between them: 9.5rem is the narrowest tile, at a
// quarter-rem step, holding „15 / 10 / 12“ on one line at its largest type.
const COLUMNS_CLASSES = "@min-[20rem]:grid-cols-2 @min-[51.5rem]:grid-cols-5";

/**
 * The `statistik_scope=gesamt` figures, which no other surface shows — hence the line under the
 * heading naming the Saisontabelle outright, since the two pages report different numbers.
 */
export function TeamSaisonStatistik({ statistik }: { statistik: FLTeamStatistik }) {
  return (
    <section className="flex flex-col gap-y-4">
      <div className="flex flex-col gap-y-1">
        <h2 className="fluid-lg font-extrabold tracking-tight text-foreground">Saisonstatistik</h2>
        <p className="fluid-xxs font-medium text-foreground-muted">
          Alle Spiele der Saison, inklusive Playoffs. Die Saisontabelle zählt nur die Gruppenphase.
        </p>
      </div>

      {/* A query container of its own rather than `CardGrid`, whose `role` would announce one record's
          five figures as a list of records. */}
      <div className="@container">
        {/* Punkte spans the two-column row: an odd card count leaves one alone on two columns, and it
            is the figure the rest produce rather than a peer. Undone at five, where all fit on one row. */}
        <div className={`grid grid-cols-1 gap-4 ${COLUMNS_CLASSES}`}>
          {[
            { label: "Punkte", value: statistik.punkte, isSummary: true },
            { label: "Spiele", value: statistik.anzahl_gespielte_spiele, isSummary: false },
            { label: "S / U / N", value: `${statistik.siege} / ${statistik.unentschieden} / ${statistik.niederlagen}`, isSummary: false },
            { label: "Tore", value: `${statistik.tore_geschossen}:${statistik.tore_kassiert}`, isSummary: false },
            {
              label: "Differenz",
              value: (
                <Tordifferenz
                  geschossen={statistik.tore_geschossen}
                  kassiert={statistik.tore_kassiert}
                />
              ),
              isSummary: false,
            },
          ].map((stat) => (
            <Card
              key={stat.label}
              variant="default"
              // The separating space belongs in the template literal, never inside the string:
              // prettier's Tailwind plugin trims class strings, so the classes would glue together.
              className={`${card()} ${stat.isSummary ? "@min-[20rem]:col-span-2 @min-[51.5rem]:col-span-1" : ""}`}>
              <Card.Content className="py-4 text-center">
                <p className="mb-1 fluid-xxs font-bold tracking-wider text-foreground-muted uppercase">{stat.label}</p>
                {/* „15 / 10 / 12“ broken at a slash reads as two figures; the steps above never force a break. */}
                <p
                  className={`font-numeric font-extrabold whitespace-nowrap text-foreground tabular-nums ${stat.isSummary ? "fluid-xl" : "fluid-lg"}`}>
                  {stat.value}
                </p>
              </Card.Content>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
