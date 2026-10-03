import { connection } from "next/server";

import { funktionenOf } from "@/core/funktionen";
import { TeamForbiddenPanel } from "@/features/funktionen/components/ui/TeamForbiddenPanel";
import { requireSubjectSession, requireTeamSeats } from "@/features/funktionen/resolvers";
import { RegistrierungenView } from "@/features/registrierungen/components/views/RegistrierungenView";
import { getOffeneRegistrierungen } from "@/features/registrierungen/queries";
import { isFunktionLost } from "@/shared/utils/actionError";
import { leserichtungHrefFromRoute, parseLeserichtung, umgekehrt } from "@/shared/utils/leserichtung";

import type { NextPageProps } from "@/shared/types/types";

/** A team's pending registrations as its seat holder decides them, every seat alike. */
export default async function RegistrierungenPage({ params, searchParams }: NextPageProps<{ team_id: string; saison_id: string }>) {
  await connection();
  const seats = await requireTeamSeats(params);
  if (seats === null) return null;

  const { team_id, saison_id } = await params;
  const query = (await searchParams) ?? {};
  const richtung = parseLeserichtung(query);

  let offen;
  try {
    offen = await getOffeneRegistrierungen(team_id, saison_id, { order: richtung });
  } catch (error) {
    // The seat went between the page's own check and the backend's: answered as the shell answers a
    // seat not held, and every other failure is the area's boundary's.
    if (!isFunktionLost(error)) throw error;
    return <TeamForbiddenPanel funktionen={funktionenOf(await requireSubjectSession()).funktionen} />;
  }

  return (
    <RegistrierungenView
      registrierungen={offen.registrierungen}
      adresse={{ team_id: team_id, saison_id: saison_id }}
      unvollstaendig={offen.vollstaendig ? null : { richtung: richtung, umkehrHref: leserichtungHrefFromRoute(query, umgekehrt(richtung)) }}
    />
  );
}
