import { connection } from "next/server";

import z from "zod";

import { AdminBracketWiringView } from "@/features/admin/components/views/AdminBracketWiringView";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getAdminSpiele } from "@/features/spiele/queries";
import { getAdminSpieltage } from "@/features/spieltage/queries";
import { FLSpieltagWithSpieleSchema } from "@/features/spieltage/schemas";
import { joinCollections } from "@/shared/utils/data";

import type { NextPageProps } from "@/shared/types/types";

/**
 * The season's bracket wiring, on the admin-tier reads: this page opens on a season that may still be
 * planned, whose contents the base reads withhold. The page is admin-only through
 * `admin/layout.tsx`'s guard.
 */
export default async function AdminFinalrundenPage(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams, "admin");

  const [spieltageRes, spieleRes] = await Promise.all([
    getAdminSpieltage({ saison_phase: "playoffs", saison_id: specifiedSaisonId }),
    getAdminSpiele({ saison_phase: "playoffs", saison_id: specifiedSaisonId }),
  ]);

  // Parsed, not cast: the type system cannot know the joined rows still satisfy the shape after an
  // upstream schema change, and the mismatch would surface inside the view.
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
