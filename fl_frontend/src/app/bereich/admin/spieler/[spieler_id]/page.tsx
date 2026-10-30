import { Suspense } from "react";
import { notFound } from "next/navigation";

import { istFassungBekannt } from "@/core/einwilligung";
import { resolveAdminSaison } from "@/features/saisons/resolvers";
import { AdminSpielerEditView } from "@/features/spieler/components/views/AdminSpielerEditView";
import { orderStufen } from "@/features/spieler/constants";
import { getSpielerNachnominierung, getSpielerSaisons } from "@/features/spieler/queries";
import { resolveSpielerId } from "@/features/spieler/resolvers";
import { collectHeldRollen, countLiveSquadRows, squadIsFull } from "@/features/spieler/utils";
import { getTeamSaisons } from "@/features/teams/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { nullAfterLoggingUnexplained } from "@/shared/utils/degradedRead";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { SpielerSaisonMembership, SpielerTeamOption } from "@/features/spieler/types";
import type { NextPageProps } from "@/shared/types/types";

/**
 * The squad editor. One player per URL; WHICH season's squad row it addresses is the sidemenu
 * selector's `?saison_id=`. It resolves nothing itself.
 */
export default function AdminSpielerEditPage(props: NextPageProps<{ spieler_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader />}>
      <AdminSpielerEditContent
        params={props.params}
        searchParams={props.searchParams}
      />
    </Suspense>
  );
}

async function AdminSpielerEditContent({
  params,
  searchParams,
}: {
  params: NextPageProps<{ spieler_id: string }>["params"];
  searchParams: NextPageProps["searchParams"];
}) {
  const spielerId = await resolveSpielerId(params);

  const [membershipsRes, selectedSaison, teamsRes] = await Promise.all([
    getSpielerSaisons(),
    resolveAdminSaison(searchParams),
    getTeamSaisons(),
  ]);
  if (!selectedSaison) {
    notFound();
  }

  const spieler = membershipsRes.spieler.find((candidate) => candidate.id === spielerId);
  if (!spieler) {
    notFound();
  }

  const membership = spieler.memberships.find((candidate) => candidate.saison_id === selectedSaison.id) ?? null;

  // Asked once the season resolves, since the URL may name none, and only
  // for a player holding no row there: the entry branch is the one place the verdict is shown.
  const nachnominierung = membership === null ? await getSpielerNachnominierung(selectedSaison.id) : null;

  // Resolved through the words read rather than a copy here: the registry is the backend's.
  // `null` where the registry's read failed or broke its contract, so the editor stands and says the
  // label went unchecked.
  const fassungBekannt = await runWithIncomingTrace(() =>
    istFassungBekannt(spieler.einwilligung.text_version).catch(nullAfterLoggingUnexplained),
  );

  const saison: SpielerSaisonMembership = {
    saisonId: selectedSaison.id,
    saisonStatus: selectedSaison.status,
    erlaubteStufen: orderStufen(selectedSaison.rules.erlaubte_stufen),
    nachnominierungLaeuft: nachnominierung?.nachnominierung ?? null,
    membership:
      membership === null
        ? null
        : {
            team_id: membership.team_id,
            // Normalised to `""`, so the form's controlled input has one shape to hold.
            nummer: membership.nummer ?? "",
            position: membership.position,
            stufe: membership.stufe,
            ist_nachnominiert: membership.ist_nachnominiert,
            rolle: membership.rolle,
            inactive_since: membership.inactive_since,
          },
  };

  // Who leads each team this season, so the editor offers no role the write path would refuse
  // (`kader_rolle_taken`). The edited player's own row is excluded: their role is not held against them.
  const heldRollen = collectHeldRollen({ spieler: membershipsRes.spieler, saisonId: selectedSaison.id, exceptSpielerId: spielerId });
  // The same exclusion as the roles above, and it is what makes an untouched save survive its own
  // place: a squad at the cap counting this player would refuse an edit that moves nobody.
  const liveSquadRows = countLiveSquadRows({ spieler: membershipsRes.spieler, saisonId: selectedSaison.id, exceptSpielerId: spielerId });

  // The picker offers the selected season's teams only: a transfer is meaningful within it alone.
  const teams: SpielerTeamOption[] = teamsRes.teams
    .filter((team) => team.memberships.some((candidate) => candidate.saison_id === selectedSaison.id))
    .map((team) => ({
      teamId: team.id,
      name: team.name,
      shorthand: team.shorthand,
      heldRollen: heldRollen[team.id] ?? {},
      isSquadFull: squadIsFull(liveSquadRows[team.id], selectedSaison.rules.max_kadergroesse),
    }));

  return (
    // Unkeyed: the form keys its editor by the stored state the drafts mirror.
    <AdminSpielerEditView
      spieler={{
        id: spieler.id,
        vorname: spieler.vorname,
        nachname: spieler.nachname,
        inactive_since: spieler.inactive_since,
        geburtsdatum: spieler.geburtsdatum,
        email: spieler.email,
        adresswechsel_id: spieler.adresswechsel_id,
        adresswechsel_einsehbar_verwehrt: spieler.adresswechsel_einsehbar_verwehrt,
      }}
      // Off the record this page already holds: no read of its own, the memberships tier being the
      // only one that serves the field.
      einwilligung={spieler.einwilligung}
      istFassungBekannt={fassungBekannt}
      saison={saison}
      teams={teams}
    />
  );
}
