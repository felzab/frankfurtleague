import { connection } from "next/server";

import { getCurrentSaison, getSaisons } from "../../queries";
import { SaisonSelector } from "./SaisonSelector";

export async function SaisonMetadataDisplay() {
  await connection();
  const [currentSaisonRes, saisonsRes] = await Promise.all([getCurrentSaison(), getSaisons()]);

  return (
    <SaisonSelector
      saisons={saisonsRes.saisons}
      currentSaison={currentSaisonRes.saison}
    />
  );
}
