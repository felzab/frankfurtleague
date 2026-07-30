"use client";

import Link from "next/link";

import { CircleInfo } from "@gravity-ui/icons";

import { Separator } from "@heroui/react";

import TeamPopoverMenu from "@/features/teams/components/TeamPopoverMenu";
import { ModalShell } from "@/shared/components/ui/ModalShell";
import { buildMapsSearchUrl, PLACEHOLDER } from "@/shared/utils/format";

import { computeSpielStatus, formatSpielDisplay } from "../../utils";
import SaisonPhaseChip from "../ui/SaisonPhaseChip";
import SpielStatusChip from "../ui/SpielStatusChip";

import type { FLSpiel } from "../../schemas";

export default function SpielDetailsModal({
  spielData,
  isOpen,
  onClose,
  today,
}: {
  spielData: FLSpiel | null;
  isOpen: boolean;
  onClose: () => void;
  today: string;
}) {
  // Searches the Spielort's stored maps_link, not an address -- the embedded copy carries no
  // FLAddress, so this query is genuinely different from the other two call sites.
  const mapUrl = spielData?.ort ? buildMapsSearchUrl(spielData.ort.maps_link) : "";

  if (!spielData) return null;

  const { datum: spielDatum, uhrzeit: spielUhrzeit } = formatSpielDisplay(spielData);

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      heading={`Spiel Nr. ${spielData.spiel_nr}`}
      dialogProps={{ "aria-label": "Spieldetails-Dialog" }}
      icon={<CircleInfo className="text-foreground-muted size-5 shrink-0 lg:size-6" />}
      headerExtra={
        <div className="flex h-fit w-full flex-row items-center justify-start gap-x-2 pt-2">
          {/* Computed inside the guard, so narrowing flows and no cast is needed. */}
          <SpielStatusChip spielStatus={computeSpielStatus({ datum: spielData.datum, isCanceled: spielData.is_canceled, today })} />
          <SaisonPhaseChip saisonPhase={spielData.saison_phase} />
        </div>
      }>
      <>
        {/* Teams area  */}
        <div className="bg-background border-border flex h-fit flex-col items-center justify-center rounded-xl border py-4 shadow-inner">
          {/** I just pass teamIsDisqualified=false because it's not included in the game data */}
          <TeamPopoverMenu
            teamName={spielData.team1.name}
            teamId={spielData.team1.team_id}
            teamShorthand={spielData.team1.shorthand}
            teamIsDisqualified={false}>
            <span className="text-fluid-xl hover:text-brand font-bold transition-colors duration-200">{spielData.team1.name}</span>
          </TeamPopoverMenu>

          <span className="text-fluid-sm text-foreground-muted my-1 font-bold tracking-widest uppercase">vs</span>
          <TeamPopoverMenu
            teamName={spielData.team2.name}
            teamId={spielData.team2.team_id}
            teamShorthand={spielData.team2.shorthand}

            teamIsDisqualified={false}>
            <span className="text-fluid-xl hover:text-brand font-bold transition-colors duration-200">{spielData.team2.name}</span>
          </TeamPopoverMenu>
        </div>

        <Separator className="bg-border my-4 h-[2px]" />

        {/* Details Grid */}
        <div className="text-fluid-sm grid grid-cols-2 gap-4 whitespace-normal">
          {/** Datum */}
          <div>
            <h4 className="text-foreground-muted font-semibold">Datum</h4>
            <p className="text-foreground font-bold">{spielDatum}</p>
          </div>
          {/** Uhrzeit */}
          <div>
            <h4 className="text-foreground-muted font-semibold">Uhrzeit</h4>
            <p className="text-foreground font-bold">{spielUhrzeit}</p>
          </div>
          {/** Ort */}
          <div>
            <h4 className="text-foreground-muted font-semibold">Ort</h4>
            {spielData.ort ? (
              <Link
                href={mapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:text-brand/80 font-bold transition-colors hover:underline">
                {spielData.ort.name}
              </Link>
            ) : (
              <p className="text-foreground font-bold">{PLACEHOLDER.entity}</p>
            )}
          </div>
          {/** Schiedsrichter */}
          <div>
            <h4 className="text-foreground-muted font-semibold">Schiedsrichter</h4>
            <p className="text-foreground font-bold">{spielData.schiedsrichter?.name ?? PLACEHOLDER.entity}</p>
          </div>
        </div>
      </>
    </ModalShell>
  );
}
