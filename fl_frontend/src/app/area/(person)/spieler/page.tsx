import { ROUTES } from "@/core/routes";
import { pageMetadata } from "@/shared/utils/metadata";

import { standardSaison } from "../ownSaison";
import { SpielerOverview } from "./SpielerOverview";

export const metadata = pageMetadata(ROUTES.areaSpieler);

/** `/area/spieler`: the address „Funktion wechseln“ and a mail lead to, drawing the standard season's Übersicht in place. */
export default function SpielerPage() {
  return <SpielerOverview saison={standardSaison("spieler")} />;
}
