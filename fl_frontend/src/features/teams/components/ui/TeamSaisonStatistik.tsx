/**
 * TEAMS · the season's figures
 *
 * The figures the page asks `GET /teams` for at `statistik_scope=gesamt`, which counts every phase —
 * this is the only surface that shows them (ADR-0022). The line under the heading is what keeps them
 * from reading as a bug beside the Saisontabelle's group-phase figures.
 */

import { Card } from "@heroui/react";

import { card } from "@/shared/components/ui/card";

import type { FLTeamStatistik } from "../../schemas";

export function TeamSaisonStatistik({ statistik }: { statistik: FLTeamStatistik }) {
  return (
    <section className="flex flex-col gap-y-4">
      <div className="flex flex-col gap-y-1">
        <h3 className="fluid-lg text-foreground font-extrabold tracking-tight">Saisonstatistik</h3>
        <p className="fluid-xxs text-foreground-muted font-medium">Alle Spiele der Saison, inklusive Playoffs.</p>
      </div>

      {/* Five cards, one code path. Two columns on a phone leave the fifth alone on its row, so it
          takes the whole width there rather than being hidden — "Punkte" is the figure a reader
          scanning a league site came for. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[
          { label: "Spiele", value: statistik.anzahl_gespielte_spiele },
          { label: "S - U - N", value: `${statistik.siege} - ${statistik.unentschieden} - ${statistik.niederlagen}` },
          { label: "Tore", value: `${statistik.tore_geschossen}:${statistik.tore_kassiert}` },
          { label: "Differenz", value: statistik.tore_geschossen - statistik.tore_kassiert },
          { label: "Punkte", value: statistik.punkte },
        ].map((stat) => (
          <Card
            key={stat.label}
            variant="default"
            className={`${card()} max-lg:last:col-span-2`}>
            <Card.Content className="py-4 text-center">
              <p className="fluid-xxs text-foreground-muted mb-1 font-bold tracking-wider uppercase">{stat.label}</p>
              <p className="fluid-lg text-foreground font-extrabold">{stat.value}</p>
            </Card.Content>
          </Card>
        ))}
      </div>
    </section>
  );
}
