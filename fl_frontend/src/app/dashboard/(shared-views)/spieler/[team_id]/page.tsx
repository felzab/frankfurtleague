import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { resolveSaisonId } from "@/features/saisons/resolvers";
import { TeamSpielerView } from "@/features/spieler/components/views/TeamSpielerView";
import { getSpieler } from "@/features/spieler/queries";
import { getTeam } from "@/features/teams/queries";
import { resolveTeamId } from "@/features/teams/resolvers";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { openGraphFor } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export async function generateMetadata(props: NextPageProps<{ team_id: string }>): Promise<Metadata> {
  // See teams/[team_id]/page.tsx: connection() keeps this out of the backend-less builder stage.
  await connection();
  const team_id = await resolveTeamId(props.params);

  const teamRes = await getTeam(team_id, { saison_id: await resolveSaisonId(props.searchParams) }).catch(() => null);
  const teamData = teamRes?.team;

  // See teams/[team_id]: the miss must not inherit the layout's /dashboard canonical.
  if (!teamData) return { title: "Kader nicht gefunden", robots: { index: false, follow: false } };

  return {
    title: `Kader ${teamData.name}`,
    description: `Der Kader von ${teamData.name} in der Frankfurt-League: alle Spielerinnen und Spieler der gewählten Saison.`,
    openGraph: openGraphFor(`/dashboard/spieler/${team_id}`),
    alternates: { canonical: `/dashboard/spieler/${team_id}` },
  };
}

/**
 * The page resolves nothing itself — see `teams/[team_id]/page.tsx` for why every await belongs
 * inside the boundary. Same segment shape, same `teams` tag, same crash if it were left at the top
 * level.
 */
export default function TeamSpielerPage(props: NextPageProps<{ team_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader />}>
      <TeamSpielerContent {...props} />
    </Suspense>
  );
}

async function TeamSpielerContent(props: NextPageProps<{ team_id: string }>) {
  await connection();
  const team_id = await resolveTeamId(props.params);
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const [teamRes, spielerRes] = await Promise.all([
    // Resolves null for "no such team" — the 404 → null conversion lives inside the query (see the
    // note on `getTeam`); everything else still throws and reaches dashboard/error.tsx and
    // onRequestError.
    getTeam(team_id, { saison_id: specifiedSaisonId }),
    getSpieler({ team_id: team_id, saison_id: specifiedSaisonId }),
  ]);

  if (!teamRes) {
    notFound();
  }

  return (
    <TeamSpielerView
      teamName={teamRes.team.name}
      teamSpieler={spielerRes.spieler}
    />
  );
}
