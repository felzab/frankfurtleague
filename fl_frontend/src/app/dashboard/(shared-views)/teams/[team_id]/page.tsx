import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import { TeamDetailsView } from "@/features/teams/components/views/TeamDetailsView";
import { getTeam } from "@/features/teams/queries";
import { resolveTeamId } from "@/features/teams/resolvers";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { getGermanTodayStr } from "@/shared/utils/date";
import { openGraphFor } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export async function generateMetadata(props: NextPageProps<{ team_id: string }>): Promise<Metadata> {
  // connection() for the same reason the page has one: the Docker builder stage has no reachable
  // FastAPI, so an unguarded getTeam() here would fail `docker compose build` (ADR-0009).
  await connection();
  const team_id = await resolveTeamId(props.params);

  // getTeam is "use cache", so this duplicates no round-trip with the page render below -- but only
  // while the two calls pass the SAME filters. `statistik_scope` is part of the cache key, so leaving
  // it off here would silently double the work and fetch a table this page never renders.
  const teamRes = await getTeam(team_id, {
    saison_id: await resolveSaisonId(props.searchParams),
    statistik_scope: "gesamt",
  }).catch(() => null);
  const teamData = teamRes?.team;

  // A branch that returns no canonical inherits the layout's (/dashboard), so an unknown team id
  // would otherwise resolve to a page claiming to be the dashboard index. noindex says what it is.
  if (!teamData) return { title: "Team nicht gefunden", robots: { index: false, follow: false } };

  return {
    // Becomes "<name> | Frankfurt-League" via dashboard/layout.tsx's title template.
    title: teamData.name,
    description: `Teamdaten, Statistiken und Saisonspiele von ${teamData.full_name || teamData.name} in der Frankfurt-League.`,
    openGraph: openGraphFor(`/dashboard/teams/${team_id}`),
    alternates: { canonical: `/dashboard/teams/${team_id}` },
  };
}

/**
 * The page resolves nothing itself; every await happens inside the boundary below.
 *
 * `cacheComponents` builds an App Shell per route, and a dynamic segment with no
 * `generateStaticParams` (deliberate — `docs/frontend/spec.md :: I28`) gets one built with FALLBACK
 * params. Awaiting `params` at the
 * page's top level ties that shell to a single URL, and the two states contradict each other the
 * moment a server action's `updateTag` revalidates the route from somewhere else — Next raises
 * `Invariant: postponed state should not be provided when fallback params are provided`, truncates
 * the action's response, and leaves the route serving its stale payload.
 *
 * This page depends on the `teams` tag, which `patchAdminSpielDataAction` invalidates on every match
 * write, so it is reachable the same way `/admin/spiele/[spiel_id]` was.
 *
 * `generateMetadata` above keeps its top-level await: it is not part of the shell.
 *
 * See: https://nextjs.org/docs/app/guides/incremental-static-regeneration-cache-components
 */
export default function TeamDetailsPage(props: NextPageProps<{ team_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader />}>
      <TeamDetailsContent {...props} />
    </Suspense>
  );
}

async function TeamDetailsContent(props: NextPageProps<{ team_id: string }>) {
  await connection();
  const team_id = await resolveTeamId(props.params);
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const [teamRes, spieleRes] = await Promise.all([
    // "gesamt", not the default: this page shows the team's whole season, playoffs included, and it is
    // the only surface that does (ADR-0029). The timeline below already lists every phase, so a
    // Gruppenphase-only header would contradict the cards under it.
    // Resolves null for "no such team" — the 404 → null conversion lives inside the query, because a
    // production build redacts an error thrown out of a "use cache" scope and no call site can
    // recognise it. Everything else still throws and reaches dashboard/error.tsx and onRequestError.
    getTeam(team_id, { saison_id: specifiedSaisonId, statistik_scope: "gesamt" }),
    getSpiele({ team_id: team_id, saison_id: specifiedSaisonId }),
  ]);

  if (!teamRes) {
    notFound();
  }

  // Legal here: the scope is already dynamic via the connection() above (ADR-0009).
  const today = getGermanTodayStr();

  return (
    <TeamDetailsView
      teamData={teamRes.team}
      teamSpiele={spieleRes.spiele}
      today={today}
    />
  );
}
