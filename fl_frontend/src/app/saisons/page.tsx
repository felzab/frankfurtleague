import { redirect } from "next/navigation";
import { connection } from "next/server";

import { StatusPage } from "@/kit/StatusPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { getSaisonFrame } from "@/features/saisons/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import type { StatusCardProps } from "@/kit/StatusPage";
import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.saisons, ROUTES.saisons.path());
}

/**
 * The season the site is on, read at request time: a redirect to its Spielplan, or, while the league has no
 * season yet, the card saying so. The frame's shell streams first, so the redirect reaches the browser inside the
 * stream rather than as a status line.
 */
async function readSaison(): Promise<StatusCardProps> {
  await connection();
  const { active_saison_id: active } = await getSaisonFrame();
  if (active !== null) redirect(ROUTES.spielplan.path(active));
  // The landing's words for the same fact, the empty pattern under the season's noun.
  return {
    mark: "info",
    sentence: COPY.shared.empty.none(COPY.shared.saison),
    next: { label: COPY.shared.end.toHome, href: ROUTES.home.path() },
  };
}

/** `/saisons`: the address a link uses where it cannot know the season, which leads on to the season the site is on. */
export default function SaisonsPage() {
  return (
    <StatusPage
      frame="rail"
      scope="saison"
      title={{ route: "saisons" }}
      card={readSaison()}
    />
  );
}
