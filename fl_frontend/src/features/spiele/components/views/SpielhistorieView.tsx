"use client";

import { EmptyState } from "@/shared/components/ui/EmptyState";

import SpielCardsList from "../collections/SpielCardsList";

import type { FLSpiel } from "../../schemas";

export default function SpielhistorieView({ spielhistorieData, today }: { spielhistorieData: FLSpiel[]; today: string }) {
  if (spielhistorieData.length === 0) {
    return (
      <div className="flex w-full flex-1 items-start justify-center p-6">
        <EmptyState
          title="Für diese Saison sind noch keine Spiele gewertet."
          hint="Sobald ein Spiel abgeschlossen und eingetragen ist, erscheint es hier."
        />
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 max-w-page mx-auto grid w-full grid-cols-1 gap-5 px-4 pt-6 pb-12 duration-400 sm:grid-cols-2 sm:px-8 xl:grid-cols-3">
      <SpielCardsList
        spiele={spielhistorieData}
        today={today}
      />
    </div>
  );
}
