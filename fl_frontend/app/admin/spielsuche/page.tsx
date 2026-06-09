"use server";

import AdminSpielDisplaylist from "@/features/admin/components/AdminSpielDisplayList";
import Spielsuche from "@/features/spiele/components/Spielsuche";
import { getAllSpiele } from "@/features/spiele/queries";
import { connection } from "next/server";

export default async function AdminSpielsuchePage() {
  await connection();
  const res = await getAllSpiele();

  return (
    <Spielsuche
      spiele={res.all_spiele}
      ListWrapper={AdminSpielDisplaylist}
    />
  );
}
