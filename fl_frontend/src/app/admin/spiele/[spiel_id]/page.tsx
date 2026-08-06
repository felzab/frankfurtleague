import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { APIBadStatusError } from "@/core/errors";
import { AdminContextWrapper } from "@/features/admin/components/providers/AdminContextWrapper";
import { AdminSpielEditView } from "@/features/admin/components/views/AdminSpielEditView";
import { getSpiel } from "@/features/spiele/queries";
import { resolveSpielId } from "@/features/spiele/resolvers";
import { spielStateKey } from "@/features/spiele/utils";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { NextPageProps } from "@/shared/types/types";

/**
 * The match editor (ADR-0050). One fixture per URL, so an admin can be sent to the exact thing that
 * needs fixing and can come back to it after a reload.
 *
 * **No `generateMetadata`.** Every `/admin` route is behind `proxy.ts` and the layout's session check,
 * so nothing here is ever crawled or shared, and a title fetched per request would buy a second
 * round-trip for a tab label. The admin layout's own metadata covers it (ADR-0011 is why there is no
 * `generateStaticParams` either — this segment resolves per request by design).
 *
 * **Two reads, and the order between them is load-bearing.** The URL carries a match id and nothing
 * else, so which season's teams and fixtures the pickers must offer is only known once the match has
 * been read — `AdminContextWrapper` is then given that season rather than defaulting to the current one,
 * which is what makes editing a past season's fixture correct rather than silently offering this
 * season's clubs (ADR-0002).
 */
/**
 * The page itself resolves NOTHING, and that is what keeps this route renderable.
 *
 * `cacheComponents` prerenders an App Shell per route, and a segment with no `generateStaticParams`
 * gets one built with FALLBACK params. Awaiting `params` — or any runtime API — at the page's top
 * level ties that shell to a single URL, and the two states then contradict each other: Next crashed
 * this exact route with `Invariant: postponed state should not be provided when fallback params are
 * provided` whenever a server action's `updateTag` revalidated it from a different route. The action's
 * response was truncated to a few bytes, the client reported "An unexpected response was received
 * from the server", and the route kept serving its stale payload — which is why a saved fixture still
 * opened with its old values.
 *
 * The fix is the documented shape: the `params` promise is passed DOWN into a component inside a
 * `<Suspense>` boundary, and every await happens there. Next can then build the shell without knowing
 * the URL. Nothing about the reads below changed, only where they are awaited.
 *
 * See: https://nextjs.org/docs/app/guides/incremental-static-regeneration-cache-components
 */
export default function AdminSpielEditPage(props: NextPageProps<{ spiel_id: string }>) {
  return (
    // The same loader `admin/loading.tsx` uses, for the same reason: the shell around it — sidemenu
    // and topbar — is already painted, and only this region is still resolving.
    <Suspense fallback={<ContentLoader />}>
      <AdminSpielEditContent params={props.params} />
    </Suspense>
  );
}

async function AdminSpielEditContent({ params }: { params: NextPageProps<{ spiel_id: string }>["params"] }) {
  await connection();
  const spielId = await resolveSpielId(params);

  const spielRes = await getSpiel(spielId).catch((error: unknown) => {
    // Only a genuine 404 means "no such fixture". Swallowing everything would turn a backend outage
    // into a not-found page — and because `notFound()` is not an error, `onRequestError` would never
    // fire and the outage would go unlogged.
    if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
    throw error;
  });

  if (!spielRes) {
    notFound();
  }

  return (
    // The fixture's OWN season, not the current one: the pickers offer the teams and the legal feeder
    // matches of the season being edited (ADR-0046), and `/admin/spielsuche?saison_id=` can reach a past
    // season's fixtures.
    <AdminContextWrapper saison_id={spielRes.spiel.saison_id}>
      {/* Keyed by the fixture's STORED STATE, and it is not decoration. `/admin/spiele/A →
          /admin/spiele/B` is the same route pattern, so React reconciles the same component types at
          the same tree positions and no `useState` initialiser re-runs — every draft atom carried A's
          values into B's editor, which is unpredictable in the worst way: the fields look like B's
          stored data. A changed `key` unmounts and remounts the whole client subtree.

          The id alone covered that case and not the one the undo creates: reopening the SAME fixture
          after its values changed underneath keeps the seeded fields, so a restored fixture reads as
          un-restored until a reload. `spielStateKey` is the id plus the payload the draft mirrors, so
          the subtree also resets when the fixture itself moved. Keyed at the VIEW rather than at the
          form so it covers the view's own state too, and so a future field costs nothing here. */}
      <AdminSpielEditView
        key={spielStateKey(spielRes.spiel)}
        spielData={spielRes.spiel}
        today={getGermanTodayStr()}
      />
    </AdminContextWrapper>
  );
}
