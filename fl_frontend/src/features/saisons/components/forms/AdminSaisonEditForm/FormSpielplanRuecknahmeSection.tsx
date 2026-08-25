"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { CalendarXmark } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { undrawSpielplanAction } from "@/features/saisons/actions";
import { describeAngesetzteSpiele, describeSpielplanUmfang } from "@/features/saisons/utils";
import { DisabledHint } from "@/shared/components/ui/DisabledHint";
import { formButton } from "@/shared/components/ui/formButtons";
import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { PANEL_REVEAL } from "@/shared/components/ui/motion";
import { appToast } from "@/shared/utils/appToast";

import { spielplanUndrawBlockedReason } from "./blockedReasons";

import type { FLSaisonStatus } from "@/features/saisons/schemas";
import type { SpielplanBestand } from "@/features/saisons/types";

/**
 * Taking the season's draw back, on `DELETE /saisons/{saison_id}/spielplan`. **A confirmation step
 * and no undo**, the draw's shape: one press removes every matchday and fixture, and `/spiele` has
 * no create to write them back. It is the first step of the repair `REQ-RULES-011` names.
 *
 * Its own panel rather than a second control inside the draw's: the two are open at once on a drawn
 * planned season, and one armed state serving both could confirm the sentence the reader did not read.
 */
export function FormSpielplanRuecknahmeSection({
  saisonId,
  saisonStatus,
  hasSpielplan,
  spieltageCount,
  bestand,
  hasDrawnSpiele,
  onBeforeUndraw,
}: {
  saisonId: string;
  saisonStatus: FLSaisonStatus;
  /** The season carries the generator's watermark, which it can hold with neither collection behind it. */
  hasSpielplan: boolean;
  /** How many matchday rows the season holds, retired ones included. All of them go. */
  spieltageCount: number;
  /** What the press destroys, and the `erfasst` figure `REQ-SPIELPLAN-006` weighs against it. */
  bestand: SpielplanBestand;
  /** `REQ-SPIELPLAN-006`'s other half: the season holds fixtures, whoever put them there. */
  hasDrawnSpiele: boolean;
  /** Runs before the write; `false` cancels. The editor refuses while a draft is unsaved. */
  onBeforeUndraw: () => boolean;
}) {
  const router = useRouter();
  const [isUndrawing, startUndrawing] = useTransition();
  const [isConfirming, setIsConfirming] = useState(false);

  const blockedReason = spielplanUndrawBlockedReason({
    saisonStatus,
    hasSpielplan,
    hasDrawnSpiele,
    spieltageCount,
    erfassteSpieleCount: bestand.erfasst,
  });

  // The tone grades the act on offer, as the draw's and the rollover's do: nothing a later edit
  // reverses, but only where there is still something to press.
  const panel = formPanel({ tone: blockedReason === null ? "danger" : "neutral" });

  /** One label-and-value row of the armed panel, the draw's readout in shape. */
  const renderUmfangRow = (label: string, value: string) => (
    <div className="flex flex-row items-baseline justify-between gap-x-3">
      <dt className="fluid-xxs text-foreground-muted font-bold">{label}</dt>
      <dd className="fluid-xs text-foreground min-w-0 text-right font-semibold">{value}</dd>
    </div>
  );

  const handleUndraw = () => {
    // Checked on BOTH presses, the draw's reason: the editor's fields stay live between arming and
    // confirming, and this press reloads the page, which would take an unsaved draft with it.
    if (!onBeforeUndraw()) {
      setIsConfirming(false);
      return;
    }

    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    startUndrawing(async () => {
      const res = await undrawSpielplanAction({ id: saisonId });
      setIsConfirming(false);

      if (!res.success) {
        appToast.danger("Spielplan nicht zurückgenommen", { description: res.error ?? "Ein unerwarteter Fehler ist aufgetreten." });
        return;
      }

      // A season already undrawn is answered 200 with zeroes and nothing cleared: the state the press
      // asked for, so it is reported rather than raised as a failure. It still gets its own grade,
      // because "zurückgenommen" over a season that held nothing would claim work nobody did.
      const removedNothing = res.undraw !== undefined && res.undraw.spieltage === 0 && res.undraw.spiele === 0 && !res.undraw.watermark_cleared;

      const report = removedNothing ? appToast.info : appToast.success;
      report(removedNothing ? "Kein Spielplan vorhanden" : "Spielplan zurückgenommen", { description: res.message });

      // The action's invalidation reaches the caches; this re-renders the page the admin stands on,
      // where the rules panel is now open again and the draw above offers a first draw.
      router.refresh();
    });
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Spielplan zurücknehmen
          <InfoHint label="Hinweis zum Zurücknehmen">
            <p>Das Zurücknehmen löscht die Spieltage und alle Spiele dieser Saison in einem Schritt.</p>
            <ul>
              <li>
                Gelöscht werden <strong>alle Spieltage</strong> und <strong>alle Spiele</strong> dieser Saison, mit jedem Termin und jeder
                Uhrzeit, die schon eingetragen sind.
              </li>
              <li>
                Möglich nur, solange die Saison <strong>geplant</strong> ist und zu keinem ihrer Spiele etwas eingetragen wurde: kein Ergebnis,
                kein Ausfall, kein Ort, kein Schiedsrichter und keine Notiz.
              </li>
              <li>
                Danach lassen sich <strong>Gruppen</strong>, <strong>Teams pro Gruppe</strong> und <strong>Qualifikanten</strong> im Abschnitt{" "}
                <strong>Regeln</strong> wieder einzeln ändern, und die Teams dieser Saison über die <strong>Teamseite</strong>.
              </li>
              <li>
                Den Spielplan legst Du danach im Abschnitt <strong>Spielplan</strong> neu an. Er wird dabei frisch gezogen:{" "}
                <strong>Zurückholen lässt sich der alte in der Verwaltung nicht.</strong>
              </li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        {blockedReason === null ? (
          <p className="fluid-sm text-foreground font-medium">
            Zurücknehmen löscht die Spieltage und Spiele, die Saison <strong>{saisonId}</strong> jetzt hält. Termine und Uhrzeiten, die schon
            eingetragen sind, gehen dabei verloren. Danach hat die Saison keinen Spielplan mehr, und Gruppen, Teams pro Gruppe und Qualifikanten
            lassen sich im Abschnitt Regeln wieder einzeln ändern.
          </p>
        ) : (
          /* In the body as well as on the control: `DisabledHint` opens on hover and on focus alone,
             so a reader who never points at a closed button would otherwise never learn why. */
          <p className="fluid-sm text-foreground-muted font-medium">{blockedReason}</p>
        )}

        {/* Escalated in place, the draw's and the rollover's shape: without `role="alert"` the only
            signal is the button label quietly changing. */}
        {isConfirming && (
          <div
            role="alert"
            className={`${PANEL_REVEAL} bg-danger/5 border-danger/20 flex flex-col gap-4 rounded-xl border p-4 shadow-sm`}>
            <strong className="fluid-xs text-danger-strong">Bist Du Dir sicher?</strong>

            {/* Inside the alert rather than beside it: the numbers ARE what the press is judged on,
                and a region announced without them asks for agreement to an unnamed season. */}
            <div className="flex w-full flex-col gap-y-1">
              <h3 className={FORM_SECTION_HEADING}>Was dabei gelöscht wird</h3>
              <dl className="flex w-full flex-col gap-y-1">
                {renderUmfangRow("Bisher angelegt", describeSpielplanUmfang(spieltageCount, bestand.spiele))}
                {/* No refusal reads this figure, which is why it is stated: a fully dated season is
                    taken back as readily as an undated one. A venue or a referee cannot be standing
                    here at all, either of them closing this control. */}
                {renderUmfangRow("Mit Termin oder Uhrzeit", describeAngesetzteSpiele(bestand.angesetzt))}
              </dl>
            </div>

            {/* No restore is named. The action log keeps an image of every removed document, but that
                is a record for a person to read and no endpoint replays it. */}
            <p className="fluid-xxs text-foreground leading-normal font-medium">
              Saison {saisonId} hat danach keine Spieltage und keine Spiele mehr, und jeder Termin und jede Uhrzeit, die schon eingetragen sind,
              gehen mit ihnen. Ein neuer Spielplan wird frisch gezogen. Zurückholen lässt sich der alte in der Verwaltung nicht.
            </p>
          </div>
        )}

        <div className="flex w-full flex-row flex-wrap items-center gap-3">
          {/* The reason is said on the control as well as in the body above it, the treatment the
              rollover established. `isUndrawing` is left out: it ends by itself. */}
          <DisabledHint reason={isUndrawing ? null : blockedReason}>
            <Button
              type="button"
              variant="primary"
              isDisabled={isUndrawing || blockedReason !== null}
              onPress={handleUndraw}
              className={`${formButton({ intent: isConfirming ? "destructive" : "submit" })} flex items-center gap-x-2`}>
              {!isConfirming && (
                <CalendarXmark
                  aria-hidden="true"
                  width={18}
                  height={18}
                />
              )}
              {/* The object stays in the label: under a danger heading a bare „Ja, zurücknehmen“ is
                  agreed to without the reader having to hold what it refers to. */}
              {isUndrawing ? "Wird zurückgenommen..." : isConfirming ? "Ja, Spielplan zurücknehmen" : "Spielplan zurücknehmen"}
            </Button>
          </DisabledHint>
          {isConfirming && (
            <Button
              type="button"
              variant="secondary"
              isDisabled={isUndrawing}
              onPress={() => setIsConfirming(false)}
              className={formButton({ intent: "cancel" })}>
              Abbrechen
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
