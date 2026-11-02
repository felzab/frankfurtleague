import { cacheLife, cacheTag } from "next/cache";

import { COPY } from "@/core/copy";
import { saisonsGetLanding } from "@/core/generated/client/sdk";
import { SERVER_COPY } from "@/core/serverCopy";
import { SITE_CACHE_TAG } from "@/core/siteCache";
import { matchRowOf } from "@/features/spiele/blocks";

import type { CalendarDay, Uhrzeit } from "@/core/format";
import type { FLBewerbungWindow, FLLandingResponse, FLLandingSaison, FLLandingSide, FLPodiumPlace } from "@/core/generated/client/types";
import type { Placed } from "@/kit/Podium";
import type { SaisonBlock } from "@/kit/SaisonBlock";
import type { SpielSide } from "@/kit/SpielRow";
import type { Route } from "next";
import type { ComponentProps } from "react";

/** What the season card shows, by the season's state. */
type SaisonState = ComponentProps<typeof SaisonBlock>["state"];

/**
 * The landing's one read: the season the site is on, its state, figures and schools, and the application window
 * open today, which the backend judges by the rule the submission refuses on (D466). Cached under the site-wide
 * tag for minutes, as every league read is, so a save clears it.
 */
export async function readLanding(): Promise<FLLandingResponse> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return saisonsGetLanding();
}

/** The application form for the season whose window is open. */
export const formOf = (window: FLBewerbungWindow) => `/bewerbung/${window.saison_id}` as Route;

/** An opening side's plaque: its club's Kürzel, or the dashed open plaque the Spielplan draws while its slot is empty (D498). */
const plaqueOf = (side: FLLandingSide | null): SpielSide["plaque"] => (side === null ? { quelle: "" } : { kuerzel: side.shorthand });

/** A placed club as the podium names it. */
const clubOf = (place: FLPodiumPlace): Placed => ({ name: place.name, kuerzel: place.shorthand });

/**
 * Where the season stands, as its card beside the hero shows it: before the start, the countdown to the season's
 * start (D499), with its opening match once one is dated; while it runs, its last result once there is one and its
 * next match; once all four places are in, the podium.
 */
export function stateOf(saison: FLLandingSaison): SaisonState {
  switch (saison.state) {
    case "before_start": {
      const kickoff = saison.first_kickoff;
      return {
        kind: "countdown",
        start: saison.start,
        ...(kickoff === null
          ? {}
          : {
              opening: {
                // The schema has already held both to the stored formats.
                when: COPY.spielplan.when(kickoff.datum as CalendarDay, kickoff.uhrzeit as Uhrzeit | null),
                spieltag: SERVER_COPY.landing.saison.spieltag(kickoff.spieltag_position),
                home: plaqueOf(kickoff.team1),
                away: plaqueOf(kickoff.team2),
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
      // The read serves the podium beside `decided` and only there, its four places in their order (D497).
      if (saison.podium === null) throw new Error("A decided season is served with its podium.");
      const [first, second, third, fourth] = saison.podium;
      return { kind: "decided", places: [clubOf(first), clubOf(second), clubOf(third), clubOf(fourth)] };
    }
  }
}
