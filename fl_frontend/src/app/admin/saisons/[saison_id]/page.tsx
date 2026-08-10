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
 * The season editor (ADR-0040). One season per URL.
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

  // Retired matchdays come back too; the filter below drops them, because only the live ones bound the
  // dates. The flag matches the other admin reads of a season's matchdays, so a cached entry is
  // sometimes shared, never reliably.
  const [spieltageRes, outgoingSpieleRes] = await Promise.all([
    getSpieltage({ saison_id: saison.id, include_inactive: true }),
    // Only fetched where there is something to warn about. A season that is already active has no
    // rollover to present, and one with no incumbent has no outgoing fixtures to check.
    outgoingSaisonId === null || saison.status === "active" ? Promise.resolve(null) : getSpiele({ saison_id: outgoingSaisonId }),
  ]);

  /**
   * The outgoing season's unfinished matches — the precondition the ENDPOINT now enforces
   * (`REQ-ACTIVATE-001`, decided 2026-08-08), listed here so the block is actionable rather than a 409.
   *
   * **"Unfinished" is `ergebnis === null && !is_canceled`, and it mirrors `unplayed_spiel_nrs` exactly.**
   * Cancelling is the route past the refusal, so a cancelled fixture is settled: it is what turns a match
   * nobody will ever play into a decision somebody recorded. A cancelled match that DOES carry a result
   * is a forfeit and counts for the table (ADR-0019), so it is settled either way.
   *
   * The two definitions have to agree. If this list is empty while the endpoint refuses, the page shows a
   * live rollover button that always fails; if it is longer, the page blocks a rollover that would work.
   */
  const offeneSpiele: SaisonOffeneSpiel[] = (outgoingSpieleRes?.spiele ?? [])
    .filter((spiel) => spiel.ergebnis === null && !spiel.is_canceled)
    .map((spiel) => ({
      id: spiel.id,
      spielNr: spiel.spiel_nr,
      datum: spiel.datum,
      // A knockout slot the group phase has not filled has no team on that side — a normal state, so
      // the shared slot placeholder stands in. The provenance label is not resolved here: the
      // fixture's own page is where its wiring belongs.
      paarung: `${spiel.team1?.name ?? PLACEHOLDER.slot} – ${spiel.team2?.name ?? PLACEHOLDER.slot}`,
    }))
    .sort((left, right) => left.spielNr - right.spielNr);

  const rollover: SaisonRolloverContext = { outgoingSaisonId, offeneSpiele };

  // The inner bound on the season's own dates (`REQ-DATE-004`): the start may not move past the first
  // live matchday's beginn, the end not before the last one's ende.

  // Retired matchdays do not bind — retiring is how a mis-dated one leaves the schedule. `undefined`
  // while the season has no live matchday, which leaves both pickers unbounded.
  const liveBeginne = spieltageRes.spieltage.filter((spieltag) => spieltag.inactive_since === null).map((spieltag) => spieltag.beginn);
  const liveEnden = spieltageRes.spieltage.filter((spieltag) => spieltag.inactive_since === null).map((spieltag) => spieltag.ende);
  const spieltagBound =
    liveBeginne.length === 0
      ? undefined
      : {
          // Lexicographic min/max is date order on YYYY-MM-DD, the comparison every span rule uses.
          startMax: [...liveBeginne].sort()[0] ?? "",
          endMin: [...liveEnden].sort().at(-1) ?? "",
        };

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
      spieltagBound={spieltagBound}
    />
  );
}
