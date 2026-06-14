import PlayoffsView from "@/features/spiele/components/views/PlayoffsView";
import { getPlayoffsSpiele } from "@/features/spiele/queries";
import { connection } from "next/server";

export default async function Page() {
  await connection();
  const res = await getPlayoffsSpiele();
  return <PlayoffsView playoffsSpieltage={res.playoffs_spieltage} />;
}
