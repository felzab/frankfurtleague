import { redirect } from "next/navigation";
import { connection } from "next/server";

import { StatusPage } from "@/kit/StatusPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { getAdminSaisons } from "@/features/saisons/queries";
import { selectSaison } from "@/features/saisons/resolvers";
import { pageMetadata } from "@/shared/utils/metadata";

import type { StatusCardProps } from "@/kit/StatusPage";
import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.admin, ROUTES.admin.path());
}

/**
 * The season the administration works in, read at request time, the one the frame's season button stands on: a
 * redirect to its Übersicht, or, while the league has no season yet, the card saying so with the way to the season
 * list, where the first is created. The read is the frame's own, so it costs the page no request of its own; the
 * frame's shell streams first, so the redirect reaches the browser inside the stream rather than as a status line.
 */
async function readSaison(): Promise<StatusCardProps> {
  await connection();
  const { saisons } = await getAdminSaisons();
  const saison = selectSaison(saisons, undefined);
  if (saison !== undefined) redirect(ROUTES.adminOverview.path(saison.id));
  return {
    tone: "info",
    sentence: COPY.shared.empty.none(COPY.shared.saison),
    next: { label: COPY.shared.end.toSaisons, href: ROUTES.adminSaisons.path() },
  };
}

/** `/admin`: the address a link uses where it cannot know the season, which leads on to that season's Übersicht. */
export default function AdminPage() {
  return (
    <StatusPage
      frame="rail"
      scope="area"
      title={{ route: "admin" }}
      card={readSaison()}
    />
  );
}
