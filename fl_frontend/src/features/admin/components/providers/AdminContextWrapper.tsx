import { connection } from "next/server";

import { getSchiedsrichter } from "@/features/schiedsrichter/queries";
import { getSpiele } from "@/features/spiele/queries";
import { getSpielorte } from "@/features/spielorte/queries";
import { getTeams } from "@/features/teams/queries";

import { AdminProvider } from "./AdminContextProvider";

/**
 * Loads the four lookup lists the match editor needs, and provides them to the client.
 *
 * Mounted by the two routes that can open that editor, **not** by `admin/layout.tsx`.
 * From the layout it ran on all four admin routes, and two of them — schiedsrichter and spielorte —
 * never render the editor, so they serialised every referee (with `kontakt.email` and
 * `kontakt.telefon`), every venue (with its full address) and every team into a payload nothing read.
 *
 * `saison_id` is the season the caller is already showing. It matters because the pickers must offer
 * the teams and matches of the season being edited: `/admin/spielsuche` can list a past season's
 * matches via `?saison_id=`, and without this the editor would offer the *current* season's teams
 * for them. Omitted means "whatever the backend defaults to", which is the current season.
 *
 * The season's matches ride along for the same reason the teams do: the source of a bracket slot is
 * picked from the season's legal feeder matches, never typed as a number, and the edit
 * dialog holds one match, not its season. `getSpiele` is the same cached query the admin list itself
 * renders from, so the editor offers exactly what is on screen.
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
