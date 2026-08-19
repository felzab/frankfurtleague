import { Card } from "@heroui/react";

import { card } from "@/shared/components/ui/card";

import type { FLTeamStatistik } from "../../schemas";

/**
 * The `statistik_scope=gesamt` figures, which no other surface shows — hence the line under the
 * heading naming the Saisontabelle outright, since the two pages report different numbers.
 */
export function TeamSaisonStatistik({ statistik }: { statistik: FLTeamStatistik }) {
  return (
    <section className="flex flex-col gap-y-4">
      <div className="flex flex-col gap-y-1">
        <h2 className="fluid-lg text-foreground font-extrabold tracking-tight">Saisonstatistik</h2>
        <p className="fluid-xxs text-foreground-muted font-medium">
          Alle Spiele der Saison, inklusive Playoffs. Die Saisontabelle zählt nur die Gruppenphase.
        </p>
      </div>

      {/* Punkte spans the narrow row: an odd card count leaves one alone on two columns, and it is
          the figure the rest produce rather than a peer. Undone at `lg`, where all fit on one row. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[
          { label: "Punkte", value: statistik.punkte, isSummary: true },
          { label: "Spiele", value: statistik.anzahl_gespielte_spiele, isSummary: false },
          { label: "S / U / N", value: `${statistik.siege} / ${statistik.unentschieden} / ${statistik.niederlagen}`, isSummary: false },
          { label: "Tore", value: `${statistik.tore_geschossen}:${statistik.tore_kassiert}`, isSummary: false },
          { label: "Differenz", value: statistik.tore_geschossen - statistik.tore_kassiert, isSummary: false },
        ].map((stat) => (
          <Card
            key={stat.label}
            variant="default"
            // The separating space belongs in the template literal, never inside the string:
            // prettier's Tailwind plugin trims class strings, so the classes would glue together.
            className={`${card()} ${stat.isSummary ? "col-span-2 lg:col-span-1" : ""}`}>
            <Card.Content className="py-4 text-center">
              <p className="fluid-xxs text-foreground-muted mb-1 font-bold tracking-wider uppercase">{stat.label}</p>
              <p className={`text-foreground font-extrabold ${stat.isSummary ? "fluid-xl" : "fluid-lg"}`}>{stat.value}</p>
            </Card.Content>
          </Card>
        ))}
      </div>
    </section>
  );
}
