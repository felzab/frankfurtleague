import TeamsPageWrapper from "@/features/teams/components/TeamsPageWrapper";
import { getAllTeamsDetail } from "@/features/teams/queries";
import { connection } from "next/server";

export default async function TeamsPage() {
  await connection();
  const res = await getAllTeamsDetail();

  return (
    <TeamsPageWrapper
      teams={res.teams}
      spiele={res.spiele}
    />
  );
}
