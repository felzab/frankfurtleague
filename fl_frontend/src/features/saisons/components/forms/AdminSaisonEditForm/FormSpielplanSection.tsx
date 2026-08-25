"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Calendar } from "@gravity-ui/icons";

import { Button, Label } from "@heroui/react";

import { generateSpielplanAction } from "@/features/saisons/actions";
import { SaisonRuleNumberField } from "@/features/saisons/components/forms/SaisonFormControls";
import { PHASE_LABELS } from "@/features/saisons/constants";
import { buildSpielplanVorschau, describeAngesetzteSpiele, describeSpielplanUmfang } from "@/features/saisons/utils";
import { Callout } from "@/shared/components/ui/Callout";
import { DisabledHint } from "@/shared/components/ui/DisabledHint";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_LABEL, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { PANEL_REVEAL } from "@/shared/components/ui/motion";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import { spielplanBlockedReason, spielplanReplacesDraw } from "./blockedReasons";
import { describeShapeRows, readShape, SHAPE_FIELDS } from "./spielplanShape";

import type { FLSaisonRules, FLSaisonStatus, FLSpielplanShape } from "@/features/saisons/schemas";
import type { SaisonSpielplanContext } from "@/features/saisons/types";

/**
 * The season's draw, on `POST /saisons/{saison_id}/spielplan`. **A confirmation step rather than an
 * undo**: one press writes the whole fixture list, and a replace deletes what it replaces and
 * carries the three shape rules with it (`REQ-RULES-011`).
 */
export function FormSpielplanSection({
  saisonId,
  saisonStatus,
  rules,
  spielplan,
  spieltageCount,
  schedule,
  bestand,
  hasDrawnSpiele,
  onBeforeGenerate,
}: {
  saisonId: string;
  saisonStatus: FLSaisonStatus;
  /**
   * The season's STORED rules: what the three shape fields start from, and what the draw runs on for
   * every rule they do not name. The editor's draft is refused before arming, so a preview off typed
   * values would promise a season this press cannot write.
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

  // The season's stored three, which a first draw keeps and a replace may move. Re-initialised by
  // the remount `page.tsx`'s key forces once the draw has written new ones.
  const [shape, setShape] = useState<FLSpielplanShape>(() => readShape(rules));

  const vorschau = buildSpielplanVorschau(schedule);

  /** One label-and-value row of the armed preview, the match editor's draft readout in shape. */
  const renderVorschauRow = (label: string, value: string) => (
    // Keyed on the label, which is unique inside each list: one of the lists below is mapped.
    <div
      key={label}
      className="flex flex-row items-baseline justify-between gap-x-3">
      <dt className="fluid-xxs text-foreground-muted font-bold">{label}</dt>
      <dd className="fluid-xs text-foreground min-w-0 text-right font-semibold">{value}</dd>
    </div>
  );

  const controlInput = {
    saisonStatus,
    hasSpielplan: spielplan !== null,
    hasDrawnSpiele,
    spieltageCount,
    erfassteSpieleCount: bestand.erfasst,
    hasKoRunden: vorschau.koRunden.length > 0,
  };

  const blockedReason = spielplanBlockedReason(controlInput);
  // Derived from the same input as the reason above, so the sentence the admin agrees to and the
  // flag the request carries can never describe different operations.
  const replacesDraw = spielplanReplacesDraw(controlInput);

  // Against the STORED rules, so the readout states the move an admin would otherwise only discover
  // afterwards. A first draw offers no fields, leaving every row unmoved.
  const shapeRows = describeShapeRows(readShape(rules), shape);
  const isShapeMoved = shapeRows.some((row) => row.isChanged);

  // The tone grades the act on offer, as the rollover's does: nothing a later edit reverses, but only
  // where there is still something to press.
  const panel = formPanel({ tone: blockedReason === null ? "danger" : "neutral" });

  const handleGenerate = () => {
    // Checked on BOTH presses: the fields stay live between arming and confirming, and this draw
    // READS the rules it is guarded against. A draft typed in that window would go with the refresh
    // while the draw ran on the season's saved ones.
    if (!onBeforeGenerate()) {
      setIsConfirming(false);
      return;
    }

    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    startGenerating(async () => {
      // The shape rides along on a REPLACE alone: a first draw carries none, which is what tells the
      // endpoint to draw from the season's stored numbers and move nothing.
      const res = await generateSpielplanAction({ id: saisonId, replace: replacesDraw, shape: replacesDraw ? shape : undefined });
      setIsConfirming(false);

      if (!res.success) {
        appToast.danger(replacesDraw ? "Spielplan nicht neu angelegt" : "Spielplan nicht angelegt", {
          description: res.error ?? "Ein unerwarteter Fehler ist aufgetreten.",
        });
        return;
      }

      appToast.success(replacesDraw ? "Spielplan neu angelegt" : "Spielplan angelegt", { description: res.message });
      // The action's invalidation reaches the caches; this re-renders the page the admin stands on,
      // which now reports the draw that stands and what the control would do to it next.
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
                Jede Gruppe braucht dafür <strong>genau so viele Teams</strong>, wie die Zahlen unten vorsehen, und kein Team darf in einer
                Gruppe stehen, die diese Saison nicht anbietet. Passe die Gruppen über die <strong>Teamseite</strong> an.
              </li>
              <li>
                <strong>Neu anlegen</strong> lässt sich der Spielplan nur, solange die Saison geplant ist und zu keinem ihrer Spiele etwas
                eingetragen wurde — kein Ergebnis, kein Ausfall, kein Ort, kein Schiedsrichter und keine Notiz. Dabei werden die vorhandenen
                Spieltage und Spiele <strong>gelöscht</strong>, mit jedem Termin und jeder Uhrzeit, die schon eingetragen sind. Zurückholen
                lässt sich das in der Verwaltung nicht.
              </li>
              <li>
                <strong>Gruppen</strong>, <strong>Teams pro Gruppe</strong> und <strong>Qualifikanten</strong> gehören zum Spielplan: Sobald
                Spiele angesetzt sind, stehen sie im Abschnitt Regeln fest, und beim Neuanlegen gibst Du sie deshalb hier an. Nimmst Du den
                Spielplan zurück, lassen sie sich dort wieder einzeln ändern.
              </li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        {/* The standing report, which outlives the toast that first said it: what the draw wrote,
            beside a control that from here on would draw over it. */}
        {spielplan !== null && (
          <Callout
            severity="info"
            title="Der Spielplan steht">
            Angelegt am {formatSpielDatum(spielplan.generiert_am)}: {describeSpielplanUmfang(spielplan.spieltage, spielplan.spiele)}. Seinen
            Zeitraum bekommt jeder Spieltag auf seiner eigenen Seite, die Termine der Spiele danach.
          </Callout>
        )}

        {replacesDraw ? (
          <p className="fluid-sm text-foreground font-medium">
            Neu anlegen löscht die Spieltage und Spiele, die Saison <strong>{saisonId}</strong> jetzt hält, und zieht sie frisch. Termine und
            Uhrzeiten, die schon eingetragen sind, gehen dabei verloren.
          </p>
        ) : (
          spielplan === null && (
            <p className="fluid-sm text-foreground font-medium">
              Mit dem Anlegen des Spielplans entstehen die Spieltage und alle Spiele von Saison <strong>{saisonId}</strong> in einem Schritt.
              Danach lässt er sich nur noch neu anlegen, solange die Saison geplant ist und zu keinem ihrer Spiele etwas eingetragen wurde.
            </p>
          )
        )}

        {/* Offered on a REPLACE alone, which is where the endpoint takes them: a first draw runs off
            the season's rules unchanged. Read-only once armed, so the confirmation cannot describe
            numbers that moved under it. */}
        {replacesDraw && (
          <div className="flex w-full flex-col gap-y-3">
            <h3 className={FORM_SECTION_HEADING}>Aufbau des neuen Spielplans</h3>
            <p className="fluid-xs text-foreground-muted font-medium">
              Aus diesen drei Zahlen entsteht der Spielplan. Änderst Du sie hier, gelten sie mit dem neuen Spielplan zusammen auch als Regeln
              dieser Saison — im Abschnitt Regeln lassen sie sich deshalb nicht mehr einzeln ändern.
            </p>
            {/* Said beside the boxes, not only in the hint: after a draw every offered group holds
                exactly its full count, so the two upper numbers move only once the groups do. */}
            <p className="fluid-xs text-foreground-muted font-medium">
              <strong>Qualifikanten</strong> kannst Du hier allein ändern. <strong>Gruppen</strong> und <strong>Teams pro Gruppe</strong> gelten
              erst, wenn die Gruppen dieser Saison genau dazu passen — verteile die Teams also vorher über die <strong>Teamseite</strong>.
            </p>
            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
              {SHAPE_FIELDS.map(({ key: shapeKey, label, minValue, maxValue }) => (
                <SaisonRuleNumberField
                  key={shapeKey}
                  // The payload's own path, so a refusal naming one of the three reaches the box that
                  // holds it. Nothing on the season's save bar spells a `shape.` path, so neither form
                  // can render the other's message.
                  name={`shape.${shapeKey}`}
                  label={<Label className={FIELD_LABEL}>{label}</Label>}
                  minValue={minValue}
                  maxValue={maxValue}
                  isReadOnly={isConfirming || isGenerating}
                  value={shape[shapeKey]}
                  onChange={(next) => setShape({ ...shape, [shapeKey]: next })}
                />
              ))}
            </div>
          </div>
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
              {/* The loss before the gain: what this press destroys is the part of it that cannot be
                  looked up again afterwards. */}
              {replacesDraw && (
                <div className="flex w-full flex-col gap-y-1">
                  <h3 className={FORM_SECTION_HEADING}>Was dabei gelöscht wird</h3>
                  <dl className="flex w-full flex-col gap-y-1">
                    {renderVorschauRow("Bisher angelegt", describeSpielplanUmfang(spieltageCount, bestand.spiele))}
                    {/* No refusal reads this figure, which is why it is stated: a fully dated season is
                        replaced as readily as an undated one. A venue or a referee cannot be standing
                        here at all — either closes the control one panel up. */}
                    {renderVorschauRow("Mit Termin oder Uhrzeit", describeAngesetzteSpiele(bestand.angesetzt))}
                  </dl>
                </div>
              )}

              {/* A moved number is read out from AND to: this press stores it, so an admin agreeing
                  to a redraw is agreeing to the season's new shape in the same breath. */}
              <div className="flex w-full flex-col gap-y-1">
                <h3 className={FORM_SECTION_HEADING}>{isShapeMoved ? "Aufbau, den diese Saison bekommt" : "Aufbau dieser Saison"}</h3>
                <dl className="flex w-full flex-col gap-y-1">{shapeRows.map((row) => renderVorschauRow(row.label, row.value))}</dl>
                {isShapeMoved && (
                  <p className="fluid-xxs text-foreground leading-normal font-medium">
                    Diese Zahlen werden zusammen mit dem Spielplan gespeichert und sind danach die Regeln dieser Saison.
                  </p>
                )}
              </div>

              <div className="flex w-full flex-col gap-y-1">
                <h3 className={FORM_SECTION_HEADING}>Daraus entsteht</h3>
                {/* The served schedule was derived from the STORED numbers, so it describes no season
                    once they move. Recomputing it here would be a second derivation of the draw, which
                    `buildSpielplanVorschau` exists to avoid — so the panel says what it does not know. */}
                {isShapeMoved ? (
                  <p className="fluid-xs text-foreground font-medium">
                    Wie viele Spieltage und Spiele aus den neuen Zahlen entstehen, steht erst nach dem Ziehen fest. Die Verwaltung meldet
                    beides, sobald der Spielplan steht.
                  </p>
                ) : (
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
                )}
              </div>
            </div>

            {/* No restore is named on either branch. The action log keeps an image of every removed
                document, but that is a record for a person to read and no endpoint replays it. */}
            <p className="fluid-xxs text-foreground leading-normal font-medium">
              {replacesDraw
                ? `Saison ${saisonId} verliert damit ihre bisherigen Spieltage und alle ihre Spiele, mit jedem Termin und jeder Uhrzeit, die schon eingetragen sind. Danach steht ein frisch gezogener Spielplan ganz ohne Termine. Zurückholen lässt sich der alte in der Verwaltung nicht.`
                : `Saison ${saisonId} bekommt sofort ihre Spieltage und alle ihre Spiele. Rückgängig lässt sich das in der Verwaltung nicht machen.`}
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
              {isGenerating
                ? replacesDraw
                  ? "Wird neu angelegt..."
                  : "Wird angelegt..."
                : isConfirming
                  ? replacesDraw
                    ? "Ja, löschen und neu anlegen"
                    : "Ja, Spielplan anlegen"
                  : replacesDraw
                    ? "Spielplan neu anlegen"
                    : "Spielplan anlegen"}
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
