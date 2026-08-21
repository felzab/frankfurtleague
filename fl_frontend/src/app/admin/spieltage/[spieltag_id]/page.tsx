import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getSaisons } from "@/features/saisons/queries";
import { getSpiele } from "@/features/spiele/queries";
import { AdminSpieltagEditView } from "@/features/spieltage/components/views/AdminSpieltagEditView";
import { getSpieltagById, getSpieltage } from "@/features/spieltage/queries";
import { resolveSpieltagId } from "@/features/spieltage/resolvers";
import { spieltagLabels } from "@/features/spieltage/utils";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";

import type { AdminSpieltagRow } from "@/features/spieltage/types";
import type { NextPageProps } from "@/shared/types/types";

/**
 * The matchday editor. One per URL and no season in it: a matchday carries its own `saison_id`, so
 * reading it is what tells the page which season's rules bound the form. It resolves nothing
 * itself — see the match editor.
 */
export default function AdminSpieltagEditPage(props: NextPageProps<{ spieltag_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader />}>
      <AdminSpieltagEditContent params={props.params} />
    </Suspense>
  );
}

/**
 * Two rounds of reads, because the first answers which season to ask about: its span bounds the date
 * pickers (`REQ-DATE-002`), and its matchday list is what a knockout round's label is numbered
 * against.
 */
async function AdminSpieltagEditContent({ params }: { params: NextPageProps<{ spieltag_id: string }>["params"] }) {
  await connection();
  const spieltagId = await resolveSpieltagId(params);

  // Null for "no such matchday", converted inside the query because a production build redacts an
  // error thrown out of a "use cache" scope. Everything else still throws.
  const spieltagRes = await getSpieltagById(spieltagId);

  if (!spieltagRes) {
    notFound();
  }

  const spieltag = spieltagRes.spieltag;

  const [saisonsRes, siblingsRes, spieleRes] = await Promise.all([
    getSaisons(),
    getSpieltage({ saison_id: spieltag.saison_id }),
    getSpiele({ saison_id: spieltag.saison_id }),
  ]);

  const saison = saisonsRes.saisons.find((candidate) => candidate.id === spieltag.saison_id);
  if (!saison) {
    // No season means no rules to bound the form, and every control depends on them.
    notFound();
  }

  // One pass over the season rather than per row: the label needs the phase's total.
  const label = spieltagLabels(siblingsRes.spieltage).get(spieltag.id)?.label ?? "";

  const attached = spieleRes.spiele.filter((spiel) => spiel.spieltag_id === spieltag.id);

  const row: AdminSpieltagRow = {
    id: spieltag.id,
    label,
    beginn: spieltag.beginn,
    ende: spieltag.ende,
    anzahl_spiele: spieltag.anzahl_spiele,
    saison_phase: spieltag.saison_phase,
    saison_id: spieltag.saison_id,
    spieleAngelegt: attached.length,
    position: spieltag.position,
  };

  return (
    // Keyed by the state the draft mirrors, for the match editor's reason.
    <AdminSpieltagEditView
      key={JSON.stringify(row)}
      spieltag={row}
      saisonSpan={{ start: saison.start_date, end: saison.end_date }}
    />
  );
}
