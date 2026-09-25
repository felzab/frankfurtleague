"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import Calendar from "@gravity-ui/icons/Calendar";
import CalendarXmark from "@gravity-ui/icons/CalendarXmark";

import { Label } from "@heroui/react/label";
import { ToggleButton } from "@heroui/react/toggle-button";
import { ToggleButtonGroup } from "@heroui/react/toggle-button-group";

import { generateSpielplanAction, undrawSpielplanAction } from "@/features/saisons/actions";
import { SaisonCountSelect, SaisonRuleNumberField } from "@/features/saisons/components/forms/SaisonFormControls";
import { STUFE_CHIP_CLASSES } from "@/features/saisons/components/forms/StufenPicker";
import { PHASE_LABELS } from "@/features/saisons/constants";
import { FLGenerateSpielplanPayloadSchema } from "@/features/saisons/schemas";
import {
  drawGroupCountOptions,
  drawnSpieltage,
  MAX_TEAMS_PER_GROUP,
  qualifierCountOptions,
  teamsPerGroupFloor,
} from "@/features/saisons/shapeOffer";
import {
  buildSpielplanVorschau,
  describeAngesetzteSpiele,
  describeSpielplanPermanenz,
  describeSpielplanUmfang,
  describeSpieltageCount,
} from "@/features/saisons/utils";
import { labelBadge } from "@/shared/components/ui/badges";
import { Callout } from "@/shared/components/ui/Callout";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import {
  FIELD_LABEL_CLASSES,
  FIELD_TRIO_CLASSES,
  FORM_SECTION_HEADING_CLASSES,
  TOGGLE_GROUP_ALIGN_CLASSES,
} from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { RequiredSchemas } from "@/shared/components/ui/RequiredMarks";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { rejectedWrite, unansweredAction } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import { spielplanHoldsADraw, spielplanPress, spielplanReplacesDraw } from "./blockedReasons";
import { describeShapeRows, readShape, SHAPE_FIELDS } from "./spielplanShape";

import type { FLSaisonRules, FLSaisonStatus, FLSpielplanShape } from "@/features/saisons/schemas";
import type { SaisonGruppenOccupancy, SaisonSpielplanContext } from "@/features/saisons/types";
import type { Key } from "@heroui/react/rac";
import type { SpielplanOperation } from "./blockedReasons";

/**
 * The season's fixture list, over `POST` and `DELETE /saisons/{saison_id}/spielplan`. **One panel and
 * one armed state for both**: on a drawn planned season each is open and each destroys the same
 * matchdays and fixtures, so the operation is picked before arming rather than raced between two
 * controls (`docs/frontend/spec.md :: I66`).
 *
 * **A confirmation step rather than an undo** on either write: one press writes, and nothing replays
 * the removed rows back (`docs/backend/spec.md :: I26`).
 */
export function FormSpielplanSection({
  saisonId,
  saisonStatus,
  rules,
  startDate,
  endDate,
  gruppenOccupancy,
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
  /** The season's STORED span: `REQ-DATE-005`'s mirror judges the season the press would draw, never a draft. */
  startDate: string;
  endDate: string;
  /**
   * How full this season's groups stand. **`REQ-SPIELPLAN-004` asks each offered group for exactly
   * `teams_per_group`**, so the boxes' own floors admit redraw shapes the entries do not fit, which the
   * press is closed over.
   */
  gruppenOccupancy: SaisonGruppenOccupancy;
  /** `REQ-SPIELPLAN-001`: the season already holds fixtures, whoever put them there. */
  hasDrawnSpiele: boolean;
  /** Runs before either write; `false` cancels. The editor refuses while a draft is unsaved. */
  onBeforeWrite: () => boolean;
} & SaisonSpielplanContext) {
  const twoPress = useTwoPressConfirm(onBeforeWrite);
  const router = useRouter();
  const { isConfirming, isPending: isWriting, press, cancel } = twoPress;

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
    startDate,
    endDate,
    vorschauSpieltage: vorschau.spieltage,
    gruppen: { groups: rules.number_of_groups, teams: rules.teams_per_group, occupancy: gruppenOccupancy },
  };

  const holdsADraw = spielplanHoldsADraw(controlInput);
  // Derived from the same input as the press below, so the sentence the admin agrees to and the
  // flag the request carries can never describe different operations.
  const replacesDraw = spielplanReplacesDraw(controlInput);

  // Null until the admin picks: each write destroys the same rows, so a preselection would arm the
  // operation nobody read.
  const [picked, setPicked] = useState<SpielplanOperation | null>(null);

  // The standing reason is the closure the page stands in, which the body states as well as the control.
  const { bothOpen, operation, isUnchosen, standingReason, closedReason } = spielplanPress({ input: controlInput, picked, shape });
  const isDrawing = operation === "anlegen";

  // The closure the callout below states as a rule, which is the whole of what a reader in this state
  // needs: a hint and a banner on one panel never carry the same fact (`docs/frontend/spec.md` §1.12).
  const isClosureCalledOut = holdsADraw && saisonStatus === "active";

  // Graded on the act ON OFFER, so a first draw stays neutral: it destroys nothing, and the undraw is never
  // on offer without the replace.
  const panel = formPanel({ tone: replacesDraw ? "danger" : "neutral" });

  // ONE expression for all three boxes: react-aria's `Select` has no read-only state, so the trio's
  // two halves spell the freeze differently and a control left off either spelling would still be
  // live under a confirmation that has already read it.
  const isShapeFrozen = isConfirming || isWriting;

  // Against the STORED rules, so the readout states the move an admin would otherwise only discover
  // afterwards. A first draw offers no fields, leaving every row unmoved.
  const shapeRows = describeShapeRows(readShape(rules), shape);
  const isShapeMoved = shapeRows.some((row) => row.isChanged);

  // Taken at the press and never re-derived while the write runs: a season moving under it moves the operation
  // on offer, and the running press would then name a write nobody sent.
  const [runningLabel, setRunningLabel] = useState("");

  const handlePress = () => {
    setRunningLabel(isDrawing ? (replacesDraw ? "Legt neu an..." : "Legt an...") : "Nimmt zurück...");

    // What makes the guard's second run load-bearing here: the draw READS the rules it is guarded
    // against, so a draft typed after arming would go with the refresh while the draw used the stored ones.
    press(async () => {
      // A rejected action may still have saved, and uncaught here either write takes the page down with it.
      if (isDrawing) {
        // The shape rides along on a REPLACE alone: a first draw carries none, which is what tells the
        // endpoint to draw from the season's stored numbers and move nothing.
        const res = await generateSpielplanAction({ id: saisonId, replace: replacesDraw, shape: replacesDraw ? shape : undefined }).catch(
          unansweredAction,
        );

        if (!res.success) {
          appToast.failure(replacesDraw ? "Spielplan nicht neu angelegt" : "Spielplan nicht angelegt", res);
          return;
        }

        appToast.success(replacesDraw ? "Spielplan neu angelegt" : "Spielplan angelegt", { description: res.message });
      } else {
        const res = await undrawSpielplanAction({ id: saisonId }).catch(rejectedWrite(router));

        if (!res.success) {
          appToast.failure("Spielplan nicht zurückgenommen", res);
          return;
        }

        // Its own grade rather than a plain success: „zurückgenommen“ over a season that held nothing
        // would claim work nobody did. Not a failure either, a 200 with zeroes being the state asked for.
        const removedNothing =
          res.undraw !== undefined && res.undraw.spieltage === 0 && res.undraw.spiele === 0 && !res.undraw.watermark_cleared;

        const report = removedNothing ? appToast.info : appToast.success;
        report(removedNothing ? "Kein Spielplan vorhanden" : "Spielplan zurückgenommen", { description: res.message });
      }

      // Wrapped again: the press runs this inside its transition, and React leaves an update after an
      // `await` outside it.
      startTransition(() => {
        // Cleared with the write that consumed it: this operation is done, and a choice left standing
        // would preselect itself the next time both acts are open.
        setPicked(null);
      });
    });
  };

  // The object stays in both labels: under a danger heading a bare verb is agreed to without the
  // reader having to hold what it refers to.
  const restingLabel = isDrawing ? (replacesDraw ? "Spielplan neu anlegen" : "Spielplan anlegen") : "Spielplan zurücknehmen";
  const armedLabel = isDrawing ? (replacesDraw ? "Ja, löschen und neu anlegen" : "Ja, Spielplan anlegen") : "Ja, Spielplan zurücknehmen";

  return (
    <section className={panel.root()}>
      <div className={`${panel.header()} relative`}>
        {/* The one fact the heading cannot carry and every sentence below depends on. The rollover
            panel established the treatment. */}
        <span className="absolute top-1/2 right-4 -translate-y-1/2 sm:right-5">
          {holdsADraw ? (
            <span className={labelBadge("success")}>Spielplan steht</span>
          ) : (
            /* Warning rather than a label tone: a season with no fixtures cannot be played, so this is
               a state to leave rather than one of two equal ones. */
            <span className={labelBadge("warning")}>Kein Spielplan</span>
          )}
        </span>
        <PanelHeading
          className={panel.heading()}
          title="Spielplan">
          {/* The two bullets are the second half of the repair `REQ-RULES-011` sends an admin on, so
              this hint keeps its wayfinding where an ordinary one would lose it. */}
          <Hint
            mode="reveal"
            label="Hinweis zum Spielplan"
            body={{
              lead: "Der Spielplan umfasst die Spieltage und Spiele dieser Saison.",
              points: [
                { term: "Die Teams", text: "verteilst Du über die Teamseite." },
                {
                  term: "Gruppen, Teams pro Gruppe und Qualifikanten pro Gruppe",
                  text: "änderst Du im Abschnitt Regeln, sobald der Spielplan zurückgenommen ist.",
                },
              ],
            }}
          />
        </PanelHeading>
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

        {/* The rule behind the closure, in the panel rather than on the control alone. Scoped to
            `active` because the sentence is: a finished season is closed by its own branch of
            `spielplanBlockedReason`, in words about the state it stands in. */}
        {isClosureCalledOut && (
          <Callout
            severity="info"
            title="Der Spielplan lässt sich für laufende Saisons nicht neu anlegen"
          />
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
            className={`flex w-full flex-row flex-wrap gap-2 ${TOGGLE_GROUP_ALIGN_CLASSES}`}>
            <ToggleButton
              id="anlegen"
              className={STUFE_CHIP_CLASSES}>
              Neu anlegen
            </ToggleButton>
            <ToggleButton
              id="zuruecknehmen"
              className={STUFE_CHIP_CLASSES}>
              Zurücknehmen
            </ToggleButton>
          </ToggleButtonGroup>
        )}

        {isUnchosen ? (
          <p className="muted-hint">
            Beides löscht die Spieltage und Spiele, die Saison <strong>{saisonId}</strong> jetzt hält.
          </p>
        ) : standingReason === null ? (
          <p className="muted-hint">
            {isDrawing ? (
              replacesDraw ? (
                <>
                  Neu anlegen löscht den bisherigen Spielplan von Saison <strong>{saisonId}</strong> und legt ihn neu an.
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
          /* In the body as well as on the control: a refusal hint opens only on a hover or a press, so
             a reader who does neither never learns why. Except where the callout above already serves
             that reader. */
          !isClosureCalledOut && <p className="muted-hint">{standingReason}</p>
        )}

        {/* Offered on a REPLACE alone, which is where the endpoint takes them: a first draw runs off
            the season's rules unchanged. Frozen once armed, so the confirmation cannot describe
            numbers that moved under it. */}
        {isDrawing && replacesDraw && (
          // The draw's own payload, which the season's save around it never submits.
          <RequiredSchemas schemas={[FLGenerateSpielplanPayloadSchema]}>
            <div className="flex w-full flex-col gap-y-3">
              <h3 className={FORM_SECTION_HEADING_CLASSES}>Aufbau des neuen Spielplans</h3>
              <div className={FIELD_TRIO_CLASSES}>
                {SHAPE_FIELDS.map(({ key: shapeKey, label }) => {
                  if (shapeKey === "teams_per_group")
                    return (
                      <SaisonRuleNumberField
                        key={shapeKey}
                        // The payload's own path, so a refusal naming one of the three reaches the box
                        // that holds it. Nothing on the season's save bar spells a `shape.` path, so
                        // neither form can render the other's message.
                        name={`shape.${shapeKey}`}
                        label={<Label className={FIELD_LABEL_CLASSES}>{label}</Label>}
                        minValue={teamsPerGroupFloor({
                          qualifiers: shape.qualifiers_per_group,
                          held: shape.teams_per_group,
                          occupancy: gruppenOccupancy,
                        })}
                        maxValue={MAX_TEAMS_PER_GROUP}
                        isReadOnly={isShapeFrozen}
                        value={shape[shapeKey]}
                        // An emptied box is dropped rather than recorded: these three go straight into
                        // the draw's payload, so a null would reach the confirmation as a figure and
                        // the press as a refusal.
                        onChange={(next) => {
                          if (next !== null) setShape({ ...shape, [shapeKey]: next });
                        }}
                      />
                    );

                  return (
                    <SaisonCountSelect
                      key={shapeKey}
                      name={`shape.${shapeKey}`}
                      ariaLabel={label}
                      label={<Label className={FIELD_LABEL_CLASSES}>{label}</Label>}
                      isDisabled={isShapeFrozen}
                      // Against the DRAFT the boxes hold, so moving one moves what the next may reach:
                      // the three are judged together, and an offer read off the stored season would
                      // keep offering a product this press refuses.
                      options={
                        shapeKey === "number_of_groups"
                          ? drawGroupCountOptions({
                              groups: shape.number_of_groups,
                              qualifiers: shape.qualifiers_per_group,
                              teams: shape.teams_per_group,
                              occupancy: gruppenOccupancy,
                            })
                          : qualifierCountOptions({
                              groups: shape.number_of_groups,
                              qualifiers: shape.qualifiers_per_group,
                              teams: shape.teams_per_group,
                            })
                      }
                      value={shape[shapeKey]}
                      onChange={(next) => setShape({ ...shape, [shapeKey]: next })}
                    />
                  );
                })}
              </div>
            </div>
          </RequiredSchemas>
        )}

        {isConfirming && (
          <ConfirmReveal>
            <div className="flex w-full flex-col gap-y-3">
              {/* The loss before the gain: what this press destroys is the part of it that cannot be
                  looked up again afterwards, and the scheduling is the half no refusal protects. */}
              {holdsADraw && (
                <div className="flex w-full flex-col gap-y-1">
                  <h3 className={FORM_SECTION_HEADING_CLASSES}>Was dabei gelöscht wird</h3>
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
                    <h3 className={FORM_SECTION_HEADING_CLASSES}>
                      {isShapeMoved ? "Aufbau, den diese Saison bekommt" : "Aufbau dieser Saison"}
                    </h3>
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
                    <h3 className={FORM_SECTION_HEADING_CLASSES}>Daraus entsteht</h3>
                    {/* The served schedule was derived from the STORED numbers, so it describes no season once they move. */}
                    {isShapeMoved ? (
                      <>
                        <dl className="flex w-full flex-col gap-y-1">
                          {/* Mirrored rather than unknown: the press is already judged against this count. */}
                          <ConfirmReadoutRow
                            label="Spieltage"
                            value={describeSpieltageCount(drawnSpieltage(shape))}
                          />
                        </dl>
                        {/* The fixture count is mirrored nowhere, and a second derivation of the draw is what
                            `buildSpielplanVorschau` exists to avoid. */}
                        <p className="fluid-xs text-foreground font-medium">
                          Wie viele Spiele aus den neuen Zahlen entstehen, steht erst nach dem Anlegen fest.
                        </p>
                      </>
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

            <p className="fluid-xxs text-foreground leading-normal font-medium">{describeSpielplanPermanenz({ holdsADraw, saisonStatus })}</p>
          </ConfirmReveal>
        )}

        <ConfirmActionRow confirm={twoPress}>
          {/* The reason is said on the control itself rather than only in the panel above it, the
              treatment the rollover established. */}
          <ConfirmPressButton
            confirm={twoPress}
            reason={closedReason}
            resting={restingLabel}
            armed={armedLabel}
            running={runningLabel}
            icon={
              isDrawing ? (
                <Calendar
                  className="size-4.5"
                  aria-hidden="true"
                />
              ) : (
                <CalendarXmark
                  className="size-4.5"
                  aria-hidden="true"
                />
              )
            }
            onPress={handlePress}
          />
        </ConfirmActionRow>
      </div>
    </section>
  );
}
