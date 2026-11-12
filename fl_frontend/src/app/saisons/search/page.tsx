import { metadataOf, SaisonlessPage } from "../SaisonlessPage";

export const generateMetadata = metadataOf("saisonsSpielSearch");

export default function SaisonlessSpielSearchPage() {
  return (
    <SaisonlessPage
      route="saisonsSpielSearch"
      page="spielSearch"
    />
  );
}
