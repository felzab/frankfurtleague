import { connection } from "next/server";

import { AdminContextWrapper } from "@/features/admin/components/providers/AdminContextWrapper";
import { AdminSpieleActionRequiredView } from "@/features/admin/components/views/AdminSpieleActionRequiredView";
import { getAdminSpieleActionRequired } from "@/features/admin/queries";
import { getGermanTodayStr } from "@/shared/utils/date";

export default async function AdminOverviewPage() {
  await connection();
  const adminRes = await getAdminSpieleActionRequired();

  return (
    // No saison_id: this view is always the current season's outstanding work, so the backend's
    // default (ADR-0002) is exactly right.
    <AdminContextWrapper>
      <AdminSpieleActionRequiredView
        overviewSpiele={adminRes.spiele}
        bracketFaults={adminRes.bracket_faults}
        today={getGermanTodayStr()}
      />
    </AdminContextWrapper>
  );
}
