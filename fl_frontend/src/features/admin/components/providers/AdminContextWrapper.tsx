import { connection } from "next/server";

import { getSchiedsrichter } from "@/features/schiedsrichter/queries";
import { getSpielorte } from "@/features/spielorte/queries";
import { getTeams } from "@/features/teams/queries";

import { AdminProvider } from "./AdminContextProvider";

/**
 * Loads the three lookup lists the match editor needs, and provides them to the client.
 *
 * Mounted by the two routes that can open that editor, **not** by `admin/layout.tsx` (R4 §16.2).
 * From the layout it ran on all four admin routes, and two of them — schiedsrichter and spielorte —
 * never render the editor, so they serialised every referee (with `kontakt.email` and
 * `kontakt.telefon`), every venue (with its full address) and every team into a payload nothing read.
 *
 * `saison_id` is the season the caller is already showing. It matters because the picker must offer
 * the teams of the season being edited: `/admin/spielsuche` can list a past season's matches via
 * `?saison_id=`, and without this the editor would offer the *current* season's teams for them.
 * Omitted means "whatever the backend defaults to", which is the current season (ADR-0002).
 */
export async function AdminContextWrapper({ children, saison_id }: { children: React.ReactNode; saison_id?: string }) {
  await connection();
  const [schiedsrichterRes, spielorteRes, teamsRes] = await Promise.all([
    getSchiedsrichter(),
    getSpielorte(),
    getTeams({ include_placeholders: true, saison_id: saison_id }),
  ]);
  if (teamsRes.format !== "list") {
    throw new Error("Expected a list, got something else");
  }

  return (
    <AdminProvider
      schiedsrichter={schiedsrichterRes.schiedsrichter}
      spielorte={spielorteRes.spielorte}
      teams={teamsRes.teams}>
      {children}
    </AdminProvider>
  );
}
