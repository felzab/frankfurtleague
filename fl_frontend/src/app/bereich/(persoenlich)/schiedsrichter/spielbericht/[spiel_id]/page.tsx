import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { frontend_config } from "@/core/config";
import { isRecordMissing } from "@/core/errors";
import { funktionenOf } from "@/core/funktionen";
import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { logPageVerweigert } from "@/features/funktionen/verweigert";
import { kontextOf } from "@/features/spielberichte/components/forms/SpielberichtForm/spielberichtDraft";
import { SpielberichtForm } from "@/features/spielberichte/components/forms/SpielberichtForm/SpielberichtForm";
import { SpielberichtLesenView } from "@/features/spielberichte/components/views/SpielberichtLesenView";
import { SCHIEDSRICHTER_HREF, SpielberichtZustandView } from "@/features/spielberichte/components/views/SpielberichtZustandView";
import { SPIELBERICHT_GESCHLOSSEN } from "@/features/spielberichte/constants";
import { getSchiedsrichterSpielbericht } from "@/features/spielberichte/queries";
import { berichtSperre } from "@/features/spielberichte/utils";
import { resolveSpielId } from "@/features/spiele/resolvers";
import { isFunktionLost, isRefusal } from "@/shared/utils/actionError";
import { getGermanTodayStr } from "@/shared/utils/date";
import { formatSpielDatum } from "@/shared/utils/format";

import type { NextPageProps } from "@/shared/types/types";

/**
 * The booked referee's report on one fixture. While `SPIELBERICHT_EINGABE` reads off, the page renders the closed
 * state and reads nothing: the form is one of the paths entering a pupil into a report.
 */
export default async function SchiedsrichterSpielberichtPage({ params }: NextPageProps<{ spiel_id: string }>) {
  await connection();
  const subject = await requireSubjectSession();

  // To the landing rather than a 404, as the referee panel sends a person who holds no referee record.
  if (!funktionenOf(subject).funktionen.some((funktion) => funktion.art === "schiedsrichter")) {
    logPageVerweigert("/bereich/schiedsrichter/spielbericht", "keine_funktion");
    redirect("/bereich");
  }

  if (frontend_config.SPIELBERICHT_EINGABE !== "on") {
    return (
      <SpielberichtZustandView
        title={SPIELBERICHT_GESCHLOSSEN.title}
        hint={SPIELBERICHT_GESCHLOSSEN.hint}
      />
    );
  }

  const spielId = await resolveSpielId(params);
  let read;
  try {
    read = await getSchiedsrichterSpielbericht(spielId);
  } catch (error) {
    // The record went between the page's own check and the backend's: the panel's own landing.
    if (isFunktionLost(error)) redirect("/bereich");
    if (isRecordMissing(error)) notFound();
    if (isRefusal(error) && error.serverErrorCode === "REQ-BERICHT-002")
      return <SpielberichtZustandView title="Dieses Spiel leitest Du nicht mehr." />;
    throw error;
  }

  // After the fixture's season the referee reads the report and writes it no more (`REQ-BERICHT-007`).
  if (read.abgeschlossen) return <SpielberichtLesenView lesen={read} />;

  const { spiel } = read;
  // The backend's two refusals a page can foresee from the fixture it serves, stated before any press meets them.
  const sperre = berichtSperre(spiel, getGermanTodayStr());
  if (sperre === "abgesagt") {
    return <SpielberichtZustandView title="Dieses Spiel ist ausgefallen oder annulliert. Dafür gibt es keinen Spielbericht." />;
  }
  if (sperre !== null) {
    return (
      <SpielberichtZustandView
        title={sperre === "undatiert" ? "Dieses Spiel hat noch kein Datum." : "Dieses Spiel hat noch nicht stattgefunden."}
        hint="Den Spielbericht trägst Du ab dem Spieltag ein."
      />
    );
  }

  const kontext = kontextOf(read);

  return (
    // Keyed by the stored report, so the refresh after a save draws the draft anew from what was saved.
    <SpielberichtForm
      key={String(read.bericht?.version ?? 0)}
      leser="schiedsrichter"
      spielId={spiel.spiel_id}
      kontext={kontext}
      stored={read.bericht}
      header={{
        title: `${kontext.team1Name} gegen ${kontext.team2Name}`,
        chip: <span className="muted-meta">{formatSpielDatum(spiel.datum)}</span>,
      }}
      zurueckHref={SCHIEDSRICHTER_HREF}
    />
  );
}
