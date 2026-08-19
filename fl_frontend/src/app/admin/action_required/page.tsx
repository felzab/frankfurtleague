import { connection } from "next/server";

import { AdminSpieleActionRequiredView } from "@/features/admin/components/views/AdminSpieleActionRequiredView";
import { getAdminSpieleActionRequired } from "@/features/admin/queries";
import { getGermanTodayStr } from "@/shared/utils/date";

export default async function AdminOverviewPage() {
  await connection();
  const adminRes = await getAdminSpieleActionRequired();

  return (
    // No lookup lists: the cards link into the editor's own route, which loads them itself.
    <AdminSpieleActionRequiredView
      overviewSpiele={adminRes.spiele}
      bracketFaults={adminRes.bracket_faults}
      today={getGermanTodayStr()}
    />
  );
}
