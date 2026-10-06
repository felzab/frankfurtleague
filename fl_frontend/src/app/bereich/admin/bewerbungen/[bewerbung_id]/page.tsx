import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getLaufendeFassung, getLaufendesLabel } from "@/core/einwilligung";
import { gekeyteFassung, KONTAKT_ABSATZ_SCHLUESSEL, KONTAKT_BEDIEN_SCHLUESSEL } from "@/core/einwilligungSeiten";
import { nullUnlessContractBreak } from "@/core/errors";
import { AdminBewerbungView } from "@/features/bewerbungen/components/views/AdminBewerbungView";
import { getBewerbungById } from "@/features/bewerbungen/queries";
import { resolveBewerbungId } from "@/features/bewerbungen/resolvers";
import { bewerbungTeamName } from "@/features/bewerbungen/utils";
import { getAdminSaisons } from "@/features/saisons/queries";
import { getTeamMemberships } from "@/features/teams/queries";
import { buildGruppeOffer } from "@/features/teams/utils";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { NextPageProps } from "@/shared/types/types";

/**
 * One application, with the decision it is still open to. No season in the URL: an application
 * carries its own `saison_id`, so the sidemenu's selector changes nothing here.
 */
export default function AdminBewerbungPage(props: NextPageProps<{ bewerbung_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader />}>
      <AdminBewerbungContent params={props.params} />
    </Suspense>
  );
}

/**
 * Two rounds of reads, because the first answers which season to ask about: the acceptance enters
 * the club into THAT season, whose rules bound the groups the picker may offer.
 */
async function AdminBewerbungContent({ params }: { params: NextPageProps<{ bewerbung_id: string }>["params"] }) {
  await connection();
  const bewerbungId = await resolveBewerbungId(params);

  // `null` is "no such application"; everything else throws.
  const bewerbungRes = await getBewerbungById(bewerbungId);
  if (!bewerbungRes) {
    notFound();
  }

  const bewerbung = bewerbungRes.bewerbung;

  // The admin-tier season read, because this season is still planned — which is the only state a
  // team is taken into (`REQ-ENTER-001`) and the one the base read withholds.
  const [saisonsRes, teamsRes, neubesetzung] = await Promise.all([
    getAdminSaisons(),
    getTeamMemberships(),
    // `null` where either registry read failed: the reseat alone needs them, so it closes and the
    // decision above it stands. Words it cannot key reach the error boundary (`docs/frontend/spec.md :: I982`).
    Promise.all([
      // Per request, as every stamper reads the running label: a deploy moves it.
      runWithIncomingTrace(() => getLaufendesLabel("bewerbung")),
      // The administration's page, which a person an administrator seats is asked on.
      runWithIncomingTrace(() => getLaufendeFassung("bestaetigung_kontakt_verwaltung")),
    ]).then(
      ([formLabel, seite]) => ({
        textVersion: formLabel,
        absaetze: gekeyteFassung(seite, KONTAKT_ABSATZ_SCHLUESSEL, KONTAKT_BEDIEN_SCHLUESSEL).absaetze,
      }),
      nullUnlessContractBreak,
    ),
  ]);

  // Null where nothing carries the application's `saison_id`: the acceptance would 404, and the
  // panel says so rather than offering groups nobody declared.
  const saison = saisonsRes.saisons.find((candidate) => candidate.id === bewerbung.saison_id) ?? null;

  return (
    // Keyed by the record the decision is taken against, so the write's refresh remounts the view
    // onto the decided application rather than leaving the pickers standing over it.
    <AdminBewerbungView
      key={JSON.stringify([bewerbung, bewerbungRes.bestaetigungsfrist_abgelaufen])}
      bewerbung={bewerbung}
      fristAbgelaufen={bewerbungRes.bestaetigungsfrist_abgelaufen}
      teamName={bewerbungTeamName(bewerbung, teamsRes.teams)}
      saisonStatus={saison?.status ?? null}
      neubesetzung={neubesetzung}
      gruppeOffer={
        saison === null
          ? []
          : buildGruppeOffer(
              bewerbung.saison_id,
              saison.rules,
              teamsRes.teams.map((team) => team.memberships),
            )
      }
    />
  );
}
