import { ROUTES } from "@/core/routes";
import { pageMetadata } from "@/shared/utils/metadata";

import { standardSaison } from "../ownSaison";
import { SpielerOverview } from "./[saison]/page";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.areaSpieler, ROUTES.areaSpieler.path());
}

/** `/area/spieler`: the address „Funktion wechseln“ and a mail lead to, drawing the standard season's Übersicht in place. */
export default function SpielerPage() {
  return <SpielerOverview saison={standardSaison("spieler")} />;
}
