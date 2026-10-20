import Link from "next/link";

import { labelBadge } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { benannt } from "@/shared/utils/benannt";
import { formatSpielDatum, formatUhrzeit, nichtHinterlegt, PLACEHOLDER } from "@/shared/utils/format";

import { SPIELBERICHT_GESCHLOSSEN } from "../../constants";
import { SCHIEDSRICHTER_HREF } from "./SpielberichtZustandView";

import type { SchiedsrichterSpielberichte } from "../../types";

const LEER = "Gerade steht kein Spiel für einen Spielbericht an.";

/**
 * The referee panel's reports: one card per played fixture booked to the referee. Closed or unread, the panel says
 * why no fixture is offered rather than reading as an empty season.
 */
export function SchiedsrichterSpielberichteSection({ spiele }: { spiele: SchiedsrichterSpielberichte }) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Spielberichte">
          <Hint
            mode="reveal"
            label="Hinweis zu den Spielberichten"
            body={{ lead: "Nach jedem Spiel, das Du geleitet hast, trägst Du hier den Bericht ein." }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {spiele === "geschlossen" ? (
          <p className="muted-hint">{`${SPIELBERICHT_GESCHLOSSEN.title} ${SPIELBERICHT_GESCHLOSSEN.hint}`}</p>
        ) : spiele === "unlesbar" ? (
          <p className="muted-hint">Deine Spielberichte ließen sich gerade nicht lesen. Lade die Seite neu.</p>
        ) : spiele.length === 0 ? (
          <p className="muted-hint">{LEER}</p>
        ) : (
          <ul
            aria-label="Spiele für einen Spielbericht"
            className="flex w-full flex-col gap-3">
            {spiele.map((spiel) => {
              const paarung = `${spiel.team1_name ?? PLACEHOLDER.slot} gegen ${spiel.team2_name ?? PLACEHOLDER.slot}`;
              const datum = formatSpielDatum(spiel.datum);
              const gesendet = spiel.eingereicht_am !== null;
              const worte = gesendet ? "Spielbericht ansehen" : "Spielbericht eintragen";

              return (
                <li
                  key={spiel.spiel_id}
                  className={`${card()} flex w-full flex-col gap-3 p-4 sm:flex-row sm:items-center`}>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="fluid-sm font-bold text-pretty text-foreground">{paarung}</p>
                    <span className="muted-meta">
                      {`${datum}, ${spiel.uhrzeit === null ? nichtHinterlegt("Anpfiff") : `${formatUhrzeit(spiel.uhrzeit)} Uhr`}`}
                    </span>
                  </div>
                  <span className={labelBadge(gesendet ? "success" : "warning")}>{gesendet ? "Gesendet" : "Offen"}</span>
                  <Link
                    href={`${SCHIEDSRICHTER_HREF}/spielbericht/${spiel.spiel_id}`}
                    prefetch={false}
                    // The words first, which speech input says, then what tells the cards apart: one pairing can
                    // meet twice, in its group and in a knockout round (WCAG 2.5.3).
                    aria-label={benannt(worte, `${paarung} am ${datum}`)}
                    className={`${formButton({ intent: "nav", size: "xs" })} shrink-0`}>
                    {worte}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
