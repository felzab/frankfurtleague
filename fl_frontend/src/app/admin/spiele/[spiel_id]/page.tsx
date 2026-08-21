import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminContextWrapper } from "@/features/admin/components/providers/AdminContextWrapper";
import { AdminSpielEditView } from "@/features/admin/components/views/AdminSpielEditView";
import { getAdminSpiel } from "@/features/spiele/queries";
import { resolveSpielId } from "@/features/spiele/resolvers";
import { spielStateKey } from "@/features/spiele/utils";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { NextPageProps } from "@/shared/types/types";

/**
 * The match editor. One fixture per URL. **The page resolves NOTHING itself** — every await sits
 * inside the boundary below, which keeps a fallback-params route renderable. The sibling editors
 * follow the same shape and point here.
 */
export default function AdminSpielEditPage(props: NextPageProps<{ spiel_id: string }>) {
  return (
    // A top-level await ties the FALLBACK-params App Shell to one URL, and Next then raises
    // `postponed state ... fallback params` on any `updateTag`.
    // https://nextjs.org/docs/app/guides/incremental-static-regeneration-cache-components
    <Suspense fallback={<ContentLoader />}>
      <AdminSpielEditContent params={props.params} />
    </Suspense>
  );
}

async function AdminSpielEditContent({ params }: { params: NextPageProps<{ spiel_id: string }>["params"] }) {
  await connection();
  const spielId = await resolveSpielId(params);

  // Admin-tier and uncached, so the editor seeds from the fixture as it stands rather than from a
  // cache entry hours old. `null` is "no such fixture"; everything else throws.

  const spielRes = await getAdminSpiel(spielId);

  if (!spielRes) {
    notFound();
  }

  return (
    // The fixture's OWN season, not the current one: the pickers must offer the teams and feeder
    // matches of the season being edited, which may be a past one.
    <AdminContextWrapper saison_id={spielRes.spiel.saison_id}>
      {/* The same route pattern reconciles in place, so without a key the draft atoms carry the
          previous fixture's values in. Keyed on STORED STATE, not the id, so an undo that moved
          the fixture underneath resets the subtree. */}
      <AdminSpielEditView
        key={spielStateKey(spielRes.spiel)}
        spielData={spielRes.spiel}
        today={getGermanTodayStr()}
      />
    </AdminContextWrapper>
  );
}
