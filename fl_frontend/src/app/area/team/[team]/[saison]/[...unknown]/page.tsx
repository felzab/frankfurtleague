import { notFound } from "next/navigation";

import { ROUTES } from "@/core/routes";
import { teamMetadata } from "@/features/roles/resolvers";

import type { Metadata } from "next";

type Props = PageProps<"/area/team/[team]/[saison]/[...unknown]">;

/** The team's Übersicht, which a session sent to sign in comes back to: this address names no page of its own. */
const address = ({ team, saison }: { team: string; saison: string }) => ROUTES.teamOverview.path(team, saison);

/** The tab titled as the card the team's not-found page draws: „Kein Zugang“ without a seat there, else not found. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return teamMetadata(
    params,
    address,
    async () => null,
    () => ({}),
  );
}

/**
 * Every address under a team's season no page holds. An address no route matches is the root's to answer, which draws
 * the site's bare not-found card outside every frame; matched here, it ends in the team area's own not-found page,
 * inside the team's frame, which chooses between not found and „Kein Zugang“ from the seats the frame holds.
 */
export default function UnknownTeamPage(): never {
  notFound();
}
