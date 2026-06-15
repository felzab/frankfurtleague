"use server";

import AdminSpielCardsList from "@/features/admin/components/collections/AdminSpielCardsList";
import SpielsucheView from "@/features/spiele/components/views/SpielsucheView";
import { getSpiele } from "@/features/spiele/queries";
import { connection } from "next/server";

export default async function AdminSpielsuchePage() {
  await connection();
  const spieleRes = await getSpiele();

  return (
    <SpielsucheView
      spiele={spieleRes.spiele}
      ListComponent={AdminSpielCardsList}
    />
  );
}
