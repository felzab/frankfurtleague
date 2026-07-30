"use client";

import SpielCardsList from "../collections/SpielCardsList";

import type { FLSpiel } from "../../schemas";

export default function SpielhistorieView({ spielhistorieData, today }: { spielhistorieData: FLSpiel[]; today: string }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 max-w-page mx-auto grid w-full grid-cols-1 gap-5 px-4 pt-6 pb-12 duration-400 sm:grid-cols-2 sm:px-8 xl:grid-cols-3">
      <SpielCardsList
        spiele={spielhistorieData}
        today={today}
      />
    </div>
  );
}
