"use client";
import { Button } from "@heroui/react";
import { CircleExclamation, PencilToSquare } from "@gravity-ui/icons";
import { FLSpiel } from "../types";

export default function SpielDisplay({
  spielData,
  onOpenInfoModal,
  onOpenAdminModal,
  adminMode,
}: {
  spielData: FLSpiel;
  onOpenInfoModal: () => void;
  onOpenAdminModal: () => void;
  adminMode: boolean;
}) {
  const gameFinished = spielData.ergebnis !== null;

  return (
    <div
      className={`relative flex flex-col items-center justify-between w-full lg:w-[98%] max-w-[1000px] min-h-25 px-3 py-2 mb-2 rounded-4xl bg-tertiary-light dark:bg-tertiary-dark ${
        gameFinished && "opacity-70"
      }`}>
      {/** The games score (if existent) or a placeholder */}
      <span
        className={`absolute left-6 lg:left-12 top-[50%] -translate-y-1/2 rounded-xl text-fluid-md font-bold  ${
          gameFinished ? "text-green-500" : "text-red-500 "
        }`}>
        {gameFinished ? spielData.ergebnis : "- : -"}
      </span>

      {/** Opens a modal with additional info about the game */}
      <Button
        onPress={onOpenInfoModal}
        aria-label={`Spielinfo Spiel Nr.${spielData.spiel_nr}`}
        autoFocus={false}
        size="sm"
        variant="secondary"
        className="absolute right-3 top-[50%] -translate-y-1/2 rounded-xl w-fit h-fit p-2 bg-quinary-light dark:bg-quinary-dark">
        <CircleExclamation />
      </Button>

      {/** Some basic information about the game */}
      <div className="flex flex-col items-center justify-center w-full">
        <div className="relative flex items-center">
          {/** Date */}
          <h3 className=" text-fluid-lg lg:text-fluid-base font-bold">
            {spielData.datum !== null ? String(new Date(spielData.datum).toLocaleDateString("de-de")) : "N/A"}
          </h3>
          {adminMode && (
            <Button
              onPress={onOpenAdminModal}
              aria-label={`Edit Spiel Nr.${spielData.spiel_nr}`}
              autoFocus={false}
              size="sm"
              variant="secondary"
              className="absolute left-[105%] rounded-xl w-fit h-fit p-2 bg-transparent">
              <PencilToSquare className="w-[clamp(1.25rem,3vw+0.5rem,1.5rem)] h-[clamp(1.25rem,3vw+0.5rem,1.5em)]" />
            </Button>
          )}
        </div>

        {/** Team1 vs. Team2 */}
        <h3 className="text-fluid-xs text-center font-medium min-w-[50%]">
          {spielData.team1.name} VS {spielData.team2.name}
        </h3>
      </div>

      {/** Kick-off time */}
      <span className="text-fluid-xs text-center font-medium min-w-[50%]">{spielData.uhrzeit}</span>
    </div>
  );
}
