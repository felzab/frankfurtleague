"use client";

import Link from "next/link";

import TeamPopoverMenu from "@/features/teams/components/TeamPopoverMenu";
import { useToday } from "@/shared/hooks/useToday";
import { CircleInfo } from "@gravity-ui/icons";

import { Modal, Separator } from "@heroui/react";

import { computeSpielStatus } from "../../utils";
import SaisonPhaseChip from "../ui/SaisonPhaseChip";
import SpielStatusChip from "../ui/SpielStatusChip";

import type { FLSpiel, FLSpielStatus } from "../../schemas";

export default function SpielDetailsModal({ spielData, isOpen, onClose }: { spielData: FLSpiel | null; isOpen: boolean; onClose: () => void }) {
  const today = useToday();

  const spielStatus = spielData
    ? computeSpielStatus({
        datum: spielData.datum,
        isCanceled: spielData.is_canceled,
        today,
      })
    : null;

  const spielDatum = spielData?.datum ? new Date(spielData.datum).toLocaleDateString("de-de") : null;
  const mapUrl = spielData?.ort ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(spielData.ort.maps_link)}` : "";

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={onClose}
      variant="blur">
      <Modal.Container placement="top">
        <Modal.Dialog
          aria-label="Spieldetails-Dialog"
          className="border-border bg-surface rounded-2xl border p-6 shadow-sm">
          {spielData && (
            <>
              <Modal.Header className="gap-y-2 pb-4">
                <div className="flex w-full flex-row items-center justify-start gap-x-2">
                  <Modal.Heading className="text-fluid-lg! text-foreground font-extrabold">{`Spiel Nr. ${spielData.spiel_nr}`}</Modal.Heading>
                  <Modal.Icon className="text-foreground-muted size-5 lg:size-6">
                    <CircleInfo className="size-full" />
                  </Modal.Icon>
                </div>
                <div className="flex h-fit w-full flex-row items-center justify-start gap-x-2">
                  <SpielStatusChip spielStatus={spielStatus as FLSpielStatus} />
                  <SaisonPhaseChip saisonPhase={spielData.saison_phase} />
                </div>
              </Modal.Header>
              <Modal.Body className="text-foreground">
                {/* Teams area (Updated to mirror the inner score box of the SpielCard) */}
                <div className="bg-background border-border flex h-fit flex-col items-center justify-center rounded-xl border py-4 shadow-inner">
                  {/** I just pass teamIsDisqualified=false because it's not included in the game data */}
                  <TeamPopoverMenu
                    teamName={spielData.team1.name}
                    teamId={spielData.team1.team_id}
                    teamIsDisqualified={false}>
                    <span className="text-fluid-xl hover:text-brand font-bold transition-colors duration-200">{spielData.team1.name}</span>
                  </TeamPopoverMenu>

                  <span className="text-fluid-sm text-foreground-muted my-1 font-bold tracking-widest uppercase">vs</span>
                  <TeamPopoverMenu
                    teamName={spielData.team2.name}
                    teamId={spielData.team2.team_id}
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
                    <p className="text-foreground font-bold">{spielDatum ?? "/"}</p>
                  </div>
                  {/** Uhrzeit */}
                  <div>
                    <h4 className="text-foreground-muted font-semibold">Uhrzeit</h4>
                    <p className="text-foreground font-bold">{spielData.uhrzeit ?? "/"}</p>
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
                      <p className="text-foreground font-bold">/</p>
                    )}
                  </div>
                  {/** Schiedsrichter */}
                  <div>
                    <h4 className="text-foreground-muted font-semibold">Schiedsrichter</h4>
                    <p className="text-foreground font-bold">{spielData.schiedsrichter?.name ?? "/"}</p>
                  </div>
                </div>
              </Modal.Body>
            </>
          )}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
