import { metadataOf, SaisonlessPage } from "./SaisonlessPage";

export const generateMetadata = metadataOf("saisons");

export default function SaisonsPage() {
  return (
    <SaisonlessPage
      route="saisons"
      page="spielplan"
    />
  );
}
