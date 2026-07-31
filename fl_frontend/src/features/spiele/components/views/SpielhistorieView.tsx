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
    <>
      {/* These routes have no visible page title by design, so the `h1` that anchors the heading
          list is visually hidden. The text matches the route's own `metadata.title` (R4 §4.2). */}
      <h1 className="sr-only">Spielhistorie</h1>

      <div
        role="list"
        className="animate-in fade-in slide-in-from-bottom-4 max-w-page mx-auto grid w-full grid-cols-1 gap-5 px-4 pt-6 pb-12 duration-400 sm:grid-cols-2 sm:px-8 xl:grid-cols-3">
        <SpielCardsList
          spiele={spielhistorieData}
          today={today}
        />
      </div>
    </>
  );
}
