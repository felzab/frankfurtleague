import { metadataOf, SaisonlessPage } from "./SaisonlessPage";

export const generateMetadata = metadataOf("saisons");

/** `/saisons`: the season's Spielplan. */
export default function SaisonsPage() {
  return (
    <SaisonlessPage
      route="saisons"
      page="spielplan"
    />
  );
}
