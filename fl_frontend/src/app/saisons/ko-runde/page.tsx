import { metadataOf, SaisonlessPage } from "../SaisonlessPage";

export const generateMetadata = metadataOf("saisonsKORunde");

/** `/saisons/ko-runde`: the season's K.-o.-Runde. */
export default function SaisonlessKORundePage() {
  return (
    <SaisonlessPage
      route="saisonsKORunde"
      page="kORunde"
    />
  );
}
