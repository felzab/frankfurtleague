import AdminSpieleActionRequiredview from "@/features/admin/components/views/AdminSpieleActionRequiredview";
import { getAdminSpieleActionRequired } from "@/features/admin/queries";
import { connection } from "next/server";

export default async function adminOverviewPage() {
  await connection();
  const adminRes = await getAdminSpieleActionRequired();

  return <AdminSpieleActionRequiredview overviewSpiele={adminRes.spiele} />;
}
