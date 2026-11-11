import { redirect } from "next/navigation";
import { connection } from "next/server";

import { StatusPage } from "@/kit/StatusPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { getSaisonFrame } from "@/features/saisons/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import type { SAISONLESS_PAGES } from "@/core/routes";
import type { StatusCardProps } from "@/kit/StatusCard";
import type { Metadata, ResolvingMetadata } from "next";

type Saisonless = (typeof SAISONLESS_PAGES)[number];

/** Such a page's metadata, from its row. */
export function metadataOf(route: Saisonless["route"]) {
  return async (_: unknown, parent: ResolvingMetadata): Promise<Metadata> => pageMetadata(parent, ROUTES[route], ROUTES[route].path());
}

/**
 * The season the site is on, read at request time: a redirect to the page in it, or, while the league has no
 * season yet, the card saying so. The frame's shell streams first, so the redirect reaches the browser inside the
 * stream rather than as a status line.
 */
async function readSaison(page: Saisonless["page"]): Promise<StatusCardProps> {
  await connection();
  const { active_saison_id: active } = await getSaisonFrame();
  if (active !== null) redirect(ROUTES[page].path(active));
  return {
    tone: "info",
    title: COPY.shared.end.noSaison,
    next: { label: COPY.shared.end.toHome, href: ROUTES.home.path() },
  };
}

/** An address a link uses where it cannot know the season, which leads on to the page in the season the site is on. */
export function SaisonlessPage({ route, page }: Saisonless) {
  return (
    <StatusPage
      frame="rail"
      scope="saison"
      title={{ route }}
      card={readSaison(page)}
    />
  );
}
