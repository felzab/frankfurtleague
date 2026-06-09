"use client";

import { Chip, Modal, Separator } from "@heroui/react";

import { Clock, Calendar, CircleInfo, CircleQuestion, CircleCheckFill } from "@gravity-ui/icons";
import Link from "next/link";
import type { FLSpiel } from "../types";
import useMounted from "@/shared/hooks/useMounted";

type GameState = "future" | "past" | "today" | "unknown";

export default function SpielinfoModal({
  spielData,
  today,
  isOpen,
  onClose,
}: {
  spielData: FLSpiel | null;
  today: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const mounted = useMounted();

  // This breaks the closing animation of the modal, but is definetly the better way
  if (spielData === null) {
    return;
  }

  const _computeGameState = (): GameState => {
    if (spielData.datum === null) return "unknown";
    if (spielData.datum > today) return "future";
    if (spielData.datum === today) return "today";
    return "past";
  };
  const gameState = _computeGameState();

  const localeGameDate = mounted && spielData.datum && new Date(spielData.datum).toLocaleDateString("de-de");

  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${spielData.ort && encodeURIComponent(spielData.ort)}`;

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={onClose}
      variant="blur">
      <Modal.Container placement="top">
        <Modal.Dialog className="bg-primary-light dark:bg-primary-dark p-6">
          <Modal.Header className="gap-y-3">
            <div className="flex flex-row w-full justify-start items-center gap-x-2">
              <Modal.Heading className={`text-fluid-xl font-extrabold`}>{`Spiel Nr. ${spielData.spiel_nr}`}</Modal.Heading>
              <Modal.Icon className="size-6">
                <CircleInfo className="size-full" />
              </Modal.Icon>
            </div>
            {gameState === "past" && (
              <Chip
                color="success"
                variant="primary"
                className="w-fit">
                <CircleCheckFill />
                <Chip.Label>Vergangen</Chip.Label>
              </Chip>
            )}
            {gameState === "future" && (
              <Chip
                color="danger"
                variant="primary"
                className="w-fit">
                <Clock />
                <Chip.Label>Ausstehend</Chip.Label>
              </Chip>
            )}
            {gameState === "today" && (
              <Chip
                color="accent"
                variant="primary"
                className="w-fit">
                <Calendar />
                <Chip.Label>Heute</Chip.Label>
              </Chip>
            )}
            {gameState === "unknown" && (
              <Chip
                color="default"
                variant="primary"
                className="w-fit">
                <CircleQuestion />
                <Chip.Label>Unbekannt</Chip.Label>
              </Chip>
            )}
          </Modal.Header>
          <Modal.Body className="text-text-black dark:text-text-white">
            {/* Teams area */}
            <div className="flex flex-col items-center justify-center py-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl">
              <span className="text-fluid-lg font-bold ">{spielData.team1.name}</span>
              <span className="text-fluid-xs text-zinc-500 my-1">vs</span>
              <span className="text-fluid-lg font-bold ">{spielData.team2.name}</span>
            </div>

            <Separator className="my-4 h-[2px]" />

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-4 text-fluid-sm whitespace-normal">
              {/** Datum */}
              <div>
                <h4 className="text-zinc-500">Datum</h4>
                <p className="font-semibold text-zinc-900 dark:text-zinc-100">{localeGameDate ?? "/"}</p>
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
