import { ROUTES } from "@/core/routes";

import { VerwaltungFrame } from "../../../../VerwaltungFrame";

/** The editor's way back: the season's matches, or the seasons where the league holds none. */
const zurueck = (saison: string | undefined) => (saison === undefined ? ROUTES.verwaltungSaisons.pfad() : ROUTES.verwaltungSpiele.pfad(saison));

/**
 * The match editor's frame: the administration's, its way back in the phone's band where the editor's bar
 * takes the bottom bar's place.
 */
export default function SpielEditorLayout({ children, params }: LayoutProps<"/bereich/verwaltung/saisons/[saison]/spiele/[spiel]">) {
  return (
    <VerwaltungFrame
      saison={params.then(({ saison }) => saison)}
      back={zurueck}>
      {children}
    </VerwaltungFrame>
  );
}
