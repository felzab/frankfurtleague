import Link from "next/link";

import { labelBadge } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { formButton } from "@/shared/components/ui/formButtons";
import { FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { benannt } from "@/shared/utils/benannt";
import { formatSpielDatum, formatUhrzeit, nichtHinterlegt, PLACEHOLDER } from "@/shared/utils/format";

import { SCHIEDSRICHTER_HREF } from "./SpielberichtZustandView";

import type { FLSpielberichtPersonFruehererEintrag } from "../../schemas";
import type { SchiedsrichterSpielberichte } from "../../types";

const LEER = "Gerade steht kein Spiel für einen Spielbericht an.";

const FRUEHERE_SAISONS = "Frühere Saisons";

/**
 * The referee panel's reports: the running season's played fixtures, and apart from them the ended seasons' reports,
 * which open read-only. Closed or unread, the panel says why no fixture is offered rather than reading as an empty season.
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
        {spiele === "unlesbar" ? (
          <p className="muted-hint">Deine Spielberichte ließen sich gerade nicht lesen. Lade die Seite neu.</p>
        ) : (
          <>
            {spiele.spiele.length === 0 ? (
              <p className="muted-hint">{LEER}</p>
            ) : (
              <ul
                aria-label="Spiele für einen Spielbericht"
                className="flex w-full flex-col gap-3">
                {spiele.spiele.map((spiel) => (
                  <SpielKarte
                    key={spiel.spiel_id}
                    spiel={spiel}
                    gesendet={spiel.eingereicht_am !== null}
                  />
                ))}
              </ul>
            )}

            {/* Apart from the running season's, as the fixtures section keeps its past ones: these open read-only. */}
            {spiele.fruehere.length > 0 && (
              <div className="flex w-full flex-col gap-3">
                <h3 className={FORM_SECTION_HEADING_CLASSES}>{FRUEHERE_SAISONS}</h3>
                <ul
                  aria-label="Spielberichte früherer Saisons"
                  className="flex w-full flex-col gap-3">
                  {spiele.fruehere.map((spiel) => (
                    <SpielKarte
                      key={spiel.spiel_id}
                      spiel={spiel}
                      gesendet={null}
                    />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** One fixture's card; `gesendet` null on an ended season's, whose report stands and only opens to be read. */
function SpielKarte({ spiel, gesendet }: { spiel: FLSpielberichtPersonFruehererEintrag; gesendet: boolean | null }) {
  const paarung = `${spiel.team1_name ?? PLACEHOLDER.slot} gegen ${spiel.team2_name ?? PLACEHOLDER.slot}`;
  const datum = spiel.datum === null ? nichtHinterlegt("Termin") : formatSpielDatum(spiel.datum);
  const worte = gesendet === false ? "Spielbericht eintragen" : "Spielbericht ansehen";

  return (
    <li className={`${card()} flex w-full flex-col gap-3 p-4 sm:flex-row sm:items-center`}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="fluid-sm font-bold text-pretty text-foreground">{paarung}</p>
        <span className="muted-meta">
          {`${datum}, ${spiel.uhrzeit === null ? nichtHinterlegt("Anpfiff") : `${formatUhrzeit(spiel.uhrzeit)} Uhr`}`}
        </span>
      </div>
      {/* „Gespeichert“, the save's own word: the report may be the league's, which the referee never sent. */}
      {gesendet !== null && <span className={labelBadge(gesendet ? "success" : "warning")}>{gesendet ? "Gespeichert" : "Offen"}</span>}
      <Link
        href={`${SCHIEDSRICHTER_HREF}/spielbericht/${spiel.spiel_id}`}
        prefetch={false}
        // The words first, which speech input says, then what tells the cards apart: one pairing can
        // meet twice, in its group and in a knockout round (WCAG 2.5.3).
        aria-label={benannt(worte, spiel.datum === null ? `${paarung}, ${datum}` : `${paarung} am ${datum}`)}
        className={`${formButton({ intent: "nav", size: "xs" })} shrink-0`}>
        {worte}
      </Link>
    </li>
  );
}
