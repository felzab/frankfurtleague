import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { frontend_config } from "@/core/config";
import { isRecordMissing } from "@/core/errors";
import { kontextOf } from "@/features/spielberichte/components/forms/SpielberichtForm/spielberichtDraft";
import { SpielberichtForm } from "@/features/spielberichte/components/forms/SpielberichtForm/SpielberichtForm";
import { SpielberichtZustandView } from "@/features/spielberichte/components/views/SpielberichtZustandView";
import { SPIELBERICHT_GESCHLOSSEN_ADMIN } from "@/features/spielberichte/constants";
import { getAdminSpielbericht } from "@/features/spielberichte/queries";
import { berichtSperre } from "@/features/spielberichte/utils";
import { resolveSpielId } from "@/features/spiele/resolvers";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { getGermanTodayStr } from "@/shared/utils/date";
import { formatSpielDatum } from "@/shared/utils/format";
import { withSaisonId } from "@/shared/utils/saisonHref";

import type { NextPageProps } from "@/shared/types/types";

/**
 * An administrator's correction of one fixture's report, its own page as every editor is: inside the fixture's
 * editor, the report form's submit would be the fixture's save. It resolves nothing itself.
 */
export default function AdminSpielberichtPage(props: NextPageProps<{ spiel_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader />}>
      <AdminSpielberichtContent params={props.params} />
    </Suspense>
  );
}

async function AdminSpielberichtContent({ params }: { params: NextPageProps<{ spiel_id: string }>["params"] }) {
  await connection();
  const spielId = await resolveSpielId(params);

  // Read whatever the switch says: the admin read is where a refused session is turned away, and an unknown
  // fixture answers its 404 before any closed state names it.
  let lesen;
  try {
    lesen = await getAdminSpielbericht(spielId, { kader: true });
  } catch (error) {
    if (isRecordMissing(error)) notFound();
    throw error;
  }

  // The fixture's own season rides along, as every admin link carries the season being worked in.
  const zumSpiel = { href: withSaisonId(`/bereich/admin/spiele/${spielId}`, lesen.spiel.saison_id), label: "Zum Spiel" };

  // The correction enters pupils into a report as the referee's form does, so the switch closes it too.
  if (frontend_config.SPIELBERICHT_EINGABE !== "on") {
    return (
      <SpielberichtZustandView
        title={SPIELBERICHT_GESCHLOSSEN_ADMIN}
        aktion={zumSpiel}
      />
    );
  }

  // The write's refusals the fixture already shows, stated before a whole report is typed, as on the referee's page. A
  // report may predate the move or call-off, so the hints say when it is edited, never that none exists.
  const sperre = berichtSperre(lesen.spiel, getGermanTodayStr());
  if (sperre === "abgesagt") {
    return (
      <SpielberichtZustandView
        title="Das Spiel ist als ausgefallen oder annulliert eingetragen."
        hint="Den Spielbericht bearbeitest Du, sobald Du das Sonderereignis im Spiel entfernst."
        aktion={zumSpiel}
      />
    );
  }
  if (sperre !== null) {
    return (
      <SpielberichtZustandView
        title={sperre === "undatiert" ? "Das Spiel hat noch kein Datum." : "Das Spiel hat noch nicht stattgefunden."}
        hint="Den Spielbericht bearbeitest Du ab dem Spieltag."
        aktion={zumSpiel}
      />
    );
  }

  const kontext = kontextOf(lesen);

  return (
    // Keyed by the stored report's version, so the refresh after a save draws the draft anew from what was saved.
    <SpielberichtForm
      key={String(lesen.bericht?.version ?? 0)}
      leser="admin"
      spielId={lesen.spiel.spiel_id}
      kontext={kontext}
      stored={lesen.bericht}
      header={{
        title: `${kontext.team1Name} gegen ${kontext.team2Name}`,
        chip: <span className="muted-meta">{formatSpielDatum(lesen.spiel.datum)}</span>,
      }}
      zurueckHref={zumSpiel.href}
    />
  );
}
