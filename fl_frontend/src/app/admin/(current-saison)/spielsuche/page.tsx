import { connection } from "next/server";

import { resolveIsFinishedSaison, resolveSaisonId } from "@/features/saisons/resolvers";
import { getSchiedsrichter } from "@/features/schiedsrichter/queries";
import { SpielsucheView } from "@/features/spiele/components/views/SpielsucheView";
import { getAdminSpiele } from "@/features/spiele/queries";
import { getSpielorte } from "@/features/spielorte/queries";
import { getAdminSpieltage } from "@/features/spieltage/queries";
import { spieltagLabels } from "@/features/spieltage/utils";
import { getTeamMemberships } from "@/features/teams/queries";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { NextPageProps } from "@/shared/types/types";

export default async function AdminSpielsuchePage(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams, "admin");

  // Every club, venue and referee, retired ones included, rather than the season's: each list linking
  // here holds rows no fixture of this season names, and a narrower read drops what their link carries.
  const [spieleRes, spieltageRes, teamsRes, spielorteRes, schiedsrichterRes, isFinishedSaison] = await Promise.all([
    getAdminSpiele({ saison_id: specifiedSaisonId }),
    getAdminSpieltage({ saison_id: specifiedSaisonId }),
    getTeamMemberships(),
    getSpielorte({ include_inactive: true }),
    getSchiedsrichter({ include_inactive: true }),
    resolveIsFinishedSaison(specifiedSaisonId),
  ]);

  // Over the whole season rather than over the matches fetched beside it: a knockout round's label
  // counts the matchdays its phase holds (`docs/frontend/spec.md` I27).
  const labels = spieltagLabels(spieltageRes.spieltage);

  return (
    // No editor lookup lists: this page links into the editor's own route rather than mounting it.
    // The three name lists go over as id and name alone, their rows carrying contacts and money.
    <SpielsucheView
      spiele={spieleRes.spiele}
      today={getGermanTodayStr()}
      isAdmin
      isFinishedSaison={isFinishedSaison}
      spieltage={spieltageRes.spieltage.map((spieltag) => ({ id: spieltag.id, label: labels.get(spieltag.id)?.label ?? "" }))}
      teams={teamsRes.teams.map((team) => ({ id: team.id, name: team.name }))}
      spielorte={spielorteRes.spielorte.map((spielort) => ({ id: spielort.id, name: spielort.name }))}
      schiedsrichter={schiedsrichterRes.schiedsrichter.map((row) => ({ id: row.id, name: row.name }))}
    />
  );
}
