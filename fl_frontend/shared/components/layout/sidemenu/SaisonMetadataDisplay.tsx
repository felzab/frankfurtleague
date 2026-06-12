import { getSaisonMetadata } from "@/features/meta/queries";
import { connection } from "next/server";

export default async function SaisonMetadataDisplay({ saisonId = null }: { saisonId?: string | null }) {
  await connection();

  const saisonMetadata = (await getSaisonMetadata(saisonId)).saison_metadata;
  const SaisonTimespan = `${new Date(saisonMetadata.start_date).toLocaleDateString("de-de")} - ${new Date(saisonMetadata.end_date).toLocaleDateString("de-de")}`;

  return (
    <div className="py-2 px-4 h-[80px]">
      <h1 className="h-fit text-lg/6 font-secondary font-bold ">{`Saison ${saisonMetadata.id}`}</h1>
      <p className="text-fluid-xxs font-secondary pl-[2px]">{SaisonTimespan}</p>
    </div>
  );
}
