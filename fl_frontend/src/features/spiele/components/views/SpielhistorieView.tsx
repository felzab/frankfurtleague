import { EmptyState } from "@/shared/components/ui/EmptyState";
import { CARDS_CASCADE } from "@/shared/components/ui/motion";

import { SpielCardsList } from "../collections/SpielCardsList";

import type { FLSpiel } from "../../schemas";

export function SpielhistorieView({ spielhistorieData, today }: { spielhistorieData: FLSpiel[]; today: string }) {
  /* Rendered in both branches, not just the populated one: the route must keep its only `h1`
     whether or not the season has data — losing it in the empty state takes the heading away
     exactly when there is least else to orient by. Visually hidden because the design has no page
     title; the text matches the route's own `metadata.title`. */
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

      {/* The cascade, not the block fade this used to carry: a grid of `SpielCard`s is tier 2 in
          `motion.ts`, and the spielplan's identical grid has cascaded since the tab-switch fix. The
          two sat side by side in the same nav with visibly different arrivals. */}
      <div
        role="list"
        className={`${CARDS_CASCADE} max-w-page mx-auto grid w-full grid-cols-1 gap-5 px-4 pt-6 pb-12 sm:grid-cols-2 sm:px-8 xl:grid-cols-3`}>
        <SpielCardsList
          spiele={spielhistorieData}
          today={today}
        />
      </div>
    </>
  );
}
