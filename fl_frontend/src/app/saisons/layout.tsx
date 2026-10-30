import { RailFrame } from "@/kit/RailFrame";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import { readSeasons } from "./[saison]/spielplan";

import type { ReactNode } from "react";

/**
 * The public season pages' frame. It stands above the `[saison]` segment, whose subtree Next keys on the
 * season, so a season switch remounts the page alone and keeps the frame; the frame reads the season from
 * the address on the client, so nothing here waits.
 */
export default function SaisonsLayout({ children }: { children: ReactNode }) {
  return (
    <RailFrame
      groups={[{ entries: [{ id: "spielplan", label: COPY.seite.spielplan, saison: "spielplan", icon: "spielplan" }] }]}
      bar={["spielplan"]}
      saison={{ saisons: readSeasons(), home: "spielplan" }}
      foot={{ kind: "anmelden", href: ROUTES.anmeldung.path() }}>
      {children}
    </RailFrame>
  );
}
