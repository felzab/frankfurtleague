import { EmptyState } from "@/shared/components/ui/EmptyState";

import { SpielCardsList } from "../collections/SpielCardsList";

import type { FLSpiel } from "../../schemas";

export function SpielhistorieView({ spielhistorieData, today }: { spielhistorieData: FLSpiel[]; today: string }) {
  /* Rendered in both branches, not just the populated one: the route must keep its only `h1`
     whether or not the season has data — losing it in the empty state takes the heading away
     exactly when there is least else to orient by. Visually hidden because the design has no page
     title; the text matches the route's own `metadata.title` (R4 §4.2). */
  const pageHeading = <h1 className="sr-only">Spielhistorie</h1>;

  if (spielhistorieData.length === 0) {
    return (
      <div className="flex w-full flex-1 items-start justify-center p-6">
        {pageHeading}
        <EmptyState
          title="Für diese Saison sind noch keine Spiele gewertet."
          hint="Sobald ein Spiel abgeschlossen und eingetragen ist, erscheint es hier."
        />
      </div>
    );
  }

  return (
    <>
      {pageHeading}

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
