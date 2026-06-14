"use client";

import { Modal, Separator } from "@heroui/react";

import { CircleInfo } from "@gravity-ui/icons";
import Link from "next/link";
import type { FLSpiel } from "../../types";
import SpielStatusChip from "../ui/SpielStatusChip";
import SaisonPhaseChip from "../ui/SaisonPhaseChip";
import { useServerConfig } from "@/core/providers/ServerConfigProvider";
import { computeSpielStatus } from "../../utils";

export default function SpielDetailsModal({ spielData, isOpen, onClose }: { spielData: FLSpiel | null; isOpen: boolean; onClose: () => void }) {
  const { today } = useServerConfig();

  // This breaks the closing animation of the modal, but is definetly the better way
  if (spielData === null) {
    return;
  }

  const spielStatus = computeSpielStatus({
    datum: spielData.datum,
    isCanceled: spielData.is_canceled,
    today,
  });

  const spielDatum = spielData.datum && new Date(spielData.datum).toLocaleDateString("de-de");
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${spielData.ort && encodeURIComponent(spielData.ort)}`;

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={onClose}
      variant="blur">
      <Modal.Container placement="top">
        <Modal.Dialog className="bg-primary-light dark:bg-primary-dark p-6">
          <Modal.Header className="gap-y-2 pb-4">
            <div className="flex flex-row w-full justify-start items-center gap-x-2">
              <Modal.Heading className={`text-fluid-xl font-extrabold`}>{`Spiel Nr. ${spielData.spiel_nr}`}</Modal.Heading>
              <Modal.Icon className="size-6">
                <CircleInfo className="size-full" />
              </Modal.Icon>
            </div>
            <div className="flex flex-row items-center justify-start w-fullt h-fit gap-x-2">
              <SpielStatusChip spielStatus={spielStatus} />
              <SaisonPhaseChip saisonPhase={spielData.saison_phase} />
            </div>
          </Modal.Header>
          <Modal.Body className="text-text-black dark:text-text-white">
            {/* Teams area */}
            <div className="flex flex-col items-center justify-center h-fit py-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl">
              <span className="text-fluid-xl font-bold ">{spielData.team1.name}</span>
              <span className="text-fluid-sm text-zinc-500 my-1">vs</span>
              <span className="text-fluid-xl font-bold ">{spielData.team2.name}</span>
            </div>

            <Separator className="my-4 h-[2px]" />

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-4 text-fluid-sm whitespace-normal">
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
                    className="font-semibold text-quaternary-light dark:text-quaternary-dark hover:underline">
                    {spielData.ort}
                  </Link>
                ) : (
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100">/</p>
                )}
              </div>
              {/** Schiedsrichter */}
              <div>
                <h4 className="text-zinc-500">Schiedsrichter</h4>
                <p className="font-semibold text-zinc-900 dark:text-zinc-100">{spielData.schiedsrichter ?? "/"}</p>
              </div>
            </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
