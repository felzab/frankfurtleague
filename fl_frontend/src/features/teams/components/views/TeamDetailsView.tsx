"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button, Card } from "@heroui/react";

import { SpielDetailsModal } from "@/features/spiele/components/modals/SpielDetailsModal";
import { SpielCardCompact } from "@/features/spiele/components/ui/SpielCardCompact";
import { computeErgebnisFor } from "@/features/spiele/utils";
import { card } from "@/shared/components/ui/card";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { ExpandableDescription } from "@/shared/components/ui/ExpandableDescription";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { sortByDate } from "@/shared/utils/date";
import { buildMapsSearchUrl, formatAddress } from "@/shared/utils/format";

import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLSpielErgebnisFor } from "@/features/spiele/utils";
import type { FLTeam } from "../../schemas";

function SaisonSpieleTimeline({ spiele, teamId, onOpenSpiel }: { spiele: FLSpiel[]; teamId: string; onOpenSpiel: (spiel: FLSpiel) => void }) {
  /**
   * The W/D/L dots are 10px bold glyphs on an opaque fill, so they need the `-solid` fills rather
   * than the tint-grade accents. On the plain accents a white "D" measured 1.92:1
   * in the light theme and 1.32:1 in dark — the draw marker was effectively invisible. The ring
   * stays on the tint accent: it is decoration around the dot, not a foreground.
   */
  const getBadgeColor = (ergebnisFor: FLSpielErgebnisFor) => {
    switch (ergebnisFor) {
      case "W":
        return "bg-success-solid text-success-solid-foreground ring-success/30";
      case "D":
        return "bg-warning-solid text-warning-solid-foreground ring-warning/30";
      case "L":
        return "bg-danger-solid text-danger-solid-foreground ring-danger/30";
      default:
        return "bg-muted text-foreground-muted ring-border";
    }
  };

  // Without this the empty case renders the dashed rail with no items -- a bare vertical line
  // under the "Saisonspiele" heading.
  if (spiele.length === 0) {
    return (
      <EmptyState
        title="Für diese Saison sind noch keine Spiele angesetzt."
        hint="Sobald der Spielplan steht, erscheinen die Begegnungen dieses Teams hier."
      />
    );
  }

  return (
    // Same list semantics as the six card grids: this is a repeated collection too, so a
    // screen-reader user gets a count and a position here as well.
    <div
      role="list"
      className="border-border relative ml-2 border-l-2 border-dashed">
      {sortByDate({ arr: spiele, key: "datum" }).map((spielData) => {
        const ergebnisFor = computeErgebnisFor({ spiel: spielData, teamId });

        return (
          <div
            role="listitem"
            key={spielData.id}
            className="relative mb-8 pl-6">
            <div
              className={`absolute top-4 left-[-11px] size-[20px] rounded-full ring-4 ${getBadgeColor(ergebnisFor)} flex items-center justify-center text-[10px] font-bold shadow-sm`}>
              {ergebnisFor}
            </div>

            <SpielCardCompact
              spielData={spielData}
              onOpenInfoModal={() => onOpenSpiel(spielData)}
            />
          </div>
        );
      })}
    </div>
  );
}

export function TeamDetailsView({ teamData, teamSpiele, today }: { teamData: FLTeam; teamSpiele: FLSpiel[]; today: string }) {
  const router = useRouter();
  // One modal for the whole timeline, PlayoffsView-style.
  const [selectedSpiel, setSelectedSpiel] = useState<FLSpiel | null>(null);

  const formattedTeamAddress = formatAddress(teamData.address);
  // Deliberately formatAddress, not formatAddressFull: a team has no venue name to search by.
  const teamMapUrl = buildMapsSearchUrl(formattedTeamAddress);

  return (
    <div className={`${PAGE_RISE} flex w-full flex-col gap-y-8 pb-12`}>
      <Button
        onPress={() => {
          router.back();
        }}
        className="bg-surface border-border text-foreground hover:bg-muted fluid-xs mb-[-12px] flex h-10 w-fit items-center gap-x-2 rounded-xl border px-4 font-bold shadow-sm transition-colors">
        <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
        <span>Zurück</span>
      </Button>

      <div className={`${card()} flex w-full flex-col gap-y-1.5 p-4`}>
        <h2 className="fluid-xl text-foreground font-extrabold tracking-tight">{teamData.name}</h2>

        {/* Offizieller Schulname. No emptiness guard: both schemas now require it. */}
        <p className="fluid-xs text-foreground-muted -mt-1.5 font-semibold">{teamData.full_name}</p>

        <div className="flex flex-col gap-y-1 pt-2">
          <Link
            target="_blank"
            rel="noopener noreferrer"
            prefetch={false}
            href={teamData.website_url}
            className="fluid-xs text-brand font-bold hover:underline">
            🌐 Schul-Website öffnen
          </Link>

          <Link
            href={teamMapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="fluid-xs text-brand font-bold hover:underline">
            📍 {formattedTeamAddress}
          </Link>
        </div>

        {teamData.description && (
          <div className="mt-2 pt-2">
            <ExpandableDescription text={teamData.description} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-y-4">
        <div className="flex flex-col gap-y-1">
          <h2 className="fluid-lg text-foreground font-extrabold tracking-tight">Saisonstatistik</h2>
          {/* The counterpart to the Saisontabelle's line: this page counts every phase, the table
              counts the Gruppenphase, and without both lines the differing numbers read as a bug. */}
          <p className="fluid-xxs text-foreground-muted font-medium">Alle Spiele der Saison, inklusive Playoffs.</p>
        </div>

        {/* Five cards, one code path — including "Punkte", which differs from the other four only by
            `desktopOnly`. Lifting it out of the map would mean a hand-written key alongside the map's
            own indices, and a variant that renders identically to the default. */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {[
            { label: "Spiele", value: teamData.statistik.anzahl_gespielte_spiele, desktopOnly: false },
            {
              label: "S - U - N",
              value: `${teamData.statistik.siege} - ${teamData.statistik.unentschieden} - ${teamData.statistik.niederlagen}`,
              desktopOnly: false,
            },
            { label: "Tore", value: `${teamData.statistik.tore_geschossen}:${teamData.statistik.tore_kassiert}`, desktopOnly: false },
            {
              label: "Differenz",
              value: teamData.statistik.tore_geschossen - teamData.statistik.tore_kassiert,
              desktopOnly: false,
            },
            { label: "Punkte", value: teamData.statistik.punkte, desktopOnly: true },
          ].map((stat) => (
            <Card
              key={stat.label}
              variant="default"
              // The separating space belongs in the template literal, not inside the string:
              // prettier's Tailwind plugin trims class strings, so a leading space written as
              // `" hidden lg:block"` is silently removed and the classes glue together.
              className={`${card()} ${stat.desktopOnly ? "hidden lg:block" : ""}`}>
              <Card.Content className="py-4 text-center">
                <p className="fluid-xxs text-foreground-muted mb-1 font-bold tracking-wider uppercase">{stat.label}</p>
                <p className="fluid-lg text-foreground font-extrabold">{stat.value}</p>
              </Card.Content>
            </Card>
          ))}
        </div>
      </div>

      <div className="mt-4 size-full">
        <h2 className="fluid-lg text-foreground mb-6 font-extrabold tracking-tight">Saisonspiele</h2>
        <SaisonSpieleTimeline
          spiele={teamSpiele}
          teamId={teamData.id}
          onOpenSpiel={setSelectedSpiel}
        />
      </div>

      {/* Guarded like `SpielCardsList`'s: no overlay tree until a card is opened. */}
      {selectedSpiel && (
        <SpielDetailsModal
          spielData={selectedSpiel}
          today={today}
          isOpen={true}
          onClose={() => setSelectedSpiel(null)}
        />
      )}
    </div>
  );
}
