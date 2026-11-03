import { connection } from "next/server";

import { RailFrame } from "@/kit/RailFrame";

import { formatPeriod } from "@/core/format";
import { ROUTES, SAISON_PAGES } from "@/core/routes";
import { getSaisonFrame } from "@/features/saisons/queries";

import type { CalendarDay } from "@/core/format";
import type { Saisons } from "@/kit/FrameNav";
import type { ReactNode } from "react";

/**
 * The season button's seasons: every season the public may read, the newest first, and the one the site is on
 * as the standard; `null` while the league has none. Read at request time, so the frame's prerendered shell holds
 * none: the image's build reaches no backend.
 */
async function readSeasons(): Promise<Saisons | null> {
  await connection();
  const { saisons, active_saison_id: active } = await getSaisonFrame();
  if (active === null) return null;
  return {
    // The season's own strings, which its schema has already held to the stored format.
    entries: saisons.map((saison) => ({ id: saison.id, span: formatPeriod(saison.start_date as CalendarDay, saison.end_date as CalendarDay) })),
    standard: active,
  };
}

/**
 * The public season pages' frame. It stands above the `[saison]` segment, whose subtree Next keys on the
 * season, so a season switch remounts the page alone and keeps the frame; the frame reads the season from
 * the address on the client, so nothing here waits.
 */
export default function SaisonsLayout({ children }: { children: ReactNode }) {
  return (
    <RailFrame
      groups={[{ entries: SAISON_PAGES.map((page) => ({ id: page, label: ROUTES[page].title, saison: page, icon: page })) }]}
      bar={SAISON_PAGES}
      saison={{ saisons: readSeasons(), home: "spielplan" }}
      foot={{ kind: "signIn", href: ROUTES.signIn.path() }}>
      {children}
    </RailFrame>
  );
}
