import { connection } from "next/server";

import { getAdminSaisons } from "@/features/saisons/queries";
import { getSchiedsrichter } from "@/features/schiedsrichter/queries";
import { getAdminSpiele } from "@/features/spiele/queries";
import { getSpielorte } from "@/features/spielorte/queries";
import { getAdminTeams } from "@/features/teams/queries";

import { AdminProvider } from "./AdminContextProvider";

/**
 * `saison_id` is the season the caller is showing: `/admin/spielsuche` can list a past season's
 * matches, and without it the pickers would offer the current season's teams. Mounted by
 * the routes that open the editor, never by `admin/layout.tsx`.
 */
export async function AdminContextWrapper({ children, saison_id }: { children: React.ReactNode; saison_id?: string }) {
  await connection();
  // The admin list rather than `GET /saisons/{saison_id}`: the editor's commonest season is a
  // `future` one, which the base tier withholds by filter.
  const [schiedsrichterRes, spielorteRes, teamsRes, spieleRes, saisonsRes] = await Promise.all([
    getSchiedsrichter(),
    getSpielorte(),
    getAdminTeams({ saison_id: saison_id }),
    getAdminSpiele({ saison_id: saison_id }),
    getAdminSaisons(),
  ]);
  if (teamsRes.format !== "list") {
    throw new Error("Expected a list, got something else");
  }

  const saison = saison_id === undefined ? undefined : saisonsRes.saisons.find((row) => row.id === saison_id);

  return (
    <AdminProvider
      schiedsrichter={schiedsrichterRes.schiedsrichter}
      spielorte={spielorteRes.spielorte}
      teams={teamsRes.teams}
      saisonSpiele={spieleRes.spiele}
      numberOfGroups={saison?.rules.number_of_groups ?? null}>
      {children}
    </AdminProvider>
  );
}
