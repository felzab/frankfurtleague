"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Calendar, CalendarXmark } from "@gravity-ui/icons";

import { Button, Label, ToggleButton, ToggleButtonGroup } from "@heroui/react";

import { generateSpielplanAction, undrawSpielplanAction } from "@/features/saisons/actions";
import { SaisonRuleNumberField } from "@/features/saisons/components/forms/SaisonFormControls";
import { STUFE_CHIP } from "@/features/saisons/components/forms/StufenPicker";
import { PHASE_LABELS, RECORDED_FACTS_NONE } from "@/features/saisons/constants";
import { buildSpielplanVorschau, describeAngesetzteSpiele, describeSpielplanUmfang } from "@/features/saisons/utils";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { Callout } from "@/shared/components/ui/Callout";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { DisabledHint } from "@/shared/components/ui/DisabledHint";
import { confirmButton } from "@/shared/components/ui/formButtons";
import { FIELD_LABEL, FIELD_TRIO, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import { spielplanBlockedReason, spielplanHoldsADraw, spielplanReplacesDraw, spielplanUndrawBlockedReason } from "./blockedReasons";
import { describeShapeRows, readShape, SHAPE_FIELDS } from "./spielplanShape";

import type { FLSaisonRules, FLSaisonStatus, FLSpielplanShape } from "@/features/saisons/schemas";
import type { SaisonSpielplanContext } from "@/features/saisons/types";
import type { Key } from "@heroui/react";

/** The two writes this panel offers, keyed as the operation picker below reads them back. */
type SpielplanOperation = "anlegen" | "zuruecknehmen";

/**
 * The season's fixture list, over `POST` and `DELETE /saisons/{saison_id}/spielplan`. **One panel and
 * one armed state for both**: on a drawn planned season each is open and each destroys the same
 * matchdays and fixtures, so the operation is picked before arming rather than raced between two
 * controls (`docs/frontend/spec.md :: I37`).
 *
 * **A confirmation step rather than an undo** on either write: one press writes, and nothing replays
 * the removed rows back (`docs/backend/spec.md :: I26`).
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
  onBeforeWrite,
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
  /** Runs before either write; `false` cancels. The editor refuses while a draft is unsaved. */
  onBeforeWrite: () => boolean;
} & SaisonSpielplanContext) {
  const router = useRouter();
  const { isConfirming, isPending: isWriting, press, cancel } = useTwoPressConfirm(onBeforeWrite);

  // The season's stored three, which a first draw keeps and a replace may move. Re-initialised by
  // the remount `page.tsx`'s key forces once the draw has written new ones.
  const [shape, setShape] = useState<FLSpielplanShape>(() => readShape(rules));

  const vorschau = buildSpielplanVorschau(schedule);

  const controlInput = {
    saisonStatus,
    hasSpielplan: spielplan !== null,
    hasDrawnSpiele,
    spieltageCount,
    erfassteSpieleCount: bestand.erfasst,
    hasKoRunden: vorschau.koRunden.length > 0,
  };

  const drawBlockedReason = spielplanBlockedReason(controlInput);
  const undrawBlockedReason = spielplanUndrawBlockedReason(controlInput);
  const holdsADraw = spielplanHoldsADraw(controlInput);
  // Derived from the same input as the reason above, so the sentence the admin agrees to and the
  // flag the request carries can never describe different operations.
  const replacesDraw = spielplanReplacesDraw(controlInput);

  const bothOpen = drawBlockedReason === null && undrawBlockedReason === null;

  // Null until the admin picks, and ONLY where both are open: each destroys the same rows, so a
  // preselection would arm the operation nobody read.
  const [picked, setPicked] = useState<SpielplanOperation | null>(null);

  // Never null, because a closed panel still has to name an operation to report a reason for. The
  // draw is that fallback: it is this panel's primary act, and its reason names a way back where the
  // record half of the window is what closed it.
  const operation: SpielplanOperation = bothOpen ? (picked ?? "anlegen") : undrawBlockedReason === null ? "zuruecknehmen" : "anlegen";
  const isDrawing = operation === "anlegen";

  // The unchosen state closes the control through the same channel a refusal does, so the prompt
  // reaches the hint on the button and the body below it without a second mechanism.
  const closedReason =
    bothOpen && picked === null
      ? `Beides löscht die Spieltage und Spiele, die Saison ${saisonId} jetzt hält. Wähle oben aus, was passieren soll.`
      : isDrawing
        ? drawBlockedReason
        : undrawBlockedReason;

  // Graded on the act ON OFFER, so a first draw stays neutral: it destroys nothing. Read off the two
  // reasons rather than off `closedReason`, which the unchosen prompt fills while both acts stand open.
  const isDestructiveOnOffer = holdsADraw && (drawBlockedReason === null || undrawBlockedReason === null);
  const panel = formPanel({ tone: isDestructiveOnOffer ? "danger" : "neutral" });

  // Against the STORED rules, so the readout states the move an admin would otherwise only discover
  // afterwards. A first draw offers no fields, leaving every row unmoved.
  const shapeRows = describeShapeRows(readShape(rules), shape);
  const isShapeMoved = shapeRows.some((row) => row.isChanged);

  const handlePress = () => {
    // What makes the guard's second run load-bearing here: the draw READS the rules it is guarded
    // against, so a draft typed after arming would go with the refresh while the draw used the stored ones.
    press(async () => {
      if (isDrawing) {
        // The shape rides along on a REPLACE alone: a first draw carries none, which is what tells the
        // endpoint to draw from the season's stored numbers and move nothing.
        const res = await generateSpielplanAction({ id: saisonId, replace: replacesDraw, shape: replacesDraw ? shape : undefined });

        if (!res.success) {
          appToast.danger(replacesDraw ? "Spielplan nicht neu angelegt" : "Spielplan nicht angelegt", {
            description: res.error ?? "Ein unerwarteter Fehler ist aufgetreten.",
          });
          return;
        }

        appToast.success(replacesDraw ? "Spielplan neu angelegt" : "Spielplan angelegt", { description: res.message });
      } else {
        const res = await undrawSpielplanAction({ id: saisonId });

        if (!res.success) {
          appToast.danger("Spielplan nicht zurückgenommen", { description: res.error ?? "Ein unerwarteter Fehler ist aufgetreten." });
          return;
        }

        // Its own grade rather than a plain success: „zurückgenommen“ over a season that held nothing
        // would claim work nobody did. Not a failure either, a 200 with zeroes being the state asked for.
        const removedNothing =
          res.undraw !== undefined && res.undraw.spieltage === 0 && res.undraw.spiele === 0 && !res.undraw.watermark_cleared;

        const report = removedNothing ? appToast.info : appToast.success;
        report(removedNothing ? "Kein Spielplan vorhanden" : "Spielplan zurückgenommen", { description: res.message });
      }

      // Cleared with the write that consumed it: this operation is done, and a choice left standing
      // would preselect itself the next time both acts are open.
      setPicked(null);

      // The action's invalidation reaches the caches; this re-renders the page the admin stands on,
      // which now reports the draw that stands and what the control would do to it next.
      router.refresh();
    });
  };

  return (
    <section className={panel.root()}>
      <div className={`${panel.header()} relative`}>
        {/* The one fact the heading cannot carry and every sentence below depends on. The rollover
            panel established the treatment. */}
        <span className="absolute top-1/2 right-4 -translate-y-1/2 sm:right-5">
          {holdsADraw ? (
            <span className={`${LABEL_BADGE} bg-info/15 text-info-strong`}>Spielplan steht</span>
          ) : (
            <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Kein Spielplan</span>
          )}
        </span>
        <h2 className={panel.heading()}>
          Spielplan
          <InfoHint label="Hinweis zum Spielplan">
            <p>
              Der Spielplan umfasst die Spieltage und alle Spiele dieser Saison. Er entsteht in einem Schritt und wird in einem Schritt
              zurückgenommen.
            </p>
            <ul>
              <li>
                Er entsteht aus den <strong>Gruppen</strong> und den <strong>Regeln</strong> dieser Saison, so wie beide gespeichert sind. Jede
                Gruppe braucht dafür genau so viele Teams, wie die Zahlen vorsehen. Verteile sie über die <strong>Teamseite</strong>.
              </li>
              <li>
                <strong>Neu anlegen</strong> und <strong>Zurücknehmen</strong> gehen nur, solange die Saison geplant ist und zu keinem ihrer
                Spiele etwas eingetragen wurde: {RECORDED_FACTS_NONE}. Beide löschen die vorhandenen Spieltage und Spiele mit jedem Termin und
                jeder Uhrzeit. Es gibt in der Verwaltung keinen Weg zurück.
              </li>
              <li>
                <strong>Gruppen</strong>, <strong>Teams pro Gruppe</strong> und <strong>Qualifikanten</strong> gehören zum Spielplan: Sobald
                Spiele angesetzt sind, stehen sie im Abschnitt Regeln fest. Beim Neuanlegen gibst Du sie deshalb hier an, nach einer Rücknahme
                lassen sie sich im Abschnitt <strong>Regeln</strong> wieder einzeln ändern.
              </li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        {/* The standing report, which outlives the toast that first said it, and the one place the
            next steps are named: they are true of a season that now holds fixtures and of no other. */}
        {spielplan !== null && (
          <Callout
            severity="info"
            title="Der Spielplan steht">
            Angelegt am {formatSpielDatum(spielplan.generiert_am)}: {describeSpielplanUmfang(spielplan.spieltage, spielplan.spiele)}. Seinen
            Zeitraum bekommt jeder Spieltag auf seiner eigenen Seite. Termin, Ort und Schiedsrichter trägst Du danach an den Spielen ein.
          </Callout>
        )}

        {/* Offered only where BOTH stand open, which is a drawn planned season with nothing recorded.
            In every other state one operation is the whole offer and a picker would be a control with
            one reachable position. */}
        {bothOpen && (
          <ToggleButtonGroup
            aria-label="Was mit dem Spielplan passieren soll"
            size="sm"
            isDetached
            isDisabled={isWriting}
            selectionMode="single"
            selectedKeys={picked === null ? [] : [picked]}
            onSelectionChange={(keys: Set<Key>) => {
              const [next] = [...keys].map(String);
              // Disarms on every move: the reveal names one operation's losses, so a switch under an
              // armed panel would have the second press confirm what the first one never described.
              cancel();
              setPicked(next === "anlegen" || next === "zuruecknehmen" ? next : null);
            }}
            className="flex w-full flex-row flex-wrap gap-2">
            <ToggleButton
              id="anlegen"
              className={STUFE_CHIP}>
              Neu anlegen
            </ToggleButton>
            <ToggleButton
              id="zuruecknehmen"
              className={STUFE_CHIP}>
              Zurücknehmen
            </ToggleButton>
          </ToggleButtonGroup>
        )}

        {closedReason === null ? (
          <p className="fluid-sm text-foreground font-medium">
            {isDrawing ? (
              replacesDraw ? (
                <>
                  Neu anlegen zieht den Spielplan von Saison <strong>{saisonId}</strong> frisch. Der bisherige wird dabei gelöscht.
                </>
              ) : (
                <>
                  Anlegen erzeugt die Spieltage und alle Spiele von Saison <strong>{saisonId}</strong> in einem Schritt.
                </>
              )
            ) : (
              <>
                Zurücknehmen löscht die Spieltage und Spiele, die Saison <strong>{saisonId}</strong> jetzt hält.
              </>
            )}
          </p>
        ) : (
          /* In the body as well as on the control: `DisabledHint` opens on hover and on focus alone,
             so a reader who never points at a closed button would otherwise never learn why. */
          <p className="fluid-sm text-foreground-muted font-medium">{closedReason}</p>
        )}

        {/* Offered on a REPLACE alone, which is where the endpoint takes them: a first draw runs off
            the season's rules unchanged. Read-only once armed, so the confirmation cannot describe
            numbers that moved under it. */}
        {isDrawing && replacesDraw && (
          <div className="flex w-full flex-col gap-y-3">
            <h3 className={FORM_SECTION_HEADING}>Aufbau des neuen Spielplans</h3>
            {/* Said beside the boxes, not only in the hint: after a draw every offered group holds
                exactly its full count, so the two upper numbers move only once the groups do. */}
            <p className="fluid-xs text-foreground-muted font-medium">
              <strong>Qualifikanten</strong> kannst Du hier allein ändern. <strong>Gruppen</strong> und <strong>Teams pro Gruppe</strong> gelten
              erst, wenn die Gruppen dieser Saison genau dazu passen. Verteile die Teams also vorher über die <strong>Teamseite</strong>.
            </p>
            <div className={FIELD_TRIO}>
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
                  isReadOnly={isConfirming || isWriting}
                  value={shape[shapeKey]}
                  onChange={(next) => setShape({ ...shape, [shapeKey]: next })}
                />
              ))}
            </div>
          </div>
        )}

        {isConfirming && (
          <ConfirmReveal>
            <div className="flex w-full flex-col gap-y-3">
              {/* The loss before the gain: what this press destroys is the part of it that cannot be
                  looked up again afterwards, and the scheduling is the half no refusal protects. */}
              {holdsADraw && (
                <div className="flex w-full flex-col gap-y-1">
                  <h3 className={FORM_SECTION_HEADING}>Was dabei gelöscht wird</h3>
                  <dl className="flex w-full flex-col gap-y-1">
                    <ConfirmReadoutRow
                      label="Bisher angelegt"
                      value={describeSpielplanUmfang(spieltageCount, bestand.spiele)}
                    />
                    {/* No refusal reads this figure, which is why it is stated: a fully dated season is
                        replaced as readily as an undated one. */}
                    <ConfirmReadoutRow
                      label="Mit Termin oder Uhrzeit"
                      value={describeAngesetzteSpiele(bestand.angesetzt)}
                    />
                  </dl>
                </div>
              )}

              {isDrawing && (
                <>
                  {/* A moved number is read out from AND to: this press stores it, so an admin agreeing
                      to a redraw is agreeing to the season's new shape in the same breath. */}
                  <div className="flex w-full flex-col gap-y-1">
                    <h3 className={FORM_SECTION_HEADING}>{isShapeMoved ? "Aufbau, den diese Saison bekommt" : "Aufbau dieser Saison"}</h3>
                    <dl className="flex w-full flex-col gap-y-1">
                      {shapeRows.map((row) => (
                        // Keyed on the label, which is unique inside this list.
                        <ConfirmReadoutRow
                          key={row.label}
                          label={row.label}
                          value={row.value}
                        />
                      ))}
                    </dl>
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
                        <ConfirmReadoutRow
                          label="Umfang"
                          value={describeSpielplanUmfang(vorschau.spieltage, vorschau.spiele)}
                        />
                        {/* The label agrees with the list under it, and an empty list still reads `Keine`:
                            rules reaching no bracket close the control, so a blank value here would mean
                            the schedule moved under an already armed panel. */}
                        <ConfirmReadoutRow
                          label={vorschau.koRunden.length === 1 ? "KO-Runde" : "KO-Runden"}
                          value={vorschau.koRunden.length === 0 ? "Keine" : vorschau.koRunden.map((phase) => PHASE_LABELS[phase]).join(", ")}
                        />
                      </dl>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* A first draw on a PLANNED season is the one branch with a repair: the undraw beside it
                removes what this press writes (`REQ-SPIELPLAN-006`). Nothing replays the rows
                elsewhere, the log's images being a record to read rather than a restore. */}
            <p className="fluid-xxs text-foreground leading-normal font-medium">
              {holdsADraw
                ? "Die Spieltage und Spiele oben werden dabei gelöscht. Es gibt in der Verwaltung keinen Weg zurück."
                : saisonStatus === "future"
                  ? "Zurücknehmen lässt sich der Spielplan danach wieder hier, solange die Saison geplant ist und zu keinem ihrer Spiele etwas eingetragen wurde."
                  : "Zurücknehmen lässt sich ein Spielplan nur in einer geplanten Saison, und diese läuft bereits. Es gibt in der Verwaltung keinen Weg zurück."}
            </p>
          </ConfirmReveal>
        )}

        <ConfirmActionRow
          isConfirming={isConfirming}
          isPending={isWriting}
          onCancel={cancel}>
          {/* The reason is said on the control itself rather than only in the panel above it, the
              treatment the rollover established. `isWriting` is left out: it ends by itself. */}
          <DisabledHint reason={isWriting ? null : closedReason}>
            <Button
              type="button"
              variant="primary"
              isDisabled={isWriting || closedReason !== null}
              onPress={handlePress}
              className={confirmButton(isConfirming)}>
              {!isConfirming &&
                (isDrawing ? (
                  <Calendar
                    aria-hidden="true"
                    width={18}
                    height={18}
                  />
                ) : (
                  <CalendarXmark
                    aria-hidden="true"
                    width={18}
                    height={18}
                  />
                ))}
              {/* The object stays in every label: under a danger heading a bare verb is agreed to
                  without the reader having to hold what it refers to. */}
              {isDrawing
                ? isWriting
                  ? replacesDraw
                    ? "Wird neu angelegt..."
                    : "Wird angelegt..."
                  : isConfirming
                    ? replacesDraw
                      ? "Ja, löschen und neu anlegen"
                      : "Ja, Spielplan anlegen"
                    : replacesDraw
                      ? "Spielplan neu anlegen"
                      : "Spielplan anlegen"
                : isWriting
                  ? "Wird zurückgenommen..."
                  : isConfirming
                    ? "Ja, Spielplan zurücknehmen"
                    : "Spielplan zurücknehmen"}
            </Button>
          </DisabledHint>
        </ConfirmActionRow>
      </div>
    </section>
  );
}
