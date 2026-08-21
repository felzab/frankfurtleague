"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Calendar } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { generateSpielplanAction } from "@/features/saisons/actions";
import { PHASE_LABELS } from "@/features/saisons/constants";
import { buildSpielplanVorschau, describeSpielplanUmfang } from "@/features/saisons/utils";
import { Callout } from "@/shared/components/ui/Callout";
import { DisabledHint } from "@/shared/components/ui/DisabledHint";
import { formButton } from "@/shared/components/ui/formButtons";
import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { PANEL_REVEAL } from "@/shared/components/ui/motion";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import { spielplanBlockedReason } from "./blockedReasons";

import type { FLSaisonRules, FLSaisonStatus } from "@/features/saisons/schemas";
import type { SaisonSpielplanContext } from "@/features/saisons/types";

/**
 * The season's draw, on `POST /saisons/{saison_id}/spielplan`. **A confirmation step rather than an
 * undo**, the rollover's shape and for its reason: one press writes every matchday and every fixture
 * of the season.
 */
export function FormSpielplanSection({
  saisonId,
  saisonStatus,
  rules,
  spielplan,
  spieltageCount,
  schedule,
  hasDrawnSpiele,
  onBeforeGenerate,
}: {
  saisonId: string;
  saisonStatus: FLSaisonStatus;
  /**
   * The season's STORED rules, which is what the draw reads. The editor's draft is refused before
   * arming, so a preview off typed values would promise a season this press cannot write.
   */
  rules: FLSaisonRules;
  /** `REQ-SPIELPLAN-001`: the season already holds fixtures, whoever put them there. */
  hasDrawnSpiele: boolean;
  /** Runs before the write; `false` cancels. The editor refuses while a draft is unsaved. */
  onBeforeGenerate: () => boolean;
} & SaisonSpielplanContext) {
  const router = useRouter();
  const [isGenerating, startGenerating] = useTransition();
  const [isConfirming, setIsConfirming] = useState(false);

  const vorschau = buildSpielplanVorschau(schedule);

  /** One label-and-value row of the armed preview, the match editor's draft readout in shape. */
  const renderVorschauRow = (label: string, value: string) => (
    <div className="flex flex-row items-baseline justify-between gap-x-3">
      <dt className="fluid-xxs text-foreground-muted font-bold">{label}</dt>
      <dd className="fluid-xs text-foreground min-w-0 text-right font-semibold">{value}</dd>
    </div>
  );

  const blockedReason = spielplanBlockedReason({
    saisonStatus,
    hasSpielplan: spielplan !== null,
    hasDrawnSpiele,
    spieltageCount,
    hasKoRunden: vorschau.koRunden.length > 0,
  });

  // The tone grades the act on offer, as the rollover's does: nothing a later edit reverses, but only
  // where there is still something to press.
  const panel = formPanel({ tone: blockedReason === null ? "danger" : "neutral" });

  const handleGenerate = () => {
    // Checked on BOTH presses: the fields stay live between arming and confirming, and this draw
    // READS the rules it is guarded against. A draft typed in that window would go with the refresh
    // while the draw came from the stored numbers.
    if (!onBeforeGenerate()) {
      setIsConfirming(false);
      return;
    }

    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    startGenerating(async () => {
      const res = await generateSpielplanAction({ id: saisonId });
      setIsConfirming(false);

      if (!res.success) {
        appToast.danger("Spielplan nicht angelegt", { description: res.error ?? "Ein unerwarteter Fehler ist aufgetreten." });
        return;
      }

      appToast.success("Spielplan angelegt", { description: res.message });
      // The action's invalidation reaches the caches; this re-renders the page the admin stands on,
      // which now has a watermark to report where the control stood.
      router.refresh();
    });
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Spielplan
          <InfoHint label="Hinweis zum Spielplan">
            <p>Mit dem Anlegen des Spielplans entstehen die Spieltage und alle Spiele dieser Saison in einem Schritt.</p>
            <ul>
              <li>
                Er entsteht aus den <strong>Gruppen</strong> und den <strong>Regeln</strong> dieser Saison, so wie beide gespeichert sind.
              </li>
              <li>
                Die Spieltage bekommen dabei noch keinen <strong>Zeitraum</strong>, die Spiele noch keinen <strong>Termin</strong>. Ort und
                Schiedsrichter bleiben ebenfalls offen.
              </li>
              <li>
                Seinen Zeitraum bekommt jeder Spieltag auf seiner <strong>eigenen Seite</strong>, die Termine der Spiele danach.
              </li>
              <li>
                Jede Gruppe braucht dafür <strong>genau so viele Teams</strong>, wie die Regeln vorsehen, und kein Team darf in einer Gruppe
                stehen, die diese Saison nicht anbietet. Passe die Gruppen über die <strong>Teamseite</strong> an.
              </li>
              <li>
                Angelegt wird der Spielplan <strong>genau einmal</strong>. Zurücknehmen lässt er sich in der Verwaltung nicht, und danach stehen
                Gruppen, Teams pro Gruppe und Qualifikanten fest.
              </li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        {/* The standing report, which outlives the toast that first said it: after the draw this
            panel has no control left, and what it holds instead is what the draw wrote. */}
        {spielplan !== null && (
          <Callout
            severity="info"
            title="Der Spielplan steht">
            Angelegt am {formatSpielDatum(spielplan.generiert_am)}: {describeSpielplanUmfang(spielplan.spieltage, spielplan.spiele)}. Seinen
            Zeitraum bekommt jeder Spieltag auf seiner eigenen Seite, die Termine der Spiele danach.
          </Callout>
        )}

        {spielplan === null && (
          <p className="fluid-sm text-foreground font-medium">
            Mit dem Anlegen des Spielplans entstehen die Spieltage und alle Spiele von Saison <strong>{saisonId}</strong> in einem Schritt. Das
            geschieht genau einmal, und danach stehen die Gruppen, die Teams pro Gruppe und die Qualifikanten dieser Saison fest.
          </p>
        )}

        {/* Escalated in place, the rollover's and the swap's shape: without `role="alert"` the only
            signal is the button label quietly changing. */}
        {isConfirming && (
          <div
            role="alert"
            className={`${PANEL_REVEAL} bg-danger/5 border-danger/20 flex flex-col gap-4 rounded-xl border p-4 shadow-sm`}>
            <strong className="fluid-xs text-danger-strong">Bist Du Dir sicher?</strong>

            {/* Inside the alert rather than beside it: the numbers ARE what the press is judged on,
                and a region announced without them asks for agreement to an unnamed season. */}
            <div className="flex w-full flex-col gap-y-3">
              <div className="flex w-full flex-col gap-y-1">
                <h3 className={FORM_SECTION_HEADING}>Aufbau dieser Saison</h3>
                <dl className="flex w-full flex-col gap-y-1">
                  {renderVorschauRow("Gruppen", String(rules.number_of_groups))}
                  {renderVorschauRow("Teams pro Gruppe", String(rules.teams_per_group))}
                  {renderVorschauRow("Qualifikanten pro Gruppe", String(rules.qualifiers_per_group))}
                </dl>
              </div>

              <div className="flex w-full flex-col gap-y-1">
                <h3 className={FORM_SECTION_HEADING}>Daraus entsteht</h3>
                <dl className="flex w-full flex-col gap-y-1">
                  {renderVorschauRow("Umfang", describeSpielplanUmfang(vorschau.spieltage, vorschau.spiele))}
                  {/* The label agrees with the list under it, and an empty list still reads `Keine`:
                      rules reaching no bracket close the control, so a blank value here would mean
                      the schedule moved under an already armed panel. */}
                  {renderVorschauRow(
                    vorschau.koRunden.length === 1 ? "KO-Runde" : "KO-Runden",
                    vorschau.koRunden.length === 0 ? "Keine" : vorschau.koRunden.map((phase) => PHASE_LABELS[phase]).join(", "),
                  )}
                </dl>
              </div>
            </div>

            <p className="fluid-xxs text-foreground leading-normal font-medium">
              Saison {saisonId} bekommt sofort ihre Spieltage und alle ihre Spiele. Rückgängig lässt sich das in der Verwaltung nicht machen.
            </p>
          </div>
        )}

        <div className="flex w-full flex-row flex-wrap items-center gap-3">
          {/* The reason is said on the control itself rather than only in the panel above it, the
              treatment the rollover established. `isGenerating` is left out: it ends by itself. */}
          <DisabledHint reason={isGenerating ? null : blockedReason}>
            <Button
              type="button"
              variant="primary"
              isDisabled={isGenerating || blockedReason !== null}
              onPress={handleGenerate}
              className={`${formButton({ intent: isConfirming ? "destructive" : "submit" })} flex items-center gap-x-2`}>
              {!isConfirming && (
                <Calendar
                  aria-hidden="true"
                  width={18}
                  height={18}
                />
              )}
              {isGenerating ? "Wird angelegt..." : isConfirming ? "Ja, Spielplan anlegen" : "Spielplan anlegen"}
            </Button>
          </DisabledHint>
          {isConfirming && (
            <Button
              type="button"
              variant="secondary"
              isDisabled={isGenerating}
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
