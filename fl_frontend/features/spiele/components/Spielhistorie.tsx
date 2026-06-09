"use client";

import type { FLSpiel } from "../types";
import SpielDisplayList from "./SpielDisplayList";

export default function Spielhistorie({ spielhistorieData }: { spielhistorieData: FLSpiel[] }) {
  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="w-full flex flex-col items-center pt-4 pb-20 overflow-y-scroll scrollbar-hide">
      <SpielDisplayList
        spiele={spielhistorieData.toSorted((a, b) => a.datum!.localeCompare(b.datum!))}
        today={today}
      />
    </div>
  );
}
