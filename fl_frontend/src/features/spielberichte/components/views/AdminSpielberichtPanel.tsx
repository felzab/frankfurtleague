"use client";

import Link from "next/link";

import ArrowDownToLine from "@gravity-ui/icons/ArrowDownToLine";

import { Button } from "@heroui/react/button";

import { labelBadge } from "@/shared/components/ui/badges";
import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { benannt } from "@/shared/utils/benannt";

import { SPIELBERICHT_ZUSTAND_LABELS, SPIELBERICHT_ZUSTAND_TONE } from "../../constants";
import { berichtSperre, berlinZeitpunkt } from "../../utils";
import { VorschlagText } from "../ui/VorschlagText";
import { BerichtEintraege } from "./BerichtEintraege";

import type { FLSpielberichtBericht } from "@/core/generated/client/types";
import type { Eingesetzt, SpielberichtStand } from "../../types";

const KORREKTUR = "Spielbericht bearbeiten";

/**
 * The fixture's report on its editor, read-only: the proposal the administrator may carry into the result, and the
 * account behind it. A correction is its own page, never an edit inside this form, whose submit is the fixture's save.
 */
export function AdminSpielberichtPanel({
  stand,
  onUebernehmen,
  uebernahmeGesperrt,
  eingesetzt,
  hatEntwurf,
  today,
}: {
  /** `null` where the read failed, which the panel says rather than reading as a fixture with no report. */
  stand: SpielberichtStand | null;
  /** Seeds the editor's result atoms from the proposal. */
  onUebernehmen: (bericht: FLSpielberichtBericht) => void;
  /** Why the draft cannot take the proposal, `null` where it can. */
  uebernahmeGesperrt: string | null;
  /** The draft holds the proposal the press seeded: from the report's version standing now, or from an older one. */
  eingesetzt: Eingesetzt;
  /** The editor holds unsaved changes, which the correction page's client-side navigation would drop unasked. */
  hatEntwurf: boolean;
  /** The German day the editor was served on, which decides whether the stored fixture takes a report. */
  today: string;
}) {
  const panel = formPanel();
  const zustand = stand?.lesen.zustand ?? null;

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Spielbericht">
          {zustand !== null && <span className={labelBadge(SPIELBERICHT_ZUSTAND_TONE[zustand])}>{SPIELBERICHT_ZUSTAND_LABELS[zustand]}</span>}
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {stand === null ? (
          <p className="muted-hint">Der Spielbericht ließ sich gerade nicht lesen. Lade die Seite neu.</p>
        ) : (
          <BerichtInhalt
            stand={stand}
            onUebernehmen={onUebernehmen}
            uebernahmeGesperrt={uebernahmeGesperrt}
            eingesetzt={eingesetzt}
            hatEntwurf={hatEntwurf}
            today={today}
          />
        )}
      </div>
    </section>
  );
}

function BerichtInhalt({
  stand,
  onUebernehmen,
  uebernahmeGesperrt,
  eingesetzt,
  hatEntwurf,
  today,
}: {
  stand: SpielberichtStand;
  onUebernehmen: (bericht: FLSpielberichtBericht) => void;
  uebernahmeGesperrt: string | null;
  eingesetzt: Eingesetzt;
  hatEntwurf: boolean;
  today: string;
}) {
  const saisonHref = useSaisonHref();
  const { lesen } = stand;
  const { bericht, zustand, spiel } = lesen;
  // Both writes refuse a called-off fixture (`bericht_abgesagt`), and its result is no proposal's to set.
  const istAbgesagt = zustand === "abgesagt";
  // A proposal by side about clubs that left: its score beside this fixture's clubs would read as theirs, as the card's
  // chip withholds it (`fl_frontend/src/features/spielberichte/utils.ts :: berichtChip`).
  const zeigtVorschlag = !istAbgesagt && zustand !== "teams_geaendert";

  return (
    <>
      {bericht === null ? (
        <p className="muted-hint">Zu diesem Spiel liegt kein Spielbericht vor.</p>
      ) : (
        <>
          <p className="muted-meta">
            {[
              // The save's own word, the first one's day: a report the league wrote first was never sent by anyone.
              `Erstmals gespeichert am ${berlinZeitpunkt(bericht.eingereicht_am)}`,
              `Geändert am ${berlinZeitpunkt(bericht.geaendert_am)}`,
              ...(bericht.uebernommen_am === null ? [] : [`Übernommen am ${berlinZeitpunkt(bericht.uebernommen_am)}`]),
            ].join(" · ")}
          </p>

          {zustand === "abweichend" && (
            <p className="muted-hint">
              Das gespeicherte Ergebnis ist nicht aus diesem Bericht übernommen, oder der Bericht wurde seitdem geändert.
            </p>
          )}
          {zustand === "teams_geaendert" && (
            <p className="muted-hint">
              Der Bericht wurde für andere Teams geschrieben, als jetzt im Spiel stehen. Übernehmen lässt er sich erst, wenn er für diese Teams
              neu gespeichert ist.
            </p>
          )}
          {istAbgesagt && (
            <p className="muted-hint">
              Das Spiel ist als ausgefallen oder annulliert eingetragen. Übernehmen und bearbeiten lässt sich der Bericht, sobald Du das
              Sonderereignis entfernst.
            </p>
          )}

          {zeigtVorschlag && (
            <div className="flex w-full flex-col gap-y-2">
              <p className="fluid-sm font-semibold text-foreground">
                Vorschlag: <VorschlagText vorschlag={bericht.ergebnis_vorschlag} />
              </p>
              <div className="flex flex-row flex-wrap items-center gap-3">
                <Hint
                  mode="refusal"
                  reason={uebernahmeGesperrt}
                  // The press's name whole: while blocked, the overlay is what names the control, which is `inert`.
                  label={benannt("Vorschlag übernehmen", "Spielbericht")}>
                  <Button
                    type="button"
                    variant="secondary"
                    // Named apart from the confirmations' press of the same words on this editor, which carries a date.
                    aria-label={benannt("Vorschlag übernehmen", "Spielbericht")}
                    isDisabled={uebernahmeGesperrt !== null}
                    onPress={() => onUebernehmen(bericht)}
                    className={`${formButton({ intent: "nav", size: "xs" })} shrink-0 gap-x-2`}>
                    <ArrowDownToLine
                      className="size-3.5"
                      aria-hidden="true"
                    />
                    Vorschlag übernehmen
                  </Button>
                </Hint>
                {eingesetzt === "aktuell" && <span className={labelBadge("info")}>Eingesetzt</span>}
              </div>
              {/* A refresh can bring a newer report under a mounted editor: the badge would vouch for a proposal the
                    draft does not hold, and the save would stamp nothing. */}
              {eingesetzt === "veraltet" && (
                <p className="muted-hint">
                  Der Spielbericht wurde geändert, seit Du seinen Vorschlag eingesetzt hast. Übernimm den Vorschlag erneut.
                </p>
              )}
              <Hint
                mode="reveal"
                label="Hinweis zum Vorschlag"
                body={{
                  lead: "Setzt Tore, Elfmeterschießen und Sonderereignis aus dem Spielbericht ein. Gespeichert wird erst mit „Speichern“.",
                }}
              />
            </div>
          )}

          <BerichtEintraege
            lesen={lesen}
            bericht={bericht}
          />
        </>
      )}

      {/* The correction page writes only where the stored fixture takes a report; a client-side navigation passes the
          editor's unsaved-changes guard, so a seeded draft would go unasked. */}
      {berichtSperre(spiel, today) === null &&
        (hatEntwurf ? (
          <Hint
            mode="refusal"
            reason="Speichere oder verwirf zuerst Deine Änderungen am Spiel."
            label={KORREKTUR}>
            <Button
              type="button"
              variant="secondary"
              isDisabled
              className={`${formButton({ intent: "nav", size: "xs" })} self-start`}>
              {KORREKTUR}
            </Button>
          </Hint>
        ) : (
          <Link
            href={saisonHref(`/bereich/admin/spiele/${spiel.spiel_id}/spielbericht`)}
            prefetch={false}
            className={`${formButton({ intent: "nav", size: "xs" })} self-start`}>
            {KORREKTUR}
          </Link>
        ))}
    </>
  );
}
