import { connection } from "next/server";

import { getSchiedsrichter } from "@/features/schiedsrichter/queries";
import { getSpiele } from "@/features/spiele/queries";
import { getSpielorte } from "@/features/spielorte/queries";
import { getTeams } from "@/features/teams/queries";

import { AdminProvider } from "./AdminContextProvider";

/**
 * `saison_id` is the season the caller is showing: `/admin/spielsuche` can list a past season's
 * matches, and without it the pickers would offer the current season's teams. Mounted by
 * the routes that open the editor, never by `admin/layout.tsx`.
 */
export async function AdminContextWrapper({ children, saison_id }: { children: React.ReactNode; saison_id?: string }) {
  await connection();
  const [schiedsrichterRes, spielorteRes, teamsRes, spieleRes] = await Promise.all([
    getSchiedsrichter(),
    getSpielorte(),
    getTeams({ saison_id: saison_id }),
    getSpiele({ saison_id: saison_id }),
  ]);
  if (teamsRes.format !== "list") {
    throw new Error("Expected a list, got something else");
  }

  return (
    <AdminProvider
      schiedsrichter={schiedsrichterRes.schiedsrichter}
      spielorte={spielorteRes.spielorte}
      teams={teamsRes.teams}
      saisonSpiele={spieleRes.spiele}>
      {children}
    </AdminProvider>
  );
}
