import { metadataOf, SaisonlessPage } from "../SaisonlessPage";

export const generateMetadata = metadataOf("saisonsTabelle");

/** `/saisons/tabelle`: the season's Tabelle. */
export default function SaisonlessTabellePage() {
  return (
    <SaisonlessPage
      route="saisonsTabelle"
      page="tabelle"
    />
  );
}
