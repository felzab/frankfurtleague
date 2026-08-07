"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { parseDate } from "@internationalized/date";

import { Form } from "@heroui/react";

import { patchSaisonAction } from "@/features/saisons/actions";
import { deriveSaisonDraftStatus } from "@/features/saisons/saisonDraftStatus";
import { FLPatchSaisonPayloadSchema } from "@/features/saisons/schemas";
import { ConfirmDiscardModal } from "@/shared/components/ui/ConfirmDiscardModal";
import { useDraftValidation } from "@/shared/hooks/useDraftValidation";
import { useServerFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";
import { appToast } from "@/shared/utils/appToast";

import { FormRegelnSection } from "./FormRegelnSection";
import { FormRolloverSection } from "./FormRolloverSection";
import { FormZeitraumSection } from "./FormZeitraumSection";
import { SaisonActionBar } from "./SaisonActionBar";
import { SaisonDraftStatusProvider } from "./SaisonDraftStatusContext";
import { SaisonRail } from "./SaisonRail";

import type { FLPatchSaisonPayload, FLSaisonRules, FLSaisonStatus } from "@/features/saisons/schemas";
import type { SaisonDraftFields, SaisonRolloverContext } from "@/features/saisons/types";
import type { FLSpielerStufe } from "@/features/spieler/schemas";
import type { CalendarDate } from "@internationalized/date";
import type { ReactNode } from "react";
import type { SaisonRailBanner } from "./SaisonRail";

/**
 * How long the undo offer stands after a save (ADR-0051's window, ADR-0062's transport). There is no
 * confirmation dialog on the SAVE for the same reason as the other three editors: confirmation and undo
 * are alternatives, and undo is the one that helps the admin who was not paying attention. The rollover
 * is the exception and carries its own confirmation — see `FormRolloverSection` for why.
 */
const UNDO_TIMEOUT_MS = 15000;

/**
 * Sends the undo, and it is a `fetch` rather than a server action for one reason (ADR-0062, which
 * widened ADR-0060's boundary to cover every page-owned editor): by the time the offer is pressed this
 * component is unmounted and the browser is on another route, and a server action dispatched from there
 * trips Next's E592 invariant and is truncated mid-response.
 * **Revert this to a server action once E592 is fixed upstream**; the ADR names that condition.
 */
async function postSaisonUndo(payload: FLPatchSaisonPayload): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch("/api/admin/saisons/undo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The route answers 200 with the outcome in the body for every reportable case, so a non-2xx is a
    // genuine transport failure and belongs in the rejection branch.
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}`);
  }

  return response.json() as Promise<{ success: boolean; message?: string; error?: string }>;
}

/**
 * The season editor's form: two panels, the rollover control, a sticky summary rail, and one derivation
 * behind all of it — the match editor's shape (ADR-0050) over a season. Every field is controlled,
 * judged when it is left with the same schema the action parses, and marked in place when its draft
 * differs from stored.
 *
 * **One save bar over ONE endpoint**, unlike the club and squad editors: `PATCH /saisons/{saison_id}`
 * replaces the dates and the whole `rules` object in a single write, so there is no partial-failure
 * state to report. What this page has instead of a second endpoint is a second KIND of write — the
 * rollover, which is a control rather than a field and never touches the draft (ADR-0033).
 *
 * **`status` reaches nothing here by construction.** It is on no payload, has no descriptor row, and no
 * state atom below holds it.
 */
export function AdminSaisonEditForm({
  saison,
  rollover,
  registerRequestLeave,
  pageHeader,
}: {
  saison: { id: string; status: FLSaisonStatus } & SaisonDraftFields;
  rollover: SaisonRolloverContext;
  registerRequestLeave?: (requestLeave: () => void) => void;
  pageHeader?: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // The two dates are `CalendarDate` in state and strings on the wire — the picker's own shape, and
  // `parseDate` accepts exactly the `YYYY-MM-DD` the API sends. Both are required on the payload, so
  // there is no null to represent; a picker cleared to null is held as null and the schema is what
  // reports it.
  const [startDate, setStartDate] = useState<CalendarDate | null>(() => parseDate(saison.start_date));
  const [endDate, setEndDate] = useState<CalendarDate | null>(() => parseDate(saison.end_date));
  const [rules, setRules] = useState<FLSaisonRules>(saison.rules);

  const [hasSaved, setHasSaved] = useState(false);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [hasLeftViaDiscard, setHasLeftViaDiscard] = useState(false);

  const {
    fieldErrors: serverFieldErrors,
    setFieldErrors,
    formRef,
  } = useServerFieldErrors(() =>
    appToast.danger("Speichern fehlgeschlagen", {
      description: "Der Server hat eine Angabe beanstandet, die dieses Formular nicht anzeigt. Bitte lade die Seite neu.",
    }),
  );

  const validation = useDraftValidation(FLPatchSaisonPayloadSchema);

  // `""` for a cleared picker rather than a cast: the schema refuses an empty string with the date
  // message, which is the same complaint a null would deserve and one the form can render on the field.
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

  const fieldErrors = validation.mergedWith(serverFieldErrors);
  const status = deriveSaisonDraftStatus({ stored: storedFields, draft: draftFields, fieldErrors });
  const isDirty = status.isDirty && !hasSaved;

  // See the match editor: the latch's job ends the moment the revalidated season arrives and the two
  // agree — left latched, every later edit on a restored tree read as not-dirty.
  if (hasSaved && !status.isDirty) setHasSaved(false);

  useUnsavedChangesWarning(isDirty);

  // Ctrl+S / Cmd+S submits, gated on the same conditions as the Speichern button — the match editor's
  // reasoning, unchanged.
  const canSubmitRef = useRef(true);
  useEffect(() => {
    canSubmitRef.current = !isPending && !isConfirmingDiscard && isDirty;
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

  const validateFields = (paths: readonly string[]) => validation.validatePaths(buildPayload(), paths);
  // The picked-control variant — judged with the value that arrived rather than with state, which has
  // not committed yet (see the match editor's `validateSelection`).
  const validateStufen = (next: FLSpielerStufe[]) =>
    validation.validatePaths({ ...buildPayload(), rules: { ...rules, erlaubte_stufen: next } }, ["rules.erlaubte_stufen"]);

  const isChanged = (path: string) => status.byPath.get(path)?.isChanged ?? false;
  const isEndBeforeStart = startDate !== null && endDate !== null && endDate.compare(startDate) < 0;

  /** The rail's mirror of every warning shown inline somewhere on the page. */
  const banners: SaisonRailBanner[] = [];

  if (saison.status === "active") {
    banners.push({
      severity: "info",
      title: "Diese Saison läuft",
      body: "Jede Seite ohne ausgewählte Saison zeigt sie, und eine Änderung an den Punkten ist sofort in jeder Tabelle sichtbar.",
    });
  }
  if (saison.status === "past") {
    banners.push({
      severity: "info",
      title: "Diese Saison ist abgeschlossen",
      body: "Ihre Spiele und Tabellen bleiben abrufbar. Eine Regeländerung wirkt rückwirkend auf ihre Tabelle.",
    });
  }
  if (isEndBeforeStart) {
    banners.push({
      severity: "warning",
      title: "Das Ende liegt vor dem Beginn",
      body: "Nichts verlangt diese Reihenfolge, gespeichert wird es also. Meistens ist es ein Zahlendreher im Jahr.",
    });
  }
  if (rules.qualifiers_per_group > rules.teams_per_group) {
    banners.push({
      severity: "warning",
      title: "Mehr Qualifikanten als Teams pro Gruppe",
      body: "Die KO.-Runde erwartet dann mehr Mannschaften, als eine Gruppe hergeben kann.",
    });
  }
  // The one edit on this page whose effect is retroactive and invisible at the field: the league table
  // is scored on every read rather than stored (ADR-0026), so the numbers move without a migration and
  // without anything announcing that they did.
  if (isChanged("rules.win_points") || isChanged("rules.draw_points")) {
    banners.push({
      severity: "warning",
      title: "Punkte wirken auf die ganze Saison",
      body: "Die Tabelle wird bei jedem Aufruf neu gerechnet, also gelten die neuen Punkte auch für längst gespielte Spiele.",
    });
  }
  if (isChanged("rules.erlaubte_stufen")) {
    banners.push({
      severity: "info",
      title: "Stufen begrenzen nur die Auswahl",
      body: "Bestehende Kadereinträge behalten ihre Stufe, auch eine, die diese Saison nicht mehr anbietet.",
    });
  }

  const leavePage = () => {
    // Blur first — see the match editor: react-aria's focus attribute survives a kept-alive tree.
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

  /** Every atom back to what is stored — both exits run it; see the match editor's reasoning. */
  const resetDraftToStored = () => {
    setStartDate(parseDate(saison.start_date));
    setEndDate(parseDate(saison.end_date));
    setRules(saison.rules);

    setFieldErrors({});
    validation.clearVerdicts();
  };

  const discardAndLeave = () => {
    resetDraftToStored();
    setIsConfirmingDiscard(false);
    setHasLeftViaDiscard(true);
    leavePage();
  };

  /**
   * The rollover refuses while a draft is unsaved.
   *
   * It revalidates the route, so the props under this form are replaced and the typed-but-unsaved
   * values go with them. Rather than discard silently or open a second discard dialog beside the
   * rollover's own confirmation, it says what is in the way and leaves the two decisions separate.
   */
  const guardRolloverAgainstDraft = (): boolean => {
    if (!isDirty) return true;

    appToast.warning("Erst speichern", {
      description: "Die Umstellung lädt die Seite neu und würde die nicht gespeicherten Änderungen verwerfen.",
    });
    return false;
  };

  const handleFormSubmit = () => {
    startTransition(async () => {
      // Built BEFORE the write, from this render's props: they still carry what was stored, and the
      // toast that offers the undo outlives this page (ADR-0051, ADR-0062).
      const undoPayload: FLPatchSaisonPayload = {
        id: saison.id,
        start_date: saison.start_date,
        end_date: saison.end_date,
        rules: saison.rules,
      };

      const res = await patchSaisonAction(buildPayload());

      if (!res.success) {
        setFieldErrors(res.fieldErrors ?? {});
        // ALWAYS toasted, field errors or not: the page stays here, and a failure that belongs to no
        // field would otherwise be silent.
        appToast.danger("Speichern fehlgeschlagen", {
          description: res.error ?? "Die Saison konnte nicht gespeichert werden.",
        });
        return;
      }

      setFieldErrors({});
      validation.clearVerdicts();
      setHasSaved(true);

      offerUndo(undoPayload);

      // AFTER the undo payload is built — see the match editor: leaving with typed values still in
      // state is what let a save-then-undo reopen on values the season no longer holds.
      resetDraftToStored();
      leavePage();
    });
  };

  /**
   * The undo toast: fifteen seconds to take the save back (ADR-0051's window over ADR-0062's
   * transport). The pitfalls the match editor documents all apply and are all mirrored here: the toast
   * outlives this component, so the press runs in a detached closure — `router.refresh()` is what
   * re-renders a screen the action's own revalidation can no longer reach (the router instance is a
   * stable singleton, legal after unmount); the replay uses the TWO-ARGUMENT `then`, so a failure
   * downstream of a committed restore is never blamed on the transport; and the pending spinner is
   * `appToast.pending`, closed by its own key, because a toast without an explicit timeout inherits a
   * four-second default that would retire it mid-flight.
   *
   * **A warning rather than a success where the points moved**, which the club editor's undo also does:
   * every standing for this season was rescored by the save, and a table that silently reads
   * differently is the one consequence nobody watching this page would notice.
   */
  const offerUndo = (payload: FLPatchSaisonPayload) => {
    const pointsMoved = payload.rules.win_points !== rules.win_points || payload.rules.draw_points !== rules.draw_points;

    const report = pointsMoved ? appToast.warning : appToast.success;
    report("Änderung gespeichert", {
      description: pointsMoved
        ? "Die Punkte gelten ab sofort für jedes Spiel dieser Saison, auch für die längst gespielten."
        : "Die Saisondaten wurden aktualisiert.",
      // A decision window, not a reading time — the one case where the text's length does not govern
      // the toast's duration.
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

              // Best-effort, never allowed to fail the undo — a refresh that cannot run costs a stale
              // screen until the next navigation, not the restore.
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
                description: "Die Änderung steht weiterhin. Bitte prüfe die Verbindung und die Saison.",
              });
            },
          );
        },
      },
    });
  };

  return (
    <SaisonDraftStatusProvider status={status}>
      {/* The match editor's shell: the inner container scrolls the page and the action bar is its
          STATIC sibling below, where nothing can move it. */}
      <Form
        ref={formRef}
        validationErrors={fieldErrors}
        className="flex min-h-0 w-full flex-1 flex-col"
        action={() => handleFormSubmit()}>
        <div className="min-h-0 w-full flex-1 scrollbar-gutter-stable overflow-y-auto px-4 pt-6 pb-10 sm:px-8">
          <div className="max-w-page mx-auto flex w-full flex-col">
            {pageHeader}

            <div className="grid w-full grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:gap-8">
              <div className="w-full xl:sticky xl:top-6 xl:col-start-2 xl:row-start-1 xl:self-start">
                <SaisonRail banners={banners} />
              </div>

              <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 xl:col-start-1 xl:row-start-1 xl:mx-0 xl:max-w-none">
                <FormZeitraumSection
                  startDate={startDate}
                  onStartDateChange={setStartDate}
                  endDate={endDate}
                  onEndDateChange={setEndDate}
                  onFieldLeft={validateFields}
                  isEndBeforeStart={isEndBeforeStart}
                />

                <FormRegelnSection
                  rules={rules}
                  onRulesChange={setRules}
                  onFieldLeft={validateFields}
                  onStufenChange={(next) => {
                    setRules({ ...rules, erlaubte_stufen: next });
                    validateStufen(next);
                  }}
                  stufenError={fieldErrors["rules.erlaubte_stufen"]}
                  isLiveSaison={saison.status === "active"}
                />

                {/* Last on the page, the position the club editor's Disqualifikation panel holds: the
                    one control here that does something no later edit reverses on its own. */}
                <FormRolloverSection
                  saisonId={saison.id}
                  saisonStatus={saison.status}
                  rollover={rollover}
                  onBeforeActivate={guardRolloverAgainstDraft}
                />
              </div>
            </div>
          </div>
        </div>

        <SaisonActionBar
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
    </SaisonDraftStatusProvider>
  );
}
