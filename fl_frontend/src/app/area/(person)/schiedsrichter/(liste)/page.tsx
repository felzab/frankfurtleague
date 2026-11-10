import { redirect } from "next/navigation";

import { StatusPage } from "@/kit/StatusPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { getOwnSaisons } from "@/features/roles/queries";
import { requireRole } from "@/features/roles/resolvers";
import { pageMetadata } from "@/shared/utils/metadata";

import type { StatusCardProps } from "@/kit/StatusPage";
import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.areaSchiedsrichter, ROUTES.areaSchiedsrichter.path());
}

/**
 * The season a referee's pages open on, the one the frame's season button stands on: a redirect to that season's
 * Übersicht, or, for a referee booked to no fixture yet, the card saying so with the way to Konto. The seasons are the
 * frame's own read, so they cost the page no request of its own; the frame's shell streams first, so the redirect
 * reaches the browser inside the stream.
 */
async function readSaison(): Promise<StatusCardProps> {
  await requireRole("schiedsrichter", ROUTES.areaSchiedsrichter.path());
  const saisons = await getOwnSaisons("schiedsrichter");
  if (saisons !== null) redirect(ROUTES.schiedsrichterOverview.path(saisons.standard));
  return {
    tone: "info",
    title: COPY.shared.end.noSaison,
    next: { label: COPY.shared.end.toAccount, href: ROUTES.account.path() },
  };
}

/** `/area/schiedsrichter`: the address the account menu and the sign-in lead to, which leads on to a season's Übersicht. */
export default function SchiedsrichterPage() {
  return (
    <StatusPage
      frame="rail"
      scope="area"
      title={{ route: "areaSchiedsrichter" }}
      card={readSaison()}
    />
  );
}
