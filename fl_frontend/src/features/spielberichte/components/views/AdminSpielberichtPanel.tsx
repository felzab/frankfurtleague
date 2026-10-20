"use client";

import Link from "next/link";

import { Button } from "@heroui/react/button";

import { labelBadge } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";

import { KARTEN_FARBE_LABELS, KARTEN_GRUND_LABELS, SPIELBERICHT_ZUSTAND_LABELS, TORSCHUETZE_UNBEKANNT_LABEL } from "../../constants";
import { berlinZeitpunkt, spielerLabel, vorschlagText } from "../../utils";

import type { PillTone } from "@/shared/components/ui/badges";
import type { FLSpielberichtAdminResponse, FLSpielberichtSeite, FLSpielberichtZustand } from "../../schemas";

// `abgesagt` in the fixture's own status chip's tone, the two naming one called-off match side by side.
const ZUSTAND_TONE: Record<FLSpielberichtZustand, PillTone> = {
  vorgeschlagen: "info",
  uebernommen: "success",
  abweichend: "warning",
  abgesagt: "danger",
};

/**
 * The fixture's report on its editor, read-only: the proposal the administrator may carry into the result, and the
 * account behind it. A correction is its own page, never an edit inside this form, whose submit is the fixture's save.
 */
export function AdminSpielberichtPanel({
  lesen,
  onUebernehmen,
  istEingesetzt,
}: {
  lesen: FLSpielberichtAdminResponse;
  /** Seeds the editor's result atoms from the proposal; `null` where the draft holds no two sides to carry goals. */
  onUebernehmen: (() => void) | null;
  /** The press has seeded the draft since it was last reset. */
  istEingesetzt: boolean;
}) {
  const panel = formPanel();
  const saisonHref = useSaisonHref();
  const { bericht, zustand, spiel } = lesen;
  // Both writes refuse a called-off fixture (`REQ-BERICHT-004`), and its result is no proposal's to set.
  const istAbgesagt = zustand === "abgesagt";

  const team = (seite: FLSpielberichtSeite) => (seite === "team1" ? spiel.team1?.name : spiel.team2?.name) ?? "";
  const person = (spielerId: string | null): string => {
    if (spielerId === null) return TORSCHUETZE_UNBEKANNT_LABEL;
    const genannt = [...lesen.kader.team1, ...lesen.kader.team2, ...lesen.genannt].find((spieler) => spieler.spieler_id === spielerId);
    return genannt === undefined ? spielerId : spielerLabel(genannt);
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Spielbericht">
          {zustand !== null && <span className={labelBadge(ZUSTAND_TONE[zustand])}>{SPIELBERICHT_ZUSTAND_LABELS[zustand]}</span>}
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {bericht === null ? (
          <p className="muted-hint">Zu diesem Spiel liegt kein Spielbericht vor.</p>
        ) : (
          <>
            <p className="muted-meta">
              {[
                `Eingereicht am ${berlinZeitpunkt(bericht.eingereicht_am)}`,
                `Geändert am ${berlinZeitpunkt(bericht.geaendert_am)}`,
                ...(bericht.uebernommen_am === null ? [] : [`Übernommen am ${berlinZeitpunkt(bericht.uebernommen_am)}`]),
              ].join(" · ")}
            </p>

            {zustand === "abweichend" && (
              <p className="muted-hint">Der Bericht weicht vom gespeicherten Ergebnis ab oder wurde nach der Übernahme geändert.</p>
            )}
            {istAbgesagt && (
              <p className="muted-hint">Das Spiel ist ausgefallen oder annulliert. Der Bericht lässt sich weder übernehmen noch bearbeiten.</p>
            )}

            <div className="flex w-full flex-col gap-y-2">
              <p className="fluid-sm font-semibold text-foreground">{`Vorschlag: ${vorschlagText(bericht.ergebnis_vorschlag)}`}</p>
              {onUebernehmen !== null && !istAbgesagt && (
                <div className="flex flex-row flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    onPress={onUebernehmen}
                    className={`${formButton({ intent: "nav", size: "xs" })} shrink-0`}>
                    Vorschlag übernehmen
                  </Button>
                  {istEingesetzt && <span className={labelBadge("info")}>Eingesetzt</span>}
                </div>
              )}
              {!istAbgesagt && (
                <Hint
                  mode="reveal"
                  label="Hinweis zum Vorschlag"
                  body={{ lead: "Setzt Tore, Elfmeterschießen und Ereignis aus dem Spielbericht ein. Gespeichert wird erst mit „Speichern“." }}
                />
              )}
            </div>

            {bericht.torschuetzen.length > 0 && (
              <ul
                aria-label="Torschützen"
                className="flex w-full flex-col gap-2">
                {bericht.torschuetzen.map((tor, index) => (
                  <li
                    // Entries carry no id of their own; their place in the stored list is stable while this read stands.
                    key={index}
                    className={`${card()} flex w-full flex-row flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3`}>
                    <span className="font-numeric fluid-sm font-semibold tabular-nums">{`${tor.minute}.`}</span>
                    <span className="min-w-0 flex-1 fluid-sm">{person(tor.spieler_id)}</span>
                    <span className="muted-meta">{team(tor.seite)}</span>
                    {tor.eigentor && <span className={labelBadge("warning")}>Eigentor</span>}
                  </li>
                ))}
              </ul>
            )}

            {bericht.karten.length > 0 && (
              <ul
                aria-label="Karten"
                className="flex w-full flex-col gap-2">
                {bericht.karten.map((karte, index) => (
                  <li
                    key={index}
                    className={`${card()} flex w-full flex-row flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3`}>
                    <span className="font-numeric fluid-sm font-semibold tabular-nums">{`${karte.minute}.`}</span>
                    <span className="min-w-0 flex-1 fluid-sm">{person(karte.spieler_id)}</span>
                    <span className="muted-meta">{team(karte.seite)}</span>
                    <span className={labelBadge(karte.farbe === "gelb" ? "warning" : "danger")}>{KARTEN_FARBE_LABELS[karte.farbe]}</span>
                    {karte.grund !== null && <span className="muted-meta">{`Grund: ${KARTEN_GRUND_LABELS[karte.grund]}`}</span>}
                  </li>
                ))}
              </ul>
            )}

            {bericht.bemerkungen !== null && (
              <div className="flex w-full flex-col gap-y-1">
                <p className="fluid-xs font-bold text-foreground">Bemerkungen (nur für die Verwaltung)</p>
                <p className="fluid-sm whitespace-pre-line text-foreground">{bericht.bemerkungen}</p>
              </div>
            )}
          </>
        )}

        {!istAbgesagt && (
          <Link
            href={saisonHref(`/bereich/admin/spiele/${spiel.spiel_id}/spielbericht`)}
            prefetch={false}
            className={`${formButton({ intent: "nav", size: "xs" })} self-start`}>
            Spielbericht bearbeiten
          </Link>
        )}
      </div>
    </section>
  );
}
