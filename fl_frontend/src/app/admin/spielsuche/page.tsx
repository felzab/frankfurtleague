import { connection } from "next/server";

import AdminSpielCardsList from "@/features/admin/components/collections/AdminSpielCardsList";
import AdminContextWrapper from "@/features/admin/components/providers/AdminContextWrapper";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import SpielsucheView from "@/features/spiele/components/views/SpielsucheView";
import { getSpiele } from "@/features/spiele/queries";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { NextPageProps } from "@/shared/types/types";

export default async function AdminSpielsuchePage(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const spieleRes = await getSpiele({ saison_id: specifiedSaisonId });

  return (
    // The wrapper lives here rather than in the layout (R4 §16.2), and takes the same season the
    // matches above were fetched with, so the editor's team picker matches what is on screen.
    <AdminContextWrapper saison_id={specifiedSaisonId}>
      <SpielsucheView
        spiele={spieleRes.spiele}
        today={getGermanTodayStr()}
        ListComponent={AdminSpielCardsList}
      />
    </AdminContextWrapper>
  );
}
