import { metadataOf, SaisonlessPage } from "../SaisonlessPage";

export const generateMetadata = metadataOf("saisonsTabelle");

export default function SaisonlessTabellePage() {
  return (
    <SaisonlessPage
      route="saisonsTabelle"
      page="tabelle"
    />
  );
}
