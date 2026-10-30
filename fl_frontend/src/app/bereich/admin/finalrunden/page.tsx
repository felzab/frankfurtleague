import { AdminBracketWiringView } from "@/features/admin/components/views/AdminBracketWiringView";
import { requireAdminSaison } from "@/features/saisons/resolvers";
import { getAdminSpiele } from "@/features/spiele/queries";
import { getAdminSpieltage } from "@/features/spieltage/queries";
import { joinCollections } from "@/shared/utils/data";

import type { NextPageProps } from "@/shared/types/types";

/**
 * The season's bracket wiring, on the admin-tier reads: this page opens on a season that may still be
 * planned, whose contents the base reads withhold.
 */
export default async function AdminFinalrundenPage(props: NextPageProps) {
  const saison = await requireAdminSaison(props.searchParams);

  const [spieltageRes, spieleRes] = await Promise.all([
    getAdminSpieltage({ saison_phase: "playoffs", saison_id: saison.id }),
    getAdminSpiele({ saison_phase: "playoffs", saison_id: saison.id }),
  ]);

  const rounds = joinCollections({
    left: spieltageRes.spieltage,
    right: spieleRes.spiele,
    leftIdKey: "id",
    rightIdKey: "spieltag_id",
    targetKey: "spiele",
  });

  return (
    <AdminBracketWiringView
      rounds={rounds}
      saisonId={saison.id}
      isFinishedSaison={saison.status === "past"}
    />
  );
}
