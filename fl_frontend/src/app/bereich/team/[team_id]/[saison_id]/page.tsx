import { connection } from "next/server";

import { funktionenOf } from "@/core/funktionen";
import { getSubjectSession } from "@/core/subject";
import { TeamStartView } from "@/features/funktionen/components/views/TeamStartView";
import { seatsAt } from "@/features/funktionen/teamSeats";

import type { NextPageProps } from "@/shared/types/types";

/** A seat holder's landing on their team: rendered from the seats alone, reading nothing past the session. */
export default async function TeamStartPage({ params }: NextPageProps<{ team_id: string; saison_id: string }>) {
  await connection();
  const { team_id, saison_id } = await params;
  const subject = await getSubjectSession();
  // Nothing rather than a second redirect, for the reason
  // `fl_frontend/src/app/bereich/(persoenlich)/layout.tsx :: PersonChrome` gives.
  if (subject === null) return null;

  const [erster, ...weitere] = seatsAt(funktionenOf(subject).funktionen, team_id, saison_id);
  // Nothing where no seat stands: the layout answers that address with the forbidden panel in the page's stead.
  if (erster === undefined) return null;

  return <TeamStartView seats={[erster, ...weitere]} />;
}
