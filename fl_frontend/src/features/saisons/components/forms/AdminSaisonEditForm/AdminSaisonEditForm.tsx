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
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { resolveBlockingBanners } from "@/shared/components/ui/railBanner";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";
import { appToast } from "@/shared/utils/appToast";

import { buildSaisonBanners } from "./banners";
import { FormGruppenSwapSection } from "./FormGruppenSwapSection";
import { FormRegelnSection } from "./FormRegelnSection";
import { FormRolloverSection } from "./FormRolloverSection";
import { FormZeitraumSection } from "./FormZeitraumSection";
import { SaisonActionBar } from "./SaisonActionBar";
import { SaisonDraftStatusProvider } from "./SaisonDraftStatusContext";
import { SaisonRail } from "./SaisonRail";

import type { FLPatchSaisonPayload, FLSaisonRules, FLSaisonStatus } from "@/features/saisons/schemas";
import type { SaisonDraftFields, SaisonGruppenSwapContext, SaisonRolloverContext } from "@/features/saisons/types";
import type { FLSpielerStufe } from "@/features/spieler/schemas";
import type { BlockingBanners } from "@/shared/components/ui/railBanner";
import type { CalendarDate } from "@internationalized/date";
import type { ReactNode } from "react";

/**
 * How long the undo offer stands after a save. It stands
 * on every save, confirmed or not: a confirmation is the carve-out for a draft carrying a warning
 * or a danger, and undo is what still helps the admin who was not paying attention. The
 * rollover is not a save at all and carries its own confirmation — see `FormRolloverSection` for why.
 */
const UNDO_TIMEOUT_MS = 15000;

/**
 * Sends the undo, and it is a `fetch` rather than a server action for one reason (an undo belongs to
 * a page-owned editor, and nothing else becomes a route handler): by the time the offer is pressed
 * this component is unmounted and the browser is on another route, and a server action dispatched
 * from there trips Next's E592 invariant and is truncated mid-response.
 * **Revert this to a server action once E592 is fixed upstream.**
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
 * behind all of it — the match editor's shape over a season. Every field is controlled,
 * judged when it is left with the same schema the action parses, and marked in place when its draft
 * differs from stored.
 *
 * **One save bar over ONE endpoint**, unlike the club and squad editors: `PATCH /saisons/{saison_id}`
 * replaces the dates and the whole `rules` object in a single write, so there is no partial-failure
 * state to report. What this page has instead of a second endpoint is a second KIND of write — the
 * rollover, which is a control rather than a field and never touches the draft.
 *
 * **`status` reaches nothing here by construction.** It is on no payload, has no descriptor row, and no
 * state atom below holds it.
 */
export function AdminSaisonEditForm({
  saison,
  rollover,
  swap,
  spieltagBound,
  registerRequestLeave,
  pageHeader,
}: {
  saison: { id: string; status: FLSaisonStatus } & SaisonDraftFields;
  rollover: SaisonRolloverContext;
  /** This season's clubs and their groups, plus the knockout count that closes the swap. */
  swap: SaisonGruppenSwapContext;
  /** The span the live matchdays already occupy, which the date pickers may not shrink past. */
  spieltagBound?: { startMax: string; endMin: string };
  registerRequestLeave?: (requestLeave: () => void) => void;
  pageHeader?: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // The two dates are `CalendarDate` in state and strings on the wire — `parseDate` accepts exactly
  // the `YYYY-MM-DD` the API sends. Both are required on the payload, so a picker cleared to null is
  // held as null and the schema is what reports it.
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
  // message, which is the same complaint a null would deserve and one the form can render on the field.
  // `id` is the loaded record's own, already parsed, and the wire carries it in the path — so no
  // refusal can name it and no input renders it.
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

  // See the match editor: the latch's job ends the moment the revalidated season arrives and the two
  // agree — left latched, every later edit on a restored tree read as not-dirty.
  if (hasSaved && !status.isDirty) setHasSaved(false);

  useUnsavedChangesWarning(isDirty);

  // Ctrl+S / Cmd+S submits, gated on the same conditions as the Speichern button — the match editor's
  // reasoning, unchanged.
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
  // The picked-control variant — judged with the value that arrived rather than with state, which has
  // not committed yet (see the match editor's `validateSelection`).
  const validateStufen = (next: FLSpielerStufe[]) =>
    validatePaths("saison", { ...buildPayload(), rules: { ...rules, erlaubte_stufen: next } }, ["rules.erlaubte_stufen"]);

  const isChanged = (path: string) => status.byPath.get(path)?.isChanged ?? false;
  const isEndBeforeStart = startDate !== null && endDate !== null && endDate.compare(startDate) < 0;

  /** Every Hinweis this draft raises — the rail's list and the panels' inline callouts alike. */
  const banners = buildSaisonBanners({
    saisonStatus: saison.status,
    isEndBeforeStart,
    qualifiersPerGroup: rules.qualifiers_per_group,
    teamsPerGroup: rules.teams_per_group,
    isPointsChanged: isChanged("rules.win_points") || isChanged("rules.draw_points"),
    isStufenChanged: isChanged("rules.erlaubte_stufen"),
    outgoingSaisonId: rollover.outgoingSaisonId,
    offeneSpieleCount: rollover.offeneSpiele.length,
  });

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

    setSubmitFieldErrors({}, {});
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

  /**
   * What both submit routes reach first: a draft carrying a warning or a danger is confirmed, and a
   * clean one saves straight through. The write itself is unchanged either way, undo
   * included.
   */
  const requestSave = () => {
    // Snapshotted here rather than read live: the reader agrees to the list the gate stopped on,
    // and a background revalidation re-deriving the banners under an open dialog would move it.
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
        // ALWAYS toasted, field errors or not: the page stays here, and a failure that belongs to no
        // field would otherwise be silent.
        appToast.danger("Speichern fehlgeschlagen", {
          description: res.error ?? "Die Saison konnte nicht gespeichert werden.",
        });
        return;
      }

      setSubmitFieldErrors({}, {});
      setHasSaved(true);

      offerUndo(undoPayload);

      // AFTER the undo payload is built — see the match editor: leaving with typed values still in
      // state is what let a save-then-undo reopen on values the season no longer holds.
      resetDraftToStored();
      leavePage();
    });
  };

  /**
   * The undo toast: fifteen seconds to take the save back. The pitfalls the match editor documents
   * all apply and are all mirrored here: the toast outlives this component, so the press runs in a
   * detached closure — `router.refresh()` is what re-renders a screen the action's own revalidation
   * can no longer reach (the router instance is a stable singleton, legal after unmount); the replay
   * uses the TWO-ARGUMENT `then`, so a failure downstream of a committed restore is never blamed on
   * the transport; and the pending spinner is `appToast.pending`, closed by its own key, because a
   * toast without an explicit timeout inherits a four-second default that would retire it mid-flight.
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
                description: "Die Änderung steht weiterhin. Prüfe die Verbindung und die Saison.",
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
        onSubmit={runOnSubmit(requestSave)}>
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
                  banners={banners}
                />

                {/* Above the rollover, and below the two field panels: a control rather than a field,
                    but the one control on this page that a later run of itself undoes. */}
                <FormGruppenSwapSection
                  saisonId={saison.id}
                  swap={swap}
                  isFinishedSaison={saison.status === "past"}
                />

                {/* Last on the page, the position the club editor's Disqualifikation panel holds: the
                    one control here that does something no later edit reverses on its own. */}
                <FormRolloverSection
                  saisonId={saison.id}
                  saisonStatus={saison.status}
                  rollover={rollover}
                  onBeforeActivate={guardRolloverAgainstDraft}
                  banners={banners}
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
    </SaisonDraftStatusProvider>
  );
}
