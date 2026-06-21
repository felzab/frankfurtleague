import { connection } from "next/server";

import { getCurrentSeason } from "../../queries";

export default async function SaisonMetadataDisplay() {
  await connection();

  const saisonRes = await getCurrentSeason();
  const SaisonTimespan = `${new Date(saisonRes.saison.start_date).toLocaleDateString("de-de")} - ${new Date(saisonRes.saison.end_date).toLocaleDateString("de-de")}`;

  return (
    <div className="h-[80px] px-4 py-2">
      <h1 className="font-secondary h-fit text-lg/6 font-bold">{`Saison ${saisonRes.saison.id}`}</h1>
      <p className="text-fluid-xxs font-secondary pl-[2px]">{SaisonTimespan}</p>
    </div>
  );
}
