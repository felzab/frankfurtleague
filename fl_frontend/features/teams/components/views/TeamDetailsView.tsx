"use client";

import { Button, Card } from "@heroui/react";
import { ArrowUturnCwLeft } from "@gravity-ui/icons";
import type { FLTeam } from "../../types";
import type { FLSpiel } from "@/features/spiele/types";
import SpielCardCompact from "@/features/spiele/components/SpielCardCompact";
import ExpandableDescription from "@/shared/components/ui/ExpandableDescription";
import Link from "next/link";
import { formatAddress } from "@/shared/utils/utils";
import { sortByDate } from "@/shared/utils/utils";
import { useRouter } from "next/navigation";

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
    <div className="relative border-l-2 border-dashed border-primary-light dark:border-quinary-dark ml-2">
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
            className="mb-8 pl-6 relative">
            <div
              className={`absolute left-[-11px] top-1 size-[20px] rounded-full ring-4 ${getBadgeColor(result)} flex items-center justify-center text-[10px] font-bold`}>
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
    <div className="flex flex-col gap-y-8 w-full animate-in fade-in slide-in-from-bottom-4 duration-400 ">
      {/* Back Navigation Button */}
      <Button
        onPress={() => {
          router.back();
        }}
        className="bg-quaternary-light dark:bg-quaternary-dark size-fit text-fluid-xs -mb-5 brightness-95 px-2 lg:px-3 py-1 ">
        <ArrowUturnCwLeft className="w-[16px]! h-[16px]!" />
        Zurück
      </Button>

      {/* Header Info */}
      <div className="flex flex-col gap-y-0.5 w-full h-fit">
        <h3 className="text-fluid-xl lg:text-fluid-xl font-extrabold tracking-tight">{teamData.name}</h3>
        {/* Offizieller Schulname */}
        {teamData.full_name && <p className="text-fluid-sm font-semibold">{teamData.full_name}</p>}

        <Link
          target="_blank"
          rel="noopener noreferrer"
          prefetch={false}
          href={teamData.website_url}
          className="text-fluid-xs font-semibold text-quaternary-light dark:text-quaternary-dark hover:underline">
          🌐Zur Schul-Website
        </Link>

        <Link
          href={teamMapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-fluid-xs truncate font-semibold text-quaternary-light dark:text-quaternary-dark hover:underline">
          📍{formattedTeamAddress}
        </Link>
        <ExpandableDescription text={teamData.description} />
      </div>

      {/* Saison Stats - Using variant="secondary" for the inner-panel look */}
      <h4 className="text-fluid-lg font-bold -mb-2">Saisonstatistik</h4>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
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
            className="shadow-none border-none">
            <Card.Content className="text-center py-4">
              <p className="text-xs text-default-500 uppercase tracking-wider mb-1">{stat.label}</p>
              <p className="text-xl font-bold font-secondary">{stat.value}</p>
            </Card.Content>
          </Card>
        ))}
        <Card
          key={5}
          variant="secondary"
          className=" hidden lg:block shadow-none border-none">
          <Card.Content className="text-center py-4">
            <p className="text-xs text-default-500 uppercase tracking-wider mb-1">Punkte</p>
            <p className="text-xl font-bold font-secondary">{teamData.statistik.punkte}</p>
          </Card.Content>
        </Card>
      </div>

      {/* Games Timeline */}
      <div className="mt-4 size-full">
        <h5 className="text-fluid-lg font-bold mb-6">Saisonspiele</h5>
        <SaisonSpieleTimeline
          spiele={teamSpiele}
          teamId={teamData.id}
        />
      </div>
    </div>
  );
}
