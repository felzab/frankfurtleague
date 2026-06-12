import type { FLTeamWithSpieler } from "../types";

export default function TeamStatsPreview({ teamData }: { teamData: FLTeamWithSpieler }) {
  return (
    <div className="flex flex-row justify-between items-center w-full lg:w-[90%] h-fit text-fluid-xs lg:text-fluid-sm py-5 px-2">
      <span className=" font-semibold text-text-black dark:text-text-white">{`Punkte: ${teamData.statistik.punkte}`}</span>
      <div className=" font-semibold text-text-black dark:text-text-white">
        <span>{"S-U-N: "}</span>
        <span className="text-green-600">{teamData.statistik.siege}</span>-
        <span className="text-yellow-400">{teamData.statistik.unentschieden}</span>-
        <span className="text-red-600">{teamData.statistik.niederlagen}</span>
      </div>

      <span className="hidden lg:block font-semibold text-text-black dark:text-text-white">{`Tordifferenz: ${
        teamData.statistik.tore_geschossen - teamData.statistik.tore_kassiert
      }`}</span>
      <span className="lg:hidden font-semibold text-text-black dark:text-text-white">{`Diff.: ${
        teamData.statistik.tore_geschossen - teamData.statistik.tore_kassiert
      }`}</span>
      <span className=" font-semibold text-text-black dark:text-text-white">{`Spieler: ${teamData.spieler.length}`}</span>
    </div>
  );
}
