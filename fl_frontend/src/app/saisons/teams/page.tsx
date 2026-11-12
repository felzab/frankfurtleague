import { metadataOf, SaisonlessPage } from "../SaisonlessPage";

export const generateMetadata = metadataOf("saisonsTeams");

export default function SaisonlessTeamsPage() {
  return (
    <SaisonlessPage
      route="saisonsTeams"
      page="teams"
    />
  );
}
