"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button, Card } from "@heroui/react";

import SpielCardCompact from "@/features/spiele/components/SpielCardCompact";
import { computeErgebnisFor } from "@/features/spiele/utils";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import ExpandableDescription from "@/shared/components/ui/ExpandableDescription";
import { sortByDate } from "@/shared/utils/date";
import { buildMapsSearchUrl, formatAddress } from "@/shared/utils/format";

import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLSpielErgebnisFor } from "@/features/spiele/utils";
import type { FLTeam } from "../../schemas";

function SaisonSpieleTimeline({ spiele, teamId }: { spiele: FLSpiel[]; teamId: string }) {
  // Map results to valid semantic colors
  const getBadgeColor = (result: FLSpielErgebnisFor) => {
    switch (result) {
      case "W":
        return "bg-success text-white ring-success/30";
      case "D":
        return "bg-warning text-white ring-warning/30";
      case "L":
        return "bg-danger text-white ring-danger/30";
      default:
        return "bg-muted text-foreground-muted ring-border";
    }
  };

  // Without this the empty case renders the dashed rail with no items -- a bare vertical line
  // under the "Saisonspiele" heading (R4 §12.2).
  if (spiele.length === 0) {
    return (
      <EmptyState
        title="Für diese Saison sind noch keine Spiele angesetzt."
        hint="Sobald der Spielplan steht, erscheinen die Begegnungen dieses Teams hier."
      />
    );
  }

  return (
    <div className="border-border relative ml-2 border-l-2 border-dashed">
      {sortByDate({ arr: spiele, key: "datum" }).map((spielData) => {
        const result = computeErgebnisFor({ spiel: spielData, teamId });

        return (
          <div
            key={spielData.id}
            className="relative mb-8 pl-6">
            <div
              className={`absolute top-4 left-[-11px] size-[20px] rounded-full ring-4 ${getBadgeColor(result)} flex items-center justify-center text-[10px] font-bold shadow-sm`}>
              {result}
            </div>

            <SpielCardCompact spielData={spielData} />
          </div>
        );
      })}
    </div>
  );
}

export default function TeamDetailsView({ teamData, teamSpiele }: { teamData: FLTeam; teamSpiele: FLSpiel[] }) {
  const router = useRouter();

  const formattedTeamAddress = formatAddress(teamData.address);
  // Deliberately formatAddress, not formatAddressFull: a team has no venue name to search by.
  const teamMapUrl = buildMapsSearchUrl(formattedTeamAddress);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 flex w-full flex-col gap-y-8 pb-12 duration-400">
      {/* Back Navigation Button */}
      <Button
        onPress={() => {
          router.back();
        }}
        className="bg-surface border-border text-foreground hover:bg-muted text-fluid-xs mb-[-12px] flex h-10 w-fit items-center gap-x-2 rounded-xl border px-4 font-bold shadow-sm transition-colors">
        <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
        <span>Zurück</span>
      </Button>

      {/* Header Info Card */}
      <div className="bg-surface border-border flex w-full flex-col gap-y-1.5 rounded-2xl border p-4 shadow-sm">
        <h3 className="text-fluid-xl text-foreground font-extrabold tracking-tight">{teamData.name}</h3>

        {/* Offizieller Schulname. No emptiness guard: both schemas now require it (R3a-B1.3). */}
        <p className="text-fluid-xs text-foreground-muted -mt-1.5 font-semibold">{teamData.full_name}</p>

        <div className="flex flex-col gap-y-1 pt-2">
          <Link
            target="_blank"
            rel="noopener noreferrer"
            prefetch={false}
            href={teamData.website_url}
            className="text-fluid-xs text-brand font-bold hover:underline">
            🌐 Schul-Website öffnen
          </Link>

          <Link
            href={teamMapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fluid-xs text-brand font-bold hover:underline">
            📍 {formattedTeamAddress}
          </Link>
        </div>

        {teamData.description && (
          <div className="mt-2 pt-2">
            <ExpandableDescription text={teamData.description} />
          </div>
        )}
      </div>

      {/* Saison Stats Section */}
      <div className="flex flex-col gap-y-4">
        <h4 className="text-fluid-lg text-foreground font-extrabold tracking-tight">Saisonstatistik</h4>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {[
            { label: "Spiele", value: teamData.statistik.anzahl_gespielte_spiele },
            {
              label: "S - U - N",
              value: `${teamData.statistik.siege} - ${teamData.statistik.unentschieden} - ${teamData.statistik.niederlagen}`,
            },
            { label: "Tore", value: `${teamData.statistik.tore_geschossen}:${teamData.statistik.tore_kassiert}` },
            { label: "Differenz", value: teamData.statistik.tore_geschossen - teamData.statistik.tore_kassiert },
          ].map((stat, i) => (
            <Card
              key={i}
              variant="default"
              className="bg-surface border-border text-foreground rounded-xl border shadow-sm">
              <Card.Content className="py-4 text-center">
                <p className="text-fluid-xxs text-foreground-muted mb-1 font-bold tracking-wider uppercase">{stat.label}</p>
                <p className="text-fluid-lg text-foreground font-extrabold">{stat.value}</p>
              </Card.Content>
            </Card>
          ))}
          <Card
            key={5}
            variant="secondary"
            className="bg-surface border-border text-foreground hidden rounded-xl border shadow-sm lg:block">
            <Card.Content className="py-4 text-center">
              <p className="text-fluid-xxs text-foreground-muted mb-1 font-bold tracking-wider uppercase">Punkte</p>
              <p className="text-fluid-lg text-foreground font-extrabold">{teamData.statistik.punkte}</p>
            </Card.Content>
          </Card>
        </div>
      </div>

      {/* Games Timeline */}
      <div className="mt-4 size-full">
        <h5 className="text-fluid-lg text-foreground mb-6 font-extrabold tracking-tight">Saisonspiele</h5>
        <SaisonSpieleTimeline
          spiele={teamSpiele}
          teamId={teamData.id}
        />
      </div>
    </div>
  );
}
