"use server";

import { connection } from "next/server";

import { AdminSpielorteView } from "@/features/spielorte/components/views/AdminSpielorteView";
import { getSpielorte } from "@/features/spielorte/queries";

export default async function AdminSpielortePage() {
  await connection();
  const spielorteRes = await getSpielorte();

  return <AdminSpielorteView spielorte={spielorteRes.spielorte} />;
}
