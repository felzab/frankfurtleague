import { metadataOf, SaisonlessPage } from "../SaisonlessPage";

export const generateMetadata = metadataOf("saisonsKORunde");

export default function SaisonlessKORundePage() {
  return (
    <SaisonlessPage
      route="saisonsKORunde"
      page="kORunde"
    />
  );
}
