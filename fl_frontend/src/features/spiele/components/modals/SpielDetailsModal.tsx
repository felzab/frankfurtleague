"use client";

import Link from "next/link";

import { CircleInfo } from "@gravity-ui/icons";

import { useServerConfig } from "@/core/providers/ServerConfigProvider";

import { Modal, Separator } from "@heroui/react";

import { computeSpielStatus } from "../../utils";
import SaisonPhaseChip from "../ui/SaisonPhaseChip";
import SpielStatusChip from "../ui/SpielStatusChip";

import type { FLSpiel, FLSpielStatus } from "../../schemas";

export default function SpielDetailsModal({ spielData, isOpen, onClose }: { spielData: FLSpiel | null; isOpen: boolean; onClose: () => void }) {
  const { today } = useServerConfig();

  // Safely compute values outside render tree
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
          className="bg-primary-light dark:bg-primary-dark p-6">
          {spielData && (
            <>
              <Modal.Header className="gap-y-2 pb-4">
                <div className="flex w-full flex-row items-center justify-start gap-x-2">
                  <Modal.Heading className={`text-fluid-xl font-extrabold`}>{`Spiel Nr. ${spielData.spiel_nr}`}</Modal.Heading>
                  <Modal.Icon className="size-6">
                    <CircleInfo className="size-full" />
                  </Modal.Icon>
                </div>
                <div className="w-fullt flex h-fit flex-row items-center justify-start gap-x-2">
                  <SpielStatusChip spielStatus={spielStatus as FLSpielStatus} />
                  <SaisonPhaseChip saisonPhase={spielData.saison_phase} />
                </div>
              </Modal.Header>
              <Modal.Body className="text-text-black dark:text-text-white">
                {/* Teams area */}
                <div className="flex h-fit flex-col items-center justify-center rounded-xl bg-zinc-50 py-4 dark:bg-zinc-800/50">
                  <span className="text-fluid-xl font-bold">{spielData.team1.name}</span>
                  <span className="text-fluid-sm my-1 text-zinc-500">vs</span>
                  <span className="text-fluid-xl font-bold">{spielData.team2.name}</span>
                </div>

                <Separator className="my-4 h-[2px]" />

                {/* Details Grid */}
                <div className="text-fluid-sm grid grid-cols-2 gap-4 whitespace-normal">
                  {/** Datum */}
                  <div>
                    <h4 className="text-zinc-500">Datum</h4>
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">{spielDatum ?? "/"}</p>
                  </div>
                  {/** Uhrzeit */}
                  <div>
                    <h4 className="text-zinc-500">Uhrzeit</h4>
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">{spielData.uhrzeit ?? "/"}</p>
                  </div>
                  {/** Ort */}
                  <div>
                    <h4 className="text-zinc-500">Ort</h4>
                    {spielData.ort ? (
                      <Link
                        href={mapUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-quaternary-light dark:text-quaternary-dark font-semibold hover:underline">
                        {spielData.ort.name}
                      </Link>
                    ) : (
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100">/</p>
                    )}
                  </div>
                  {/** Schiedsrichter */}
                  <div>
                    <h4 className="text-zinc-500">Schiedsrichter</h4>
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">{spielData.schiedsrichter?.name ?? "/"}</p>
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
