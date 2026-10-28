import { Suspense } from "react";

import { RailFrame } from "@/kit/RailFrame";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import { readSaison, seasonMenu } from "./spielplan";

import type { ReactNode } from "react";

/**
 * The public season pages' frame, around each page and the `@modal` slot, where a match opens over the
 * Spielplan as a pop-up. The season is the address's, so the frame waits on it inside `Suspense`.
 */
export default function SaisonLayout({ children, modal, params }: LayoutProps<"/saisons/[saison]">) {
  return (
    <Suspense fallback={null}>
      <SaisonFrame params={params}>
        {children}
        {modal}
      </SaisonFrame>
    </Suspense>
  );
}

async function SaisonFrame({ params, children }: { params: Promise<{ saison: string }>; children: ReactNode }) {
  const { saison, saisons } = await readSaison((await params).saison);
  return (
    <RailFrame
      groups={[{ entries: [{ id: "spielplan", label: COPY.seite.spielplan, href: ROUTES.spielplan.pfad(saison.id), icon: "kalender" }] }]}
      bar={["spielplan"]}
      season={seasonMenu(saison, saisons)}
      foot={{ kind: "anmelden", href: "/signin" }}>
      {children}
    </RailFrame>
  );
}
