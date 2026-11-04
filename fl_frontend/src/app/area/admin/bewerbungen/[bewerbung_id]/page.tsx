import { Suspense } from "react";
import { notFound } from "next/navigation";

import { AdminBewerbungView } from "@/features/bewerbungen/components/views/AdminBewerbungView";
import { getBewerbungById } from "@/features/bewerbungen/queries";
import { resolveBewerbungId } from "@/features/bewerbungen/resolvers";
import { bewerbungTeamName } from "@/features/bewerbungen/utils";
import { getAdminSaisons } from "@/features/saisons/queries";
import { getTeamSaisons } from "@/features/teams/queries";
import { buildGruppeOffer } from "@/features/teams/utils";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";

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
  const bewerbungId = await resolveBewerbungId(params);

  // `null` is "no such application"; everything else throws.
  const bewerbungRes = await getBewerbungById(bewerbungId);
  if (!bewerbungRes) {
    notFound();
  }

  const bewerbung = bewerbungRes.bewerbung;

  // The admin-tier season read, because this season is still planned — which is the only state a
  // team is taken into (`entry_saison_not_future`) and the one the base read withholds.
  const [saisonsRes, teamsRes] = await Promise.all([getAdminSaisons(), getTeamSaisons()]);

  // Null where nothing carries the application's `saison_id`: the acceptance would 404, and the
  // panel says so rather than offering groups nobody declared.
  const saison = saisonsRes.saisons.find((candidate) => candidate.id === bewerbung.saison_id) ?? null;

  return (
    // Keyed by the record the decision is taken against, so the write's refresh remounts the view
    // onto the decided application rather than leaving the pickers standing over it.
    <AdminBewerbungView
      key={JSON.stringify([bewerbung, bewerbungRes.confirmation_deadline_expired])}
      bewerbung={bewerbung}
      fristAbgelaufen={bewerbungRes.confirmation_deadline_expired}
      teamName={bewerbungTeamName(bewerbung, teamsRes.teams)}
      saisonStatus={saison?.status ?? null}
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
