import { connection } from "next/server";
import { getCurrentSeason } from "../../queries";

export default async function SaisonMetadataDisplay() {
  await connection();

  const saisonRes = await getCurrentSeason();
  const SaisonTimespan = `${new Date(saisonRes.saison.start_date).toLocaleDateString("de-de")} - ${new Date(saisonRes.saison.end_date).toLocaleDateString("de-de")}`;

  return (
    <div className="py-2 px-4 h-[80px]">
      <h1 className="h-fit text-lg/6 font-secondary font-bold ">{`Saison ${saisonRes.saison.id}`}</h1>
      <p className="text-fluid-xxs font-secondary pl-[2px]">{SaisonTimespan}</p>
    </div>
  );
}
