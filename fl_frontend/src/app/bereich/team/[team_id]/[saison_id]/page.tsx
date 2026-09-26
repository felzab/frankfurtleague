import { connection } from "next/server";

import { funktionenOf } from "@/core/funktionen";
import { TeamStartView } from "@/features/funktionen/components/views/TeamStartView";
import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { seatsAt } from "@/features/funktionen/teamSeats";

import type { NextPageProps } from "@/shared/types/types";

/** A seat holder's landing on their team: rendered from the seats alone, reading nothing past the session. */
export default async function TeamStartPage({ params }: NextPageProps<{ team_id: string; saison_id: string }>) {
  await connection();
  const { team_id, saison_id } = await params;
  const subject = await requireSubjectSession();

  const [erster, ...weitere] = seatsAt(funktionenOf(subject).funktionen, team_id, saison_id);
  // Nothing where no seat stands: the layout answers that address with the forbidden panel in the page's stead.
  if (erster === undefined) return null;

  return <TeamStartView seats={[erster, ...weitere]} />;
}
