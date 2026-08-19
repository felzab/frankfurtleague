import { Suspense } from "react";
import { connection } from "next/server";

import { AdminCreateSaisonModal } from "@/features/saisons/components/modals/AdminCreateSaisonModal";
import { AdminSaisonsView } from "@/features/saisons/components/views/AdminSaisonsView";
import { SAISONS_CRUD_COPY } from "@/features/saisons/constants";
import { getSaisons } from "@/features/saisons/queries";
import { getSpieltage } from "@/features/spieltage/queries";
import { getTeamMemberships } from "@/features/teams/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

import type { AdminSaisonRow } from "@/features/saisons/types";

// Not async, so the chrome never waits on the list. The create trigger fetches nothing, so unlike
// the club and player pages it has no boundary of its own.
export default function AdminSaisonsPage() {
  return (
    <AdminCrudShell
      search={
        <AdminCrudSearch
          searchLabel={SAISONS_CRUD_COPY.searchLabel}
          searchPlaceholder={SAISONS_CRUD_COPY.searchPlaceholder}
        />
      }
      createModal={<AdminCreateSaisonModal />}>
      <Suspense fallback={<AdminCrudFallback />}>
        <SaisonsTable />
      </Suspense>
    </AdminCrudShell>
  );
}

/**
 * EVERY season, each row carrying whether it has teams and a schedule yet. The matchday count
 * includes RETIRED matchdays: they still hold matches, so a season is not empty because somebody
 * retired its schedule.
 */
async function SaisonsTable() {
  await connection();

  const [saisonsRes, teamsRes] = await Promise.all([getSaisons(), getTeamMemberships()]);
  const saisons = saisonsRes.saisons;

  // One read per season: `GET /spieltage` narrows by exactly one, and an omitted `saison_id`
  // means the current one.
  const spieltageBySaison = await Promise.all(
    saisons.map(async (saison) => {
      const res = await getSpieltage({ saison_id: saison.id, include_inactive: true });
      return [saison.id, res.spieltage.length] as const;
    }),
  );
  const spieltageCountBySaison = new Map(spieltageBySaison);

  const rows: AdminSaisonRow[] = saisons.map((saison) => ({
    id: saison.id,
    start_date: saison.start_date,
    end_date: saison.end_date,
    status: saison.status,
    rules: saison.rules,
    spieltageCount: spieltageCountBySaison.get(saison.id) ?? 0,
    teamsCount: teamsRes.teams.filter((team) => team.memberships.some((membership) => membership.saison_id === saison.id)).length,
  }));

  return <AdminSaisonsView saisons={rows} />;
}
