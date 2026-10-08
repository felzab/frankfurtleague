import { connection } from "next/server";

import { readAsSeatHolder, requireTeamSeats } from "@/features/funktionen/resolvers";
import { RegistrierungenView } from "@/features/registrierungen/components/views/RegistrierungenView";
import { getOffeneRegistrierungen } from "@/features/registrierungen/queries";
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

  const read = await readAsSeatHolder(() => getOffeneRegistrierungen(team_id, saison_id, richtung));
  if ("forbidden" in read) return read.forbidden;
  const offen = read.data;

  return (
    <RegistrierungenView
      registrierungen={offen.registrierungen}
      adresse={{ team_id: team_id, saison_id: saison_id }}
      unvollstaendig={offen.vollstaendig ? null : { richtung: richtung, umkehrHref: leserichtungHrefFromRoute(query, umgekehrt(richtung)) }}
    />
  );
}
