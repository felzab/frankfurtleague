import { StatusPage } from "@/kit/StatusPage";

import { ROUTES } from "@/core/routes";
import { pageMetadata } from "@/shared/utils/metadata";

import { standardSaisonCard } from "../ownSaison";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.areaSpieler, ROUTES.areaSpieler.path());
}

/** `/area/spieler`: the address „Funktion wechseln“ and a mail lead to, which leads on to a season's Übersicht. */
export default function SpielerPage() {
  return (
    <StatusPage
      frame="rail"
      scope="area"
      title={{ route: "areaSpieler" }}
      card={standardSaisonCard("spieler")}
    />
  );
}
