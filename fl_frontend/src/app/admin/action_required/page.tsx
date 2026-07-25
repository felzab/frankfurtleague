import { connection } from "next/server";

import AdminSpieleActionRequiredView from "@/features/admin/components/views/AdminSpieleActionRequiredView";
import { getAdminSpieleActionRequired } from "@/features/admin/queries";

export default async function AdminOverviewPage() {
  await connection();
  const adminRes = await getAdminSpieleActionRequired();

  return <AdminSpieleActionRequiredView overviewSpiele={adminRes.spiele} />;
}
