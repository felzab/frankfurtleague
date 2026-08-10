import { connection } from "next/server";

import { AdminSpieleActionRequiredView } from "@/features/admin/components/views/AdminSpieleActionRequiredView";
import { getAdminSpieleActionRequired } from "@/features/admin/queries";
import { getGermanTodayStr } from "@/shared/utils/date";

export default async function AdminOverviewPage() {
  await connection();
  const adminRes = await getAdminSpieleActionRequired();

  return (
    // No lookup lists, for the same reason `/admin/spielsuche` needs none: the cards link into the
    // editor's own route, which loads them for the season it is editing (ADR-0040).
    <AdminSpieleActionRequiredView
      overviewSpiele={adminRes.spiele}
      bracketFaults={adminRes.bracket_faults}
      today={getGermanTodayStr()}
    />
  );
}
