import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminSaisonEditView } from "@/features/saisons/components/views/AdminSaisonEditView";
import { getSaisons } from "@/features/saisons/queries";
import { resolveSaisonIdParam } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import { getSpieltage } from "@/features/spieltage/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { PLACEHOLDER } from "@/shared/utils/format";

import type { SaisonOffeneSpiel, SaisonRolloverContext } from "@/features/saisons/types";
import type { NextPageProps } from "@/shared/types/types";

/**
 * The season editor (ADR-0050, adopted by FB-6). One season per URL.
 *
 * **The season is the SEGMENT here, not the sidemenu selector's `?saison_id=`.** That is the opposite of
 * the club and player editors, and it follows from what the page edits: those two edit a season-scoped
 * junction row belonging to a club or a person, so the selector says which row; this page's subject IS a
 * season, so it is addressed by id and the selector has nothing to add.
 *
 * No `generateMetadata` and no `generateStaticParams`, for the reasons the match editor records. **The
 * page itself resolves NOTHING** — every await happens inside the `Suspense` boundary, which is what
 * keeps a fallback-params route renderable (the match editor documents the crash).
 */
export default function AdminSaisonEditPage(props: NextPageProps<{ saison_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader />}>
      <AdminSaisonEditContent params={props.params} />
    </Suspense>
  );
}

async function AdminSaisonEditContent({ params }: { params: NextPageProps<{ saison_id: string }>["params"] }) {
  await connection();
  const saisonId = await resolveSaisonIdParam(params);

  // The whole season list rather than `GET /saisons/{id}`: the rollover panel needs the OUTGOING season
  // too, which is whichever one holds `active` — a single read by id could not name it, and a second read
  // to find it would be the same list.
  const saisonsRes = await getSaisons();
  const saison = saisonsRes.saisons.find((candidate) => candidate.id === saisonId);
  if (!saison) {
    notFound();
  }

  const outgoing = saisonsRes.saisons.find((candidate) => candidate.status === "active") ?? null;
  const outgoingSaisonId = outgoing === null || outgoing.id === saison.id ? null : outgoing.id;

  // Retired matchdays included, for the reason the list page states: a retired matchday still holds
  // matches, so a season with one is not a season without a schedule.
  const [spieltageRes, outgoingSpieleRes] = await Promise.all([
    getSpieltage({ saison_id: saison.id, include_inactive: true }),
    // Only fetched where there is something to warn about. A season that is already active has no
    // rollover to present, and one with no incumbent has no outgoing fixtures to check.
    outgoingSaisonId === null || saison.status === "active" ? Promise.resolve(null) : getSpiele({ saison_id: outgoingSaisonId }),
  ]);

  /**
   * The outgoing season's unfinished matches — the precondition the page presents and the endpoint
   * deliberately does not enforce (ADR-0033).
   *
   * "Unfinished" is `ergebnis === null`, which is the same rule the action-required list uses for
   * `ergebnis_pending`: a cancelled match that HAS a result is a forfeit and counts as played
   * (ADR-0026), while one cancelled without a result genuinely has no outcome and belongs here — marked,
   * so the operator can tell the two situations apart at a glance.
   */
  const offeneSpiele: SaisonOffeneSpiel[] = (outgoingSpieleRes?.spiele ?? [])
    .filter((spiel) => spiel.ergebnis === null)
    .map((spiel) => ({
      id: spiel.id,
      spielNr: spiel.spiel_nr,
      datum: spiel.datum,
      // A knockout slot the group phase has not filled yet has no team on that side, which is a normal
      // state rather than missing data — so the shared slot placeholder stands in and the row still
      // reads. The provenance label is deliberately not resolved here: this list exists to be recognised
      // and clicked, and the fixture's own page is where its wiring belongs.
      paarung: `${spiel.team1?.name ?? PLACEHOLDER.slot} – ${spiel.team2?.name ?? PLACEHOLDER.slot}`,
      isCanceled: spiel.is_canceled,
    }))
    .sort((left, right) => left.spielNr - right.spielNr);

  const rollover: SaisonRolloverContext = { outgoingSaisonId, offeneSpiele };

  return (
    // Keyed by the state the drafts mirror — the match editor's reason: the same route pattern reconciles
    // in place, and a saved season must reopen with its saved values.
    <AdminSaisonEditView
      key={JSON.stringify(saison)}
      saison={{
        id: saison.id,
        status: saison.status,
        start_date: saison.start_date,
        end_date: saison.end_date,
        rules: saison.rules,
      }}
      rollover={rollover}
      spieltageCount={spieltageRes.spieltage.length}
    />
  );
}
