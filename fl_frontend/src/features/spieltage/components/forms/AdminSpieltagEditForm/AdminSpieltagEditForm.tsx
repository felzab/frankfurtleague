"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Form } from "@heroui/react";

import { patchSpieltagAction } from "@/features/spieltage/actions";
import { FLPatchSpieltagPayloadSchema } from "@/features/spieltage/schemas";
import { deriveSpieltagDraftStatus } from "@/features/spieltage/spieltagDraftStatus";
import { buildSpieltagPhaseOffer } from "@/features/spieltage/utils";
import { ConfirmDiscardModal } from "@/shared/components/ui/ConfirmDiscardModal";
import { ConfirmSaveModal } from "@/shared/components/ui/ConfirmSaveModal";
import { resolveRailBanners } from "@/shared/components/ui/railBanner";
import { useDraftValidation } from "@/shared/hooks/useDraftValidation";
import { useServerFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";
import { appToast } from "@/shared/utils/appToast";

import { buildSpieltagBanners, standsAtThePhaseFloor } from "./banners";
import { FormPhaseSection } from "./FormPhaseSection";
import { FormStilllegenSection } from "./FormStilllegenSection";
import { FormZeitraumSection } from "./FormZeitraumSection";
import { SpieltagActionBar } from "./SpieltagActionBar";
import { SpieltagDraftStatusProvider } from "./SpieltagDraftStatusContext";
import { SpieltagRail } from "./SpieltagRail";

import type { FLSaisonPhase, FLSaisonPhaseSchedule } from "@/features/saisons/schemas";
import type { FLPatchSpieltagPayload } from "@/features/spieltage/schemas";
import type { FLSpieltagDraftFields } from "@/features/spieltage/spieltagDraftStatus";
import type { AdminSpieltagRow, SpieltagEditDraft } from "@/features/spieltage/types";
import type { ReactNode } from "react";

/**
 * How long the undo offer stands after a save (ADR-0041's window, ADR-0049's transport). It stands
 * on every save, confirmed or not: a confirmation is the carve-out for a draft carrying a warning
 * or a danger, and undo is what still helps the admin who was not paying attention (ADR-0070).
 */
const UNDO_TIMEOUT_MS = 15000;

/**
 * Sends the undo, and it is a `fetch` rather than a server action for one reason (ADR-0049: an undo
 * belongs to a page-owned editor, and nothing else becomes a route handler): by the time the offer
 * is pressed this component is unmounted and the browser is on another route, and a server action
 * dispatched from there trips Next's E592 invariant and is truncated mid-response.
 * **Revert this to a server action once E592 is fixed upstream**; the ADR names that condition.
 */
async function postSpieltagUndo(payload: FLPatchSpieltagPayload): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch("/api/admin/spieltage/undo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The route answers 200 with the outcome in the body for every reportable case, so a non-2xx is
    // a genuine transport failure and belongs in the rejection branch.
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}`);
  }

  return response.json() as Promise<{ success: boolean; message?: string; error?: string }>;
}

/**
 * The matchday editor's form: three panels over three fields, a sticky summary rail, and one
 * derivation behind both — the match editor's shape (ADR-0040) over a matchday.
 *
 * **Three fields on a page is ADR-0072's decision and not an oversight.** What earns the page is what
 * the form has to SAY rather than how much it holds: the name, the position and the expected match
 * count are all derived and none of them is a field (ADR-0051, ADR-0052), and six backend refusals
 * stand behind the three controls that are. The rail is where all of that goes.
 */
export function AdminSpieltagEditForm({
  spieltag,
  saisonSpan,
  saisonSchedule,
  livePhaseCount,
  registerRequestLeave,
  pageHeader,
}: {
  spieltag: AdminSpieltagRow;
  /** The season's own span, which bounds both date pickers (`REQ-DATE-002`). */
  saisonSpan?: { start: string; end: string };
  /** The season's derived per-phase counts, which decide what the phase picker may offer (ADR-0052). */
  saisonSchedule?: readonly FLSaisonPhaseSchedule[];
  /** Live matchdays the STORED phase holds, this one included — half of `REQ-RETIRE-005`. */
  livePhaseCount: number;
  registerRequestLeave?: (requestLeave: () => void) => void;
  pageHeader?: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [phase, setPhase] = useState<FLSaisonPhase | null>(spieltag.saison_phase);
  const [beginn, setBeginn] = useState(spieltag.beginn);
  const [ende, setEnde] = useState(spieltag.ende);

  const [hasSaved, setHasSaved] = useState(false);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [isConfirmingSave, setIsConfirmingSave] = useState(false);
  const [hasLeftViaDiscard, setHasLeftViaDiscard] = useState(false);

  const {
    fieldErrors: serverFieldErrors,
    setFieldErrors,
    formRef,
  } = useServerFieldErrors(() =>
    appToast.danger("Speichern fehlgeschlagen", {
      description: "Der Server hat eine Angabe beanstandet, die dieses Formular nicht anzeigt. Lade die Seite neu.",
    }),
  );

  const validation = useDraftValidation(FLPatchSpieltagPayloadSchema);

  const buildPayload = (): SpieltagEditDraft => ({ id: spieltag.id, beginn, ende, saison_phase: phase });

  const draftFields: FLSpieltagDraftFields = { beginn, ende, saison_phase: phase };
  const storedFields: FLSpieltagDraftFields = {
    beginn: spieltag.beginn,
    ende: spieltag.ende,
    saison_phase: spieltag.saison_phase,
  };

  const fieldErrors = validation.mergedWith(serverFieldErrors);
  const status = deriveSpieltagDraftStatus({ stored: storedFields, draft: draftFields, fieldErrors });
  const isDirty = status.isDirty && !hasSaved;

  // See the match editor: the latch's job ends the moment the revalidated matchday arrives and the
  // two agree — left latched, every later edit on a restored tree read as not-dirty.
  if (hasSaved && !status.isDirty) setHasSaved(false);

  useUnsavedChangesWarning(isDirty);

  // Ctrl+S / Cmd+S submits, gated on the same conditions as the Speichern button — the match
  // editor's reasoning, unchanged.
  const canSubmitRef = useRef(true);
  useEffect(() => {
    canSubmitRef.current = !isPending && !isConfirmingDiscard && !isConfirmingSave && isDirty;
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

  // Both dates are pickers rather than typed fields, so every control on this form is judged on
  // change (ADR-0040) — and the cross-field span rule reports on `ende`, so both paths refresh
  // together or its message never clears.
  const validatePicked = (paths: readonly string[], picked: Partial<FLSpieltagDraftFields>) =>
    validation.validatePaths({ ...buildPayload(), ...picked }, paths);

  const isZeitraumChanged = status.changed.some((field) => field.group === "Zeitraum");

  // The browser's half of `REQ-SPIELTAG-002`: a phase accounting for fewer matches than this matchday
  // already holds would leave the rest with nowhere to be played, so the picker does not offer it.
  const phaseOffer = buildSpieltagPhaseOffer(saisonSchedule ?? [], spieltag.spieleAngelegt);
  const impliedPhaseCount = (saisonSchedule ?? []).find((entry) => entry.phase === spieltag.saison_phase)?.matchdays ?? 0;

  /** Every Hinweis this draft raises — the rail's list and the panels' inline callouts alike. */
  const banners = buildSpieltagBanners({
    label: spieltag.label,
    inactiveSince: spieltag.inactive_since,
    storedPhase: spieltag.saison_phase,
    draftPhase: phase,
    isZeitraumChanged,
    isEndeVorBeginn: beginn !== "" && ende !== "" && ende < beginn,
    spieleAngelegt: spieltag.spieleAngelegt,
    anzahlSpiele: spieltag.anzahl_spiele,
    spieleGespielt: spieltag.spieleGespielt,
    livePhaseCount,
    impliedPhaseCount,
  });

  // What the save asks about first (ADR-0070). Resolved, so a banner the rail is not showing cannot
  // be raised in a dialog the admin has no way to reconcile with the page behind it.
  const blockingBanners = resolveRailBanners(banners).filter((banner) => banner.severity !== "info");

  // The two facts `REQ-RETIRE-002` and `REQ-RETIRE-005` turn on, answered from what the page already
  // holds. The endpoint stays the authority: a fixture scored in another tab reaches it.
  const isRetireable = spieltag.spieleGespielt === 0 && !standsAtThePhaseFloor(livePhaseCount, impliedPhaseCount);

  const leavePage = () => {
    // Blur first — see the match editor: react-aria's focus attribute survives a kept-alive tree.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    if (window.history.length > 1) router.back();
    else router.push("/admin/spieltage");
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
    setPhase(spieltag.saison_phase);
    setBeginn(spieltag.beginn);
    setEnde(spieltag.ende);

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
   * What both submit routes reach first: a draft carrying a warning or a danger is confirmed, and a
   * clean one saves straight through (ADR-0070). The write itself is unchanged either way, undo
   * included.
   */
  const requestSave = () => {
    if (blockingBanners.length > 0) {
      setIsConfirmingSave(true);
      return;
    }
    handleFormSubmit();
  };

  const handleFormSubmit = () => {
    startTransition(async () => {
      // Read before the write, because the props still hold the pre-save values here and the toast
      // that replays them outlives this component (ADR-0041, ADR-0049).
      const undoPayload: FLPatchSpieltagPayload = {
        id: spieltag.id,
        beginn: spieltag.beginn,
        ende: spieltag.ende,
        saison_phase: spieltag.saison_phase,
      };
      // Only what the admin cannot see from the form itself earns a sentence: where the matchday now
      // sits in the season, which is decided by the two fields above and shown on another page.
      const positionTouched = isZeitraumChanged || phase !== spieltag.saison_phase;

      const res = await patchSpieltagAction(buildPayload());
      if (!res.success) {
        setFieldErrors(res.fieldErrors ?? {});
        appToast.danger("Speichern fehlgeschlagen", { description: res.error ?? "Der Spieltag konnte nicht gespeichert werden." });
        return;
      }

      setFieldErrors({});
      validation.clearVerdicts();
      setHasSaved(true);

      offerUndo(undoPayload, positionTouched ? "Name und Position des Spieltags ergeben sich neu aus Phase und Beginn." : undefined);

      // AFTER the undo payload is built, which reads the props rather than these atoms — see the
      // match editor: leaving with typed values still in state is what let a save-then-undo reopen
      // on values the matchday no longer holds.
      resetDraftToStored();
      leavePage();
    });
  };

  /**
   * The undo toast: fifteen seconds to take the save back (ADR-0041's window over ADR-0049's
   * transport). The pitfalls the match editor documents all apply and are all mirrored here: the
   * toast outlives this component, so the press runs in a detached closure — `router.refresh()` is
   * what re-renders a screen the action's own revalidation can no longer reach (the router instance
   * is a stable singleton, legal after unmount); the replay uses the TWO-ARGUMENT `then`, so a
   * failure downstream of a committed restore is never blamed on the transport; and the pending
   * spinner is `appToast.pending`, closed by its own key, because a toast without an explicit
   * timeout inherits a four-second default that would retire it mid-flight.
   *
   * **The replay can be refused, and the message says which one refused it.** The undo is an ordinary
   * `PATCH` and meets the same rules the save did, so a matchday moved back into a span another tab
   * has since narrowed comes back as `REQ-DATE-003` rather than as a restore — which is correct, and
   * the toast reports it as the change still standing.
   */
  const offerUndo = (payload: FLPatchSpieltagPayload, message?: string) => {
    appToast.success("Änderung gespeichert", {
      description: message ?? "Der Spieltag wurde aktualisiert.",
      // A decision window, not a reading time — the one case where the text's length does not
      // govern the toast's duration.
      timeout: UNDO_TIMEOUT_MS,
      actionProps: {
        children: "Rückgängig",
        onPress: () => {
          appToast.clear();
          const pendingKey = appToast.pending("Änderung wird zurückgenommen...");

          void postSpieltagUndo(payload).then(
            (result) => {
              appToast.close(pendingKey);
              if (!result.success) {
                appToast.danger("Rücknahme fehlgeschlagen", { description: result.error ?? "Die Änderung steht weiterhin." });
                return;
              }

              // Reported BEFORE the refresh: the restore is committed and nothing below changes that.
              appToast.success("Änderung zurückgenommen", { description: result.message });

              // Best-effort, never allowed to fail the undo — a refresh that cannot run costs a
              // stale screen until the next navigation, not the restore.
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
                description: "Die Änderung steht weiterhin. Prüfe die Verbindung und den Spieltag.",
              });
            },
          );
        },
      },
    });
  };

  return (
    <SpieltagDraftStatusProvider status={status}>
      {/* The match editor's shell: the inner container scrolls the page and the action bar is its
          STATIC sibling below, where nothing can move it. */}
      <Form
        ref={formRef}
        validationErrors={fieldErrors}
        className="flex min-h-0 w-full flex-1 flex-col"
        action={() => requestSave()}>
        <div className="min-h-0 w-full flex-1 scrollbar-gutter-stable overflow-y-auto px-4 pt-6 pb-10 sm:px-8">
          <div className="max-w-page mx-auto flex w-full flex-col">
            {pageHeader}

            <div className="grid w-full grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:gap-8">
              <div className="w-full xl:sticky xl:top-6 xl:col-start-2 xl:row-start-1 xl:self-start">
                <SpieltagRail banners={banners} />
              </div>

              <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 xl:col-start-1 xl:row-start-1 xl:mx-0 xl:max-w-none">
                <FormPhaseSection
                  phase={phase}
                  onChange={(next) => {
                    setPhase(next);
                    validatePicked(["saison_phase"], { saison_phase: next });
                  }}
                  phaseOffer={phaseOffer}
                  banners={banners}
                />

                <FormZeitraumSection
                  beginn={beginn}
                  ende={ende}
                  onBeginnChange={(next) => {
                    setBeginn(next);
                    // Both paths, because the span refinement reports on `ende` whichever date moved.
                    validatePicked(["beginn", "ende"], { beginn: next });
                  }}
                  onEndeChange={(next) => {
                    setEnde(next);
                    validatePicked(["beginn", "ende"], { ende: next });
                  }}
                  saisonSpan={saisonSpan}
                  banners={banners}
                />

                {/* Last on the page and in the danger tone, the position the squad editor's Austragen
                    panel holds. */}
                <FormStilllegenSection
                  spieltagId={spieltag.id}
                  label={spieltag.label}
                  inactiveSince={spieltag.inactive_since}
                  isRetireable={isRetireable}
                  banners={banners}
                />
              </div>
            </div>
          </div>
        </div>

        <SpieltagActionBar
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
        isOpen={isConfirmingSave}
        onClose={() => setIsConfirmingSave(false)}
        onConfirm={() => {
          setIsConfirmingSave(false);
          handleFormSubmit();
        }}
        banners={blockingBanners}
      />
    </SpieltagDraftStatusProvider>
  );
}
