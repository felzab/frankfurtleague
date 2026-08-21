"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { parseDate } from "@internationalized/date";

import { Form } from "@heroui/react";

import { patchSaisonAction } from "@/features/saisons/actions";
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
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";
import { appToast, UNDO_TIMEOUT_MS } from "@/shared/utils/appToast";

import { buildSaisonBanners } from "./banners";
import { FormGruppenSwapSection } from "./FormGruppenSwapSection";
import { FormRegelnSection } from "./FormRegelnSection";
import { FormRolloverSection } from "./FormRolloverSection";
import { FormZeitraumSection } from "./FormZeitraumSection";

import type { FLPatchSaisonPayload, FLSaisonRules, FLSaisonStatus } from "@/features/saisons/schemas";
import type { SaisonDraftFields, SaisonGruppenSwapContext, SaisonRolloverContext } from "@/features/saisons/types";
import type { FLSpielerStufe } from "@/features/spieler/schemas";
import type { BlockingBanners } from "@/shared/components/ui/railBanner";
import type { CalendarDate } from "@internationalized/date";
import type { ReactNode } from "react";

/**
 * A `fetch` and not a server action: by the time the offer is pressed this component is unmounted, and
 * an action dispatched from another route trips Next's E592 invariant and truncates mid-response.
 * **Revert once E592 is fixed upstream.**
 */
async function postSaisonUndo(payload: FLPatchSaisonPayload): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch("/api/admin/saisons/undo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The route answers 200 with the outcome in the body, so a non-2xx is a transport failure.
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}`);
  }

  return response.json() as Promise<{ success: boolean; message?: string; error?: string }>;
}

/**
 * **One save bar over ONE endpoint**: `PATCH /saisons/{saison_id}` replaces the dates and all of
 * `rules` in one write, so there is no partial-failure state to report. The rollover is a control
 * rather than a field, and never drafts.
 */
export function AdminSaisonEditForm({
  saison,
  rollover,
  swap,
  hasDrawnSpiele,
  spieltagBound,
  registerRequestLeave,
  pageHeader,
}: {
  saison: { id: string; status: FLSaisonStatus } & SaisonDraftFields;
  rollover: SaisonRolloverContext;
  /** This season's clubs and their groups, plus the knockout count that closes the swap. */
  swap: SaisonGruppenSwapContext;
  /** Whether the season holds fixtures, which is what freezes the rules they were drawn from. */
  hasDrawnSpiele: boolean;
  /** The span the live matchdays already occupy, which the date pickers may not shrink past. */
  spieltagBound?: { startMax: string; endMin: string };
  registerRequestLeave?: (requestLeave: () => void) => void;
  pageHeader?: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // `CalendarDate` in state, strings on the wire — `parseDate` takes exactly the `YYYY-MM-DD` the API
  // sends. A picker cleared to null is held as null, and the schema is what reports it.
  const [startDate, setStartDate] = useState<CalendarDate | null>(() => parseDate(saison.start_date));
  const [endDate, setEndDate] = useState<CalendarDate | null>(() => parseDate(saison.end_date));
  const [rules, setRules] = useState<FLSaisonRules>(saison.rules);

  const [hasSaved, setHasSaved] = useState(false);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [confirmingBanners, setConfirmingBanners] = useState<BlockingBanners | null>(null);
  const [hasLeftViaDiscard, setHasLeftViaDiscard] = useState(false);

  const { fieldErrors, setSubmitFieldErrors, validatePaths, formRef } = useDraftFieldErrors({
    schemas: { saison: FLPatchSaisonPayloadSchema },
    onUnhandledErrors: () =>
      appToast.danger("Speichern fehlgeschlagen", {
        description: "Der Server hat eine Angabe beanstandet, die dieses Formular nicht anzeigt. Lade die Seite neu.",
      }),
  });

  // `""` for a cleared picker rather than a cast: the schema refuses an empty string with the date
  // message, which is one the form can render on the field.
  const buildPayload = (): FLPatchSaisonPayload => ({
    id: saison.id,
    start_date: startDate?.toString() ?? "",
    end_date: endDate?.toString() ?? "",
    rules,
  });

  const draftFields: SaisonDraftFields = {
    start_date: startDate?.toString() ?? "",
    end_date: endDate?.toString() ?? "",
    rules,
  };
  const storedFields: SaisonDraftFields = { start_date: saison.start_date, end_date: saison.end_date, rules: saison.rules };

  const status = deriveSaisonDraftStatus({ stored: storedFields, draft: draftFields, fieldErrors });
  const isDirty = status.isDirty && !hasSaved;

  // The latch's job ends the moment the revalidated season arrives and the two agree; left latched,
  // every later edit on a restored tree read as not-dirty.
  if (hasSaved && !status.isDirty) setHasSaved(false);

  useUnsavedChangesWarning(isDirty);

  // Ctrl+S / Cmd+S submits, gated on the same conditions as the Speichern button.
  const canSubmitRef = useRef(true);
  useEffect(() => {
    canSubmitRef.current = !isPending && !isConfirmingDiscard && confirmingBanners === null && isDirty;
  });
  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (canSubmitRef.current) formRef.current?.requestSubmit();
      }
    };

    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [formRef]);

  const validateFields = (paths: readonly string[]) => validatePaths("saison", buildPayload(), paths);
  // Judged with the value that arrived rather than with state, which has not committed yet.
  const validateStufen = (next: FLSpielerStufe[]) =>
    validatePaths("saison", { ...buildPayload(), rules: { ...rules, erlaubte_stufen: next } }, ["rules.erlaubte_stufen"]);

  const isChanged = (path: string) => status.byPath.get(path)?.isChanged ?? false;
  const isEndBeforeStart = startDate !== null && endDate !== null && endDate.compare(startDate) < 0;

  const banners = buildSaisonBanners({
    saisonStatus: saison.status,
    isEndBeforeStart,
    qualifiersPerGroup: rules.qualifiers_per_group,
    teamsPerGroup: rules.teams_per_group,
    isPointsChanged: isChanged("rules.win_points") || isChanged("rules.draw_points"),
    isTiebreakChanged: isChanged("rules.tiebreak_order"),
    isStufenChanged: isChanged("rules.erlaubte_stufen"),
    outgoingSaisonId: rollover.outgoingSaisonId,
    offeneSpieleCount: rollover.offeneSpiele.length,
  });

  const leavePage = () => {
    // Blur first: react-aria's focus attribute survives a kept-alive tree.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    if (window.history.length > 1) router.back();
    else router.push("/admin/saisons");
  };

  const requestLeave = () => {
    if (isDirty) {
      setHasLeftViaDiscard(false);
      setIsConfirmingDiscard(true);
      return;
    }
    leavePage();
  };

  useEffect(() => {
    registerRequestLeave?.(requestLeave);
  });

  const resetDraftToStored = () => {
    setStartDate(parseDate(saison.start_date));
    setEndDate(parseDate(saison.end_date));
    setRules(saison.rules);

    setSubmitFieldErrors({}, {});
  };

  const discardAndLeave = () => {
    resetDraftToStored();
    setIsConfirmingDiscard(false);
    setHasLeftViaDiscard(true);
    leavePage();
  };

  /**
   * The rollover revalidates the route, so an unsaved draft would go with the replaced props. It says
   * what is in the way rather than discarding silently or stacking a second dialog.
   */
  const guardRolloverAgainstDraft = (): boolean => {
    if (!isDirty) return true;

    appToast.warning("Erst speichern", {
      description: "Die Umstellung lädt die Seite neu und würde die nicht gespeicherten Änderungen verwerfen.",
    });
    return false;
  };

  const requestSave = () => {
    // Snapshotted rather than read live: a background revalidation re-deriving the banners under an
    // open dialog would move the list the reader agreed to.
    const blocking = resolveBlockingBanners(banners);
    if (blocking !== null) {
      setConfirmingBanners(blocking);
      return;
    }
    handleFormSubmit();
  };

  const handleFormSubmit = () => {
    startTransition(async () => {
      // Built BEFORE the write, from this render's props: they still carry what was stored, and the
      // toast that offers the undo outlives this page.
      const undoPayload: FLPatchSaisonPayload = {
        id: saison.id,
        start_date: saison.start_date,
        end_date: saison.end_date,
        rules: saison.rules,
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

      offerUndo(undoPayload);

      // AFTER the undo payload is built: typed values left in state let a save-then-undo reopen on
      // values the season no longer holds.
      resetDraftToStored();
      leavePage();
    });
  };

  /**
   * The toast outlives this component, so the press runs detached — `AdminEditSpielDataForm` has the
   * pitfalls. **A warning, never a success, wherever the table moved**: it is scored and ordered from
   * `rules` on read, so the move goes unnoticed.
   */
  const offerUndo = (payload: FLPatchSaisonPayload) => {
    const pointsMoved = payload.rules.win_points !== rules.win_points || payload.rules.draw_points !== rules.draw_points;
    const tiebreakMoved = payload.rules.tiebreak_order !== rules.tiebreak_order;

    // The points first where both moved: a rescore subsumes a re-sort, and one toast holds one sentence.
    const description = pointsMoved
      ? "Die Punkte gelten ab sofort für jedes Spiel dieser Saison, auch für die längst gespielten."
      : tiebreakMoved
        ? "Punktgleiche Teams stehen ab sofort in einer anderen Reihenfolge, auch in längst gespielten Gruppen."
        : "Die Saisondaten wurden aktualisiert.";

    const report = pointsMoved || tiebreakMoved ? appToast.warning : appToast.success;
    report("Änderung gespeichert", {
      description,
      timeout: UNDO_TIMEOUT_MS,
      actionProps: {
        children: "Rückgängig",
        onPress: () => {
          appToast.clear();
          const pendingKey = appToast.pending("Änderung wird zurückgenommen...");

          void postSaisonUndo(payload).then(
            (result) => {
              appToast.close(pendingKey);
              if (!result.success) {
                appToast.danger("Rücknahme fehlgeschlagen", { description: result.error ?? "Die Änderung steht weiterhin." });
                return;
              }

              // Reported BEFORE the refresh: the restore is committed and nothing below changes that.
              appToast.success("Änderung zurückgenommen", { description: result.message });

              // Best-effort: a refresh that cannot run costs a stale screen, never the restore.
              try {
                router.refresh();
              } catch (refreshError) {
                console.warn("Undo committed, refresh failed", refreshError);
              }
            },
            (dispatchError) => {
              appToast.close(pendingKey);
              console.warn("Undo dispatch failed", dispatchError);
              appToast.danger("Rücknahme konnte nicht gesendet werden", {
                description: "Die Änderung steht weiterhin. Prüfe die Verbindung und die Saison.",
              });
            },
          );
        },
      },
    });
  };

  return (
    <DraftStatusProvider status={status}>
      <Form
        ref={formRef}
        validationErrors={fieldErrors}
        className="flex min-h-0 w-full flex-1 flex-col"
        onSubmit={runOnSubmit(requestSave)}>
        <EditFormLayout
          header={pageHeader}
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
            isDrawnSaison={hasDrawnSpiele}
            banners={banners}
          />

          {/* Above the rollover, and below the two field panels: a control rather than a field,
              but the one control on this page that a later run of itself undoes. */}
          <FormGruppenSwapSection
            saisonId={saison.id}
            swap={swap}
            isFinishedSaison={saison.status === "past"}
          />

          {/* Last on the page, the position the club editor's Austritt panel holds: the one
              control here that no later edit reverses on its own. It writes on press, so it never
              joins the save bar — one row cannot hold two promises about when. */}
          <FormRolloverSection
            saisonId={saison.id}
            saisonStatus={saison.status}
            rollover={rollover}
            onBeforeActivate={guardRolloverAgainstDraft}
            banners={banners}
          />
        </EditFormLayout>

        <FormActionBar
          isPending={isPending}
          onCancel={requestLeave}
        />
      </Form>

      {!hasLeftViaDiscard && (
        <ConfirmDiscardModal
          isOpen={isConfirmingDiscard}
          onClose={() => setIsConfirmingDiscard(false)}
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
