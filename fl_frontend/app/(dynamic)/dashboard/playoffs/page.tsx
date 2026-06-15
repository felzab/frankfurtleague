import PlayoffsView from "@/features/spiele/components/views/PlayoffsView";
import { getSpiele } from "@/features/spiele/queries";
import type { FLSpieltagWithSpiele } from "@/features/spiele/types";
import { getSpieltage } from "@/features/spieltage/queries";
import { joinCollections } from "@/shared/utils/utils";
import { connection } from "next/server";

export default async function Page() {
  await connection();
  const [spieltageRes, spieleRes] = await Promise.all([getSpieltage({ saison_phase: "playoffs" }), getSpiele({ saison_phase: "playoffs" })]);
  const res = await getSpiele({ saison_phase: "playoffs" });
  return (
    <PlayoffsView
      playoffsSpieltage={
        joinCollections({
          left: spieltageRes.spieltage,
          right: spieleRes.spiele,
          leftIdKey: "id",
          rightIdKey: "spieltag_id",
          targetKey: "spiele",
        }) as unknown as FLSpieltagWithSpiele[]
      }
    />
  );
}
