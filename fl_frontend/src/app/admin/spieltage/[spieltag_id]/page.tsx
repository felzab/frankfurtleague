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
 * The matchday editor (ADR-0072). One matchday per URL, and no season in it: a matchday carries its
 * own `saison_id`, so reading it is what tells the page which season's rules bound the form — the
 * same arrangement the match editor uses, and what `GET /spieltage/{spieltag_id}` was kept for
 * (ADR-0027).
 *
 * No `generateMetadata` and no `generateStaticParams`, for the reasons the match editor records.
 * **The page itself resolves NOTHING** — every await happens inside the `Suspense` boundary, which
 * is what keeps a fallback-params route renderable (the match editor documents the crash).
 */
export default function AdminSpieltagEditPage(props: NextPageProps<{ spieltag_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader />}>
      <AdminSpieltagEditContent params={props.params} />
    </Suspense>
  );
}

/**
 * The matchday, plus the facts about its surroundings that the document itself cannot carry.
 *
 * **Two rounds of reads, because the first answers which season to ask about.** The addressed
 * matchday resolves retired or not, and its `saison_id` is what the second round needs: the season's
 * span bounds both date pickers (`REQ-DATE-002`), its schedule decides what the phase picker offers
 * (ADR-0052), and its whole matchday list is what the label and the ordinal are counted over
 * (ADR-0051) — none of which is knowable from one row.
 *
 * **`livePhaseCount` is counted here rather than in the form**, because it is a fact about the phase
 * across the whole season while the form holds one matchday. It is the count as it stands, this
 * matchday included — the shape `REQ-RETIRE-005` compares against its floor.
 */
async function AdminSpieltagEditContent({ params }: { params: NextPageProps<{ spieltag_id: string }>["params"] }) {
  await connection();
  const spieltagId = await resolveSpieltagId(params);

  const spieltag = (await getSpieltagById(spieltagId)).spieltag;

  const [saisonsRes, siblingsRes, spieleRes] = await Promise.all([
    getSaisons(),
    // Retired siblings INCLUDED, matching the list: the ordinal counts every row the API's order
    // holds, so excluding one here would renumber the matchday relative to the list it came from.
    getSpieltage({ saison_id: spieltag.saison_id, include_inactive: true }),
    getSpiele({ saison_id: spieltag.saison_id }),
  ]);

  const saison = saisonsRes.saisons.find((candidate) => candidate.id === spieltag.saison_id);
  if (!saison) {
    // A matchday whose season no longer resolves has no rules to bound the form with, and every
    // control on the page depends on them.
    notFound();
  }

  // The label and the ordinal together, counted per phase over the order the API returned (ADR-0051).
  // One pass over the season rather than per row, because the label needs the phase's total.
  const derived = spieltagLabels(siblingsRes.spieltage).get(spieltag.id);

  // Two counts from one read: everything attached, and how much of it is played. The second is what
  // `REQ-RETIRE-002` refuses a retirement over.
  const attached = spieleRes.spiele.filter((spiel) => spiel.spieltag_id === spieltag.id);

  const row: AdminSpieltagRow = {
    id: spieltag.id,
    label: derived?.label ?? "",
    beginn: spieltag.beginn,
    ende: spieltag.ende,
    anzahl_spiele: spieltag.anzahl_spiele,
    saison_phase: spieltag.saison_phase,
    saison_id: spieltag.saison_id,
    inactive_since: spieltag.inactive_since,
    spieleAngelegt: attached.length,
    spieleGespielt: attached.filter((spiel) => spiel.ergebnis !== null).length,
    ordinal: derived?.ordinal ?? 1,
  };

  const livePhaseCount = siblingsRes.spieltage.filter(
    (candidate) => candidate.saison_phase === spieltag.saison_phase && candidate.inactive_since === null,
  ).length;

  return (
    // Keyed by the state the draft mirrors — the match editor's reason: the same route pattern
    // reconciles in place, and a saved matchday must reopen with its saved values.
    <AdminSpieltagEditView
      key={JSON.stringify(row)}
      spieltag={row}
      saisonSpan={{ start: saison.start_date, end: saison.end_date }}
      saisonSchedule={saison.schedule}
      livePhaseCount={livePhaseCount}
    />
  );
}
