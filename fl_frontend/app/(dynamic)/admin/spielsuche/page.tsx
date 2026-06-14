"use server";

import AdminSpielCardsList from "@/features/admin/components/collections/AdminSpielCardsList";
import SpielsucheView from "@/features/spiele/components/views/SpielsucheView";
import { getAllSpiele } from "@/features/spiele/queries";
import { connection } from "next/server";

export default async function AdminSpielsuchePage() {
  await connection();
  const res = await getAllSpiele();

  return (
    <SpielsucheView
      spiele={res.all_spiele}
      ListComponent={AdminSpielCardsList}
    />
  );
}
