"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import SpielCardCompact from "@/features/spiele/components/SpielCardCompact";
import ExpandableDescription from "@/shared/components/ui/ExpandableDescription";
import { sortByDate } from "@/shared/utils/date";
import { formatAddress } from "@/shared/utils/format";
import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button, Card } from "@heroui/react";

import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLTeam } from "../../schemas";

function SaisonSpieleTimeline({ spiele, teamId }: { spiele: FLSpiel[]; teamId: string }) {
  // Map results to valid semantic colors
  const getBadgeColor = (result: "W" | "L" | "D" | "?") => {
    switch (result) {
      case "W":
        return "bg-success text-white ring-success/30";
      case "D":
        return "bg-default-400 text-white ring-default-400/30";
      case "L":
        return "bg-danger text-white ring-danger/30";
      default:
        return "bg-default-200 text-default-600 ring-default-200/30";
    }
  };

  return (
    <div className="border-primary-light dark:border-quinary-dark relative ml-2 border-l-2 border-dashed">
      {sortByDate({ arr: spiele, key: "datum" }).map((spielData) => {
        const teamIdx = teamId === spielData.team1.team_id ? 0 : 1;
        const splitErgebnis = spielData.ergebnis && spielData.ergebnis.split(":");
        let result: "W" | "L" | "D" | "?";

        if (!spielData.ergebnis || !splitErgebnis) {
          result = "?";
        } else if (splitErgebnis[0] === splitErgebnis[1]) {
          result = "D";
        } else if (Number(splitErgebnis[teamIdx]) > Number(splitErgebnis[teamIdx === 0 ? 1 : 0])) {
          result = "W";
        } else {
          result = "L";
        }

        return (
          <div
            key={spielData.id}
            className="relative mb-8 pl-6">
            <div
              className={`absolute top-1 left-[-11px] size-[20px] rounded-full ring-4 ${getBadgeColor(result)} flex items-center justify-center text-[10px] font-bold`}>
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
  const teamMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formattedTeamAddress)}`;
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 flex w-full flex-col gap-y-8 duration-400">
      {/* Back Navigation Button */}
      <Button
        onPress={() => {
          router.back();
        }}
        className="bg-quaternary-light dark:bg-quaternary-dark text-fluid-xs -mb-5 size-fit px-2 py-1 brightness-95 lg:px-3">
        <ArrowUturnCwLeft className="h-[16px]! w-[16px]!" />
        Zurück
      </Button>

      {/* Header Info */}
      <div className="flex h-fit w-full flex-col gap-y-0.5">
        <h3 className="text-fluid-xl lg:text-fluid-xl font-extrabold tracking-tight">{teamData.name}</h3>
        {/* Offizieller Schulname */}
        {teamData.full_name && <p className="text-fluid-sm font-semibold">{teamData.full_name}</p>}

        <Link
          target="_blank"
          rel="noopener noreferrer"
          prefetch={false}
          href={teamData.website_url}
          className="text-fluid-xs text-quaternary-light dark:text-quaternary-dark font-semibold hover:underline">
          🌐Zur Schul-Website
        </Link>

        <Link
          href={teamMapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-fluid-xs text-quaternary-light dark:text-quaternary-dark truncate font-semibold hover:underline">
          📍{formattedTeamAddress}
        </Link>
        <ExpandableDescription text={teamData.description} />
      </div>

      {/* Saison Stats - Using variant="secondary" for the inner-panel look */}
      <h4 className="text-fluid-lg -mb-2 font-bold">Saisonstatistik</h4>
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
            variant="secondary"
            className="border-none shadow-none">
            <Card.Content className="py-4 text-center">
              <p className="text-default-500 mb-1 text-xs tracking-wider uppercase">{stat.label}</p>
              <p className="font-secondary text-xl font-bold">{stat.value}</p>
            </Card.Content>
          </Card>
        ))}
        <Card
          key={5}
          variant="secondary"
          className="hidden border-none shadow-none lg:block">
          <Card.Content className="py-4 text-center">
            <p className="text-default-500 mb-1 text-xs tracking-wider uppercase">Punkte</p>
            <p className="font-secondary text-xl font-bold">{teamData.statistik.punkte}</p>
          </Card.Content>
        </Card>
      </div>

      {/* Games Timeline */}
      <div className="mt-4 size-full">
        <h5 className="text-fluid-lg mb-6 font-bold">Saisonspiele</h5>
        <SaisonSpieleTimeline
          spiele={teamSpiele}
          teamId={teamData.id}
        />
      </div>
    </div>
  );
}
