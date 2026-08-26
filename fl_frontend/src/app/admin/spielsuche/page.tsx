import { connection } from "next/server";

import { resolveSaisonId } from "@/features/saisons/resolvers";
import { SpielsucheView } from "@/features/spiele/components/views/SpielsucheView";
import { getAdminSpiele } from "@/features/spiele/queries";
import { getAdminSpieltage } from "@/features/spieltage/queries";
import { spieltagLabels } from "@/features/spieltage/utils";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { NextPageProps } from "@/shared/types/types";

export default async function AdminSpielsuchePage(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams, "admin");

  const [spieleRes, spieltageRes] = await Promise.all([
    getAdminSpiele({ saison_id: specifiedSaisonId }),
    getAdminSpieltage({ saison_id: specifiedSaisonId }),
  ]);

  // Over the whole season rather than over the matches fetched beside it: a knockout round's label
  // counts the matchdays its phase holds (`docs/frontend/spec.md` I27).
  const labels = spieltagLabels(spieltageRes.spieltage);

  return (
    // No editor lookup lists: this page links into the editor's own route rather than mounting it, so
    // the labelled matchdays are the only thing it serialises beside the matches on screen.
    <SpielsucheView
      spiele={spieleRes.spiele}
      today={getGermanTodayStr()}
      isAdmin
      spieltage={spieltageRes.spieltage.map((spieltag) => ({ id: spieltag.id, label: labels.get(spieltag.id)?.label ?? "" }))}
    />
  );
}
