import AdminSpieleActionRequiredView from "@/features/admin/components/views/AdminSpieleActionRequiredView";
import { getAdminSpieleActionRequired } from "@/features/admin/queries";
import { connection } from "next/server";

export default async function adminOverviewPage() {
  await connection();
  const adminRes = await getAdminSpieleActionRequired();

  return <AdminSpieleActionRequiredView overviewSpiele={adminRes.spiele} />;
}
