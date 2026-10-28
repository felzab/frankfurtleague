import { RailFrame } from "@/kit/RailFrame";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import { readSeasons } from "./spielplan";

/**
 * The public season pages' frame, around each page and the `@modal` slot, where a match opens over the
 * Spielplan as a pop-up. The frame reads the season from the address on the client, so nothing here waits.
 */
export default function SaisonLayout({ children, modal }: LayoutProps<"/saisons/[saison]">) {
  return (
    <RailFrame
      groups={[{ entries: [{ id: "spielplan", label: COPY.seite.spielplan, season: "spielplan", icon: "kalender" }] }]}
      bar={["spielplan"]}
      season={{ seasons: readSeasons(), home: "spielplan" }}
      foot={{ kind: "anmelden", href: ROUTES.anmeldung.pfad() }}>
      {children}
      {modal}
    </RailFrame>
  );
}
