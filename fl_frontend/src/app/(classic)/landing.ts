import { cacheLife, cacheTag } from "next/cache";

import { COPY } from "@/core/copy";
import { dayOf, timeOf } from "@/core/format";
import { saisonsGetLanding } from "@/core/generated/client/sdk";
import { SERVER_COPY } from "@/core/serverCopy";
import { SITE_CACHE_TAG } from "@/core/siteCache";
import { matchRowOf } from "@/features/spiele/blocks";

import type { FLLandingResponse, FLLandingSide } from "@/core/generated/client/types";
import type { Place } from "@/kit/Podium";
import type { SaisonBlock } from "@/kit/SaisonBlock";
import type { ComponentProps } from "react";

/** The season the site is on, one member per state, each carrying the facts that state shows. */
export type LandingSaison = NonNullable<FLLandingResponse["saison"]>;

/** What the season card shows, by the season's state. */
type SaisonState = ComponentProps<typeof SaisonBlock>["state"];

/**
 * The landing's one read: the season the site is on, its state, figures and schools, and the application window
 * open today, which the backend judges by the rule the submission refuses on. Cached under the site-wide tag for
 * minutes, as every league read is, so a save clears it.
 */
export async function readLanding(): Promise<FLLandingResponse> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return saisonsGetLanding();
}

/** An opening side by its club's Kürzel, `null` while its slot is empty, which the card draws as the open plaque. */
const plaqueOf = (side: FLLandingSide | null) => (side === null ? null : { record: side.shorthand });

/** A place as the podium names it: its club, or `null` where it is vacant, its club having left the season by then. */
const clubOf = (side: FLLandingSide | null): Place =>
  side === null ? null : { name: { record: side.name }, plaque: { record: side.shorthand } };

/**
 * Where the season stands, as its card beside the hero shows it: before the start, the countdown to the season's
 * start, with its opening match once one is dated; while it runs, its last result once there is one and its next
 * match; once all four places are in, the podium.
 */
export function stateOf(saison: LandingSaison): SaisonState {
  switch (saison.state) {
    case "before_start": {
      const spiel = saison.opening_spiel;
      return {
        kind: "countdown",
        start: saison.start,
        ...(spiel === null
          ? {}
          : {
              opening: {
                when: COPY.spielplan.when(dayOf(spiel.datum), timeOf(spiel.uhrzeit)),
                spieltag: SERVER_COPY.landing.saison.spieltag(spiel.spieltag_position),
                team1: plaqueOf(spiel.team1),
                team2: plaqueOf(spiel.team2),
              },
            }),
      };
    }
    case "running": {
      const [last] = saison.recent;
      const [next] = saison.upcoming;
      return {
        kind: "running",
        ...(last === undefined ? {} : { last: matchRowOf(last) }),
        ...(next === undefined ? {} : { next: matchRowOf(next) }),
      };
    }
    case "decided": {
      const [first, second, third, fourth] = saison.podium;
      return { kind: "decided", places: [clubOf(first), clubOf(second), clubOf(third), clubOf(fourth)] };
    }
  }
}
