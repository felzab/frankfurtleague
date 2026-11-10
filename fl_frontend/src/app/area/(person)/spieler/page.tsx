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
  return pageMetadata(parent, ROUTES.areaSpieler, ROUTES.areaSpieler.path());
}

/**
 * The season the pupil's frame opens on: a redirect to its Übersicht, or, while the pupil's records stand in no
 * season, the card saying so with the way to Konto. The seasons are the frame's own read, so they cost the page no
 * request of its own; the frame's shell streams first, so the redirect reaches the browser inside the stream.
 */
async function readSaison(): Promise<StatusCardProps> {
  await requireRole("spieler", ROUTES.areaSpieler.path());
  const saisons = await getOwnSaisons("spieler");
  if (saisons !== null) redirect(ROUTES.spielerOverview.path(saisons.standard));
  return {
    tone: "info",
    title: COPY.shared.end.noSaison,
    next: { label: COPY.shared.end.toAccount, href: ROUTES.account.path() },
  };
}

/** `/area/spieler`: the address „Funktion wechseln“ and a mail lead to, which leads on to a season's Übersicht. */
export default function SpielerPage() {
  return (
    <StatusPage
      frame="rail"
      scope="area"
      title={{ route: "areaSpieler" }}
      card={readSaison()}
    />
  );
}
