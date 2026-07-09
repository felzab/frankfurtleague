import { connection } from "next/server";

import { getCurrentSeason, getSaisons } from "../../queries"; // Update with your actual queries
import SaisonSelector from "../SaisonSelecter";

export default async function SaisonMetadataDisplay() {
  await connection();
  const [currentSaisonRes, saisonsRes] = await Promise.all([getCurrentSeason(), getSaisons()]);

  return (
    <SaisonSelector
      seasons={saisonsRes.saisons}
      currentSeason={currentSaisonRes.saison}
    />
  );
}
