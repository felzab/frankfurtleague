import { getSchiedsrichter } from "@/features/schiedsrichter/queries";
import { getSpielorte } from "@/features/spielorte/queries";
import { getTeams } from "@/features/teams/queries";
import { connection } from "next/server";
import { AdminProvider } from "./AdminContextProvider";

export default async function AdminContextWrapper({ children }: { children: React.ReactNode }) {
  await connection();
  const [schiedsrichterRes, spielorteRes, teamsRes] = await Promise.all([
    getSchiedsrichter(),
    getSpielorte(),
    getTeams({ include_placeholders: true }),
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
