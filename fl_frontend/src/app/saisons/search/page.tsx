import { metadataOf, SaisonlessPage } from "../SaisonlessPage";

export const generateMetadata = metadataOf("saisonsSpielSearch");

/** `/saisons/search`: the season's Spielsuche. */
export default function SaisonlessSpielSearchPage() {
  return (
    <SaisonlessPage
      route="saisonsSpielSearch"
      page="spielSearch"
    />
  );
}
