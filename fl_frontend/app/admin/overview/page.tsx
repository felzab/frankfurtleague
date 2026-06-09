import AdminSpieleOverview from "@/features/admin/components/AdminSpieleOverview";
import { getAdminSpieleOverview } from "@/features/admin/queries";
import { connection } from "next/server";

export default async function adminOverviewPage() {
  await connection();
  const res = await getAdminSpieleOverview();

  return <AdminSpieleOverview overviewSpiele={res.spiele_overview} />;
}
