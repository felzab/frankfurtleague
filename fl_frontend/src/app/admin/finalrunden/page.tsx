import { connection } from "next/server";

import z from "zod";

import { AdminBracketWiringView } from "@/features/admin/components/views/AdminBracketWiringView";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import { getSpieltage } from "@/features/spieltage/queries";
import { FLSpieltagWithSpieleSchema } from "@/features/spieltage/schemas";
import { joinCollections } from "@/shared/utils/data";

import type { NextPageProps } from "@/shared/types/types";

/**
 * The season's bracket wiring, for review (roadmap FB-11).
 *
 * **The same two reads and the same join as `/dashboard/playoffs`**, because it is the same data seen
 * for a different purpose: the public page renders the tree and this one renders the edges that
 * produced it. Both queries are the app's cached ones rather than an admin-only route — a season's
 * fixtures are public, and `AdminContextWrapper` already reads exactly these on the editor's route.
 * Nothing here is admin-authorized, so ADR-0013's no-cache rule does not reach it; what makes the page
 * admin-only is `admin/layout.tsx`'s session guard, which every route under it inherits.
 *
 * `?saison_id=` is honoured for the reason `/admin/spielsuche` honours it: a past season's draw is
 * still worth reading, and omitting the parameter means the current season in FastAPI (ADR-0002).
 *
 * **No `generateMetadata`, like the match editor** — every `/admin` route is behind `proxy.ts` and the
 * layout's session check, so nothing here is crawled or shared.
 */
export default async function AdminFinalrundenPage(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const [spieltageRes, spieleRes] = await Promise.all([
    getSpieltage({ saison_phase: "playoffs", saison_id: specifiedSaisonId }),
    getSpiele({ saison_phase: "playoffs", saison_id: specifiedSaisonId }),
  ]);

  // Parsed, not cast — the guarantee `/dashboard/playoffs` and `/dashboard/spielplan` take on the
  // identical join. The type system cannot know the joined rows still satisfy FLSpieltagWithSpiele
  // after a schema change upstream; without this the mismatch would surface as `round.spiele.map of
  // undefined` inside the view instead.
  const rounds = z.array(FLSpieltagWithSpieleSchema).parse(
    joinCollections({
      left: spieltageRes.spieltage,
      right: spieleRes.spiele,
      leftIdKey: "id",
      rightIdKey: "spieltag_id",
      targetKey: "spiele",
    }),
  );

  return <AdminBracketWiringView rounds={rounds} />;
}
