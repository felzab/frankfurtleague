"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { parseDate } from "@internationalized/date";

import { Form } from "@heroui/react";

import { patchSaisonAction } from "@/features/saisons/actions";
import { PLACING_RULES_FIELDS, RESCORING_RULES_FIELDS } from "@/features/saisons/constants";
import { deriveSaisonDraftStatus } from "@/features/saisons/saisonDraftStatus";
import { FLPatchSaisonPayloadSchema } from "@/features/saisons/schemas";
import { ConfirmDiscardModal } from "@/shared/components/ui/ConfirmDiscardModal";
import { ConfirmSaveModal } from "@/shared/components/ui/ConfirmSaveModal";
import { DraftRail } from "@/shared/components/ui/DraftRail";
import { DraftStatusProvider } from "@/shared/components/ui/DraftStatusContext";
import { EditFormLayout } from "@/shared/components/ui/EditFormLayout";
import { FormActionBar } from "@/shared/components/ui/FormActionBar";
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { resolveBlockingBanners } from "@/shared/components/ui/railBanner";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { useEditorExit } from "@/shared/hooks/useEditorExit";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { useSaveShortcut } from "@/shared/hooks/useSaveShortcut";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";
import { appToast } from "@/shared/utils/appToast";
import { guardAgainstDraft } from "@/shared/utils/draftGuard";
import { offerUndo } from "@/shared/utils/undoDispatch";

import { buildSaisonBanners } from "./banners";
import { FormBewerbungSection } from "./FormBewerbungSection";
import { FormGruppenSwapSection } from "./FormGruppenSwapSection";
import { FormRegelnSection } from "./FormRegelnSection";
import { FormRolloverSection } from "./FormRolloverSection";
import { FormSpielplanSection } from "./FormSpielplanSection";
import { FormTeamErsatzSection } from "./FormTeamErsatzSection";
import { FormZeitraumSection } from "./FormZeitraumSection";

import type { FLPatchSaisonPayload, FLSaisonBewerbung, FLSaisonRules, FLSaisonStatus } from "@/features/saisons/schemas";
import type {
  FLSaisonRulesDraft,
  SaisonDraftFields,
  SaisonGruppenSwapContext,
  SaisonReplacementContext,
  SaisonRolloverContext,
  SaisonSpielplanContext,
  SaisonSpieltagBound,
} from "@/features/saisons/types";
import type { FLSpielerStufe } from "@/features/spieler/schemas";
import type { EditPageHeaderContent } from "@/shared/components/ui/EditPageHeader";
import type { BlockingBanners } from "@/shared/components/ui/railBanner";
import type { CalendarDate } from "@internationalized/date";

/**
 * **One save bar over ONE endpoint**: `PATCH /saisons/{saison_id}` replaces the dates and all of
 * `rules` in one write, so there is no partial-failure state to report. The rollover is a control
 * rather than a field, and never drafts.
 */
export function AdminSaisonEditForm({
  saison,
  rollover,
  swap,
  ersatz,
  spielplan,
  hasDrawnSpiele,
  spieltagBound,
  pageHeader,
}: {
  saison: { id: string; status: FLSaisonStatus } & Omit<SaisonDraftFields, "rules"> & { rules: FLSaisonRules };
  rollover: SaisonRolloverContext;
  /** This season's clubs and their groups, plus the knockout count that closes the swap. */
  swap: SaisonGruppenSwapContext;
  /** This season's junction rows, and the league's clubs that could take one of them over. */
  ersatz: SaisonReplacementContext;
  /** The season's draw watermark and its matchday count, which decide whether a draw is still offered. */
  spielplan: SaisonSpielplanContext;
  /** Whether the season holds fixtures, which is what freezes the rules they were drawn from. */
  hasDrawnSpiele: boolean;
  /** The span the dated matchdays already occupy, which the date pickers may not shrink past. */
  spieltagBound: SaisonSpieltagBound;
  pageHeader: EditPageHeaderContent;
}) {
  const router = useRouter();
  const saisonHref = useSaisonHref();
  const [isPending, startTransition] = useTransition();

  // `CalendarDate` in state, strings on the wire — `parseDate` takes exactly the `YYYY-MM-DD` the API
  // sends. A picker cleared to null is held as null, and the schema is what reports it.
  const [startDate, setStartDate] = useState<CalendarDate | null>(() => parseDate(saison.start_date));
  const [endDate, setEndDate] = useState<CalendarDate | null>(() => parseDate(saison.end_date));
  const [rules, setRules] = useState<FLSaisonRulesDraft>(saison.rules);
  // The whole block or `null`, never a boolean beside a span: `null` is the season that takes no
  // applications, and the panel is what turns one into the other.
  const [bewerbung, setBewerbung] = useState<FLSaisonBewerbung | null>(saison.bewerbung);

  const [hasSaved, setHasSaved] = useState(false);
  const [confirmingBanners, setConfirmingBanners] = useState<BlockingBanners | null>(null);

  const { fieldErrors, setSubmitFieldErrors, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { saison: FLPatchSaisonPayloadSchema },
  });

  type SaisonPatchDraft = Omit<FLPatchSaisonPayload, "rules"> & { rules: FLSaisonRulesDraft };

  const buildPayload = (): SaisonPatchDraft => ({
    id: saison.id,
    // `""` for a cleared picker rather than a cast: the schema refuses an empty string with the date
    // message, which is one the form can render on the field.
    start_date: startDate?.toString() ?? "",
    end_date: endDate?.toString() ?? "",
    rules,
    bewerbung,
  });

  const draftFields: SaisonDraftFields = {
    start_date: startDate?.toString() ?? "",
    end_date: endDate?.toString() ?? "",
    rules,
    bewerbung,
  };
  const storedFields: SaisonDraftFields = {
    start_date: saison.start_date,
    end_date: saison.end_date,
    rules: saison.rules,
    bewerbung: saison.bewerbung,
  };

  const status = deriveSaisonDraftStatus({ stored: storedFields, draft: draftFields, fieldErrors });
  const isDirty = status.isDirty && !hasSaved;

  // The latch's job ends the moment the revalidated season arrives and the two agree; left latched,
  // every later edit on a restored tree read as not-dirty.
  if (hasSaved && !status.isDirty) setHasSaved(false);

  useUnsavedChangesWarning(isDirty);

  // Forgiveness runs on every draft change and only ever RETRACTS: a corrected field clears without a blur.
  useForgiveFixed({ saison: buildPayload() });

  const validateFields = (paths: readonly string[]) => validatePaths("saison", buildPayload(), paths);
  // Judged with the value that arrived rather than with state, which has not committed yet.
  const validateStufen = (next: FLSpielerStufe[]) =>
    validatePaths("saison", { ...buildPayload(), rules: { ...rules, erlaubte_stufen: next } }, ["rules.erlaubte_stufen"]);

  /**
   * **Only the way OUT is judged**: closing the window clears the dates' standing messages, where
   * opening one would flag two empty pickers nobody has typed in yet.
   */
  const changeBewerbung = (next: FLSaisonBewerbung | null) => {
    setBewerbung(next);
    if (next === null) {
      validatePaths("saison", { ...buildPayload(), bewerbung: next }, ["bewerbung", "bewerbung.offen", "bewerbung.von", "bewerbung.bis"]);
    }
  };

  const isChanged = (path: string) => status.byPath.get(path)?.isChanged ?? false;
  // Named by the rules field the mirror holds, so a field moved between its lists needs no second edit here.
  const isRuleChanged = (field: string) => isChanged(`rules.${field}`);
  const isEndBeforeStart = startDate !== null && endDate !== null && endDate.compare(startDate) < 0;

  const banners = buildSaisonBanners({
    saisonStatus: saison.status,
    isEndBeforeStart,
    qualifiersPerGroup: rules.qualifiers_per_group,
    teamsPerGroup: rules.teams_per_group,
    isRescoringChanged: RESCORING_RULES_FIELDS.some(isRuleChanged),
    isPlacingChanged: PLACING_RULES_FIELDS.some(isRuleChanged),
    isStufenChanged: isChanged("rules.erlaubte_stufen"),
    hasDrawnSpiele,
    outgoingSaisonId: rollover.outgoingSaisonId,
    offeneSpieleCount: rollover.offeneSpiele.length,
  });

  const resetDraftToStored = () => {
    setStartDate(parseDate(saison.start_date));
    setEndDate(parseDate(saison.end_date));
    setRules(saison.rules);
    setBewerbung(saison.bewerbung);

    setSubmitFieldErrors({}, {});
  };

  const { isLeaving, leavePage, isConfirmingDiscard, closeDiscard, hasLeftViaDiscard, requestLeave, discardAndLeave } = useEditorExit({
    fallbackHref: saisonHref("/admin/saisons"),
    isDirty,
    resetDraftToStored,
  });

  useSaveShortcut(formRef, !isPending && !isConfirmingDiscard && confirmingBanners === null && isDirty);

  const requestSave = () => {
    // Snapshotted, not read live: a background revalidation would move the list under the dialog.
    const blocking = resolveBlockingBanners(banners);
    if (blocking !== null) {
      setConfirmingBanners(blocking);
      return;
    }
    handleFormSubmit();
  };

  const handleFormSubmit = () => {
    // The block keeping an incomplete draft off the wire; it RUNS the write (`docs/frontend/spec.md :: I71`).
    guardSubmit({ saison: buildPayload() }, writeAfterBlock);
  };

  const writeAfterBlock = () => {
    startTransition(async () => {
      // Built BEFORE the write, from this render's props: they still carry what was stored, and the
      // toast that offers the undo outlives this page.
      const undoPayload: FLPatchSaisonPayload = {
        id: saison.id,
        start_date: saison.start_date,
        end_date: saison.end_date,
        rules: saison.rules,
        bewerbung: saison.bewerbung,
      };

      const payload = buildPayload();
      const res = await patchSaisonAction(payload);

      if (!res.success) {
        setSubmitFieldErrors(res.fieldErrors ?? {}, { saison: payload });
        // ALWAYS toasted, field errors or not: a failure belonging to no field would be silent.
        appToast.danger("Speichern fehlgeschlagen", {
          description: res.error ?? "Die Saison konnte nicht gespeichert werden.",
        });
        return;
      }

      setSubmitFieldErrors({}, {});
      setHasSaved(true);

      // A warning, never a success, wherever the table moved: it is scored and ordered from `rules`
      // on read, so the move goes unnoticed.
      const pointsMoved = undoPayload.rules.win_points !== rules.win_points || undoPayload.rules.draw_points !== rules.draw_points;
      const tiebreakMoved = undoPayload.rules.tiebreak_order !== rules.tiebreak_order;

      offerUndo({
        endpoint: "/api/admin/saisons/undo",
        body: undoPayload,
        // The points first where both moved: a rescore subsumes a re-sort, and one toast holds one
        // sentence.
        message: pointsMoved
          ? "Die Punkte gelten ab sofort für jedes Spiel dieser Saison, auch für die längst gespielten."
          : tiebreakMoved
            ? "Punktgleiche Teams stehen ab sofort in einer anderen Reihenfolge, auch in längst gespielten Gruppen."
            : undefined,
        // Passed on the quiet branch too, where it all but restates the title: `offerUndo`'s
        // `fallback` carries why the register asks for a sentence there anyway.
        fallback: "Die Saisondaten wurden aktualisiert.",
        warn: pointsMoved || tiebreakMoved,
        router,
      });

      // AFTER the undo payload is built: typed values left in state let a save-then-undo reopen on
      // values the season no longer holds.
      resetDraftToStored();
      leavePage();
    });
  };

  return (
    <DraftStatusProvider status={status}>
      <Form
        // `aria`, never `native`: missing belongs to the submit, not a blur (`docs/frontend/spec.md :: I40`, `:: I71`).
        validationBehavior="aria"
        ref={formRef}
        validationErrors={fieldErrors}
        className="flex min-h-0 w-full flex-1 flex-col"
        onSubmit={runOnSubmit(requestSave)}>
        <EditFormLayout
          header={pageHeader}
          onLeave={requestLeave}
          isLeaving={isLeaving}
          rail={
            <DraftRail
              banners={banners}
              nomen="Saison"
            />
          }>
          <FormZeitraumSection
            startDate={startDate}
            onStartDateChange={setStartDate}
            endDate={endDate}
            onEndDateChange={setEndDate}
            onFieldLeft={validateFields}
            spieltagBound={spieltagBound}
            banners={banners}
          />

          <FormRegelnSection
            rules={rules}
            onRulesChange={setRules}
            onFieldLeft={validateFields}
            onStufenChange={(next) => {
              setRules({ ...rules, erlaubte_stufen: next });
              validateStufen(next);
            }}
            isFinishedSaison={saison.status === "past"}
            // `REQ-RULES-012` off the SAME count `FormGruppenSwapSection` closes on for `REQ-SWAP-002`:
            // both rules read a played knockout fixture, so one derivation keeps the two panels agreeing.
            isKnockoutStarted={swap.playedKnockoutSpiele > 0}
            isDrawnSaison={hasDrawnSpiele}
            banners={banners}
          />

          {/* Its own panel and not a row of the Zeitraum above: that span is when the season is
              PLAYED, and a window may legitimately open before it and close long before the first
              fixture. */}
          <FormBewerbungSection
            bewerbung={bewerbung}
            onBewerbungChange={changeBewerbung}
            onFieldLeft={validateFields}
          />

          {/* Above the rollover, and below the field panels: a control rather than a field,
              but the one control on this page that a later run of itself undoes. */}
          <FormGruppenSwapSection
            saisonId={saison.id}
            swap={swap}
            isFinishedSaison={saison.status === "past"}
          />

          {/* Beside the swap, which it reads as a sibling of — both hand a junction row on — and
              ahead of the two panels that move the season itself. Its class is theirs, though: it
              writes on press and no later edit reverses it. */}
          <FormTeamErsatzSection
            saisonId={saison.id}
            ersatz={ersatz}
            isFinishedSaison={saison.status === "past"}
          />

          {/* Between the swap and the rollover, in the rollover's class of control. */}
          <FormSpielplanSection
            saisonId={saison.id}
            saisonStatus={saison.status}
            // The STORED rules, never the draft: the draw reads what is saved, and `schedule` beside it was
            // derived from exactly these, so a typed value leaves the preview contradicting itself.
            rules={saison.rules}
            // The STORED span for the same reason: `REQ-DATE-005`'s mirror judges the season the
            // press would draw, and typed dates are refused before arming (`onBeforeWrite`).
            startDate={saison.start_date}
            endDate={saison.end_date}
            {...spielplan}
            hasDrawnSpiele={hasDrawnSpiele}
            // One sentence for both writes: the draw runs on the saved rules and the rücknahme reopens
            // them, so neither may run over a draft, and both end on the refresh that would drop it.
            onBeforeWrite={() => guardAgainstDraft(isDirty, "Der Spielplan entsteht aus den gespeicherten Regeln, nicht aus den getippten.")}
          />

          {/* Last on the page, the position the club editor's Austritt panel holds: the one
              control here that no later edit reverses on its own. It writes on press, so it never
              joins the save bar — one row cannot hold two promises about when. */}
          <FormRolloverSection
            saisonId={saison.id}
            saisonStatus={saison.status}
            rollover={rollover}
            hasDrawnSpiele={hasDrawnSpiele}
            onBeforeActivate={() => guardAgainstDraft(isDirty, "Die Umstellung verwirft die nicht gespeicherten Änderungen.")}
            banners={banners}
          />
        </EditFormLayout>

        <FormActionBar
          isPending={isPending}
          isLeaving={isLeaving}
          onCancel={requestLeave}
        />
      </Form>

      {!hasLeftViaDiscard && (
        <ConfirmDiscardModal
          isOpen={isConfirmingDiscard}
          onClose={closeDiscard}
          onDiscard={discardAndLeave}
          changeCount={status.changed.length}
        />
      )}

      {/* Closed rather than unmounted on confirm, unlike the discard dialog: the write is awaited
          before anything navigates, so the exit animation has run long before the tree is left. */}
      <ConfirmSaveModal
        banners={confirmingBanners}
        onClose={() => setConfirmingBanners(null)}
        onConfirm={() => {
          setConfirmingBanners(null);
          handleFormSubmit();
        }}
      />
    </DraftStatusProvider>
  );
}
