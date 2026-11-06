import { metadataOf, SaisonlessPage } from "../SaisonlessPage";

export const generateMetadata = metadataOf("saisonsTeams");

/** `/saisons/teams`: the season's Teams. */
export default function SaisonlessTeamsPage() {
  return (
    <SaisonlessPage
      route="saisonsTeams"
      page="teams"
    />
  );
}
