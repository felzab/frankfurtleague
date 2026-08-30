"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Form } from "@heroui/react";

import { patchSpieltagAction } from "@/features/spieltage/actions";
import { buildPatchSpieltagPayloadSchema } from "@/features/spieltage/schemas";
import { deriveSpieltagDraftStatus } from "@/features/spieltage/spieltagDraftStatus";
import { ConfirmDiscardModal } from "@/shared/components/ui/ConfirmDiscardModal";
import { ConfirmSaveModal } from "@/shared/components/ui/ConfirmSaveModal";
import { DraftRail } from "@/shared/components/ui/DraftRail";
import { DraftStatusProvider } from "@/shared/components/ui/DraftStatusContext";
import { EditFormLayout } from "@/shared/components/ui/EditFormLayout";
import { FormActionBar } from "@/shared/components/ui/FormActionBar";
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { resolveBlockingBanners } from "@/shared/components/ui/railBanner";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";
import { appToast, UNDO_TIMEOUT_MS } from "@/shared/utils/appToast";

import { buildSpieltagBanners } from "./banners";
import { FormZeitraumSection } from "./FormZeitraumSection";

import type { FLPatchSpieltagPayload } from "@/features/spieltage/schemas";
import type { FLSpieltagDraftFields } from "@/features/spieltage/spieltagDraftStatus";
import type { AdminSpieltagEditRow } from "@/features/spieltage/types";
import type { EditPageHeaderContent } from "@/shared/components/ui/EditPageHeader";
import type { BlockingBanners } from "@/shared/components/ui/railBanner";

/**
 * A `fetch` and not a server action: by the time the offer is pressed this component is unmounted, and
 * an action dispatched from another route trips Next's E592 invariant and truncates mid-response.
 * **Revert once E592 is fixed upstream.**
 */
async function postSpieltagUndo(payload: FLPatchSpieltagPayload): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch("/api/admin/spieltage/undo", {
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
 * The matchday editor's form. **A page carrying one date or two is deliberate**: what earns the page
 * is what the form has to SAY, the backend refusals standing behind those controls. The rail is where
 * all of that goes.
 */
export function AdminSpieltagEditForm({
  spieltag,
  saisonSpan,
  pageHeader,
}: {
  spieltag: AdminSpieltagEditRow;
  /** The season's own span, which bounds every date picker (`REQ-DATE-002`). */
  saisonSpan?: { start: string; end: string };
  pageHeader: EditPageHeaderContent;
}) {
  const router = useRouter();
  const saisonHref = useSaisonHref();
  const [isPending, startTransition] = useTransition();
  const [isLeaving, startLeaving] = useTransition();

  // An undated matchday enters as the empty string, which is the same state a cleared picker leaves
  // behind — so one branch below covers both, and the schema refuses the save either way.
  const [beginn, setBeginn] = useState(spieltag.beginn ?? "");
  const [ende, setEnde] = useState(spieltag.ende ?? "");

  // The final is one match, so its matchday is played inside one day and is dated once. Read off
  // `saison_phase` and never off the label, which is composed for the page and is not the identity.
  const isSingleDay = spieltag.saison_phase === "finale";

  const [hasSaved, setHasSaved] = useState(false);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [confirmingBanners, setConfirmingBanners] = useState<BlockingBanners | null>(null);
  const [hasLeftViaDiscard, setHasLeftViaDiscard] = useState(false);

  const { fieldErrors, setSubmitFieldErrors, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    // The span rule is the edited season's, so the schema is built per instance rather than imported.
    schemas: { spieltag: buildPatchSpieltagPayloadSchema(saisonSpan) },
  });

  // `id` is the loaded record's own and the wire carries it in the path, so no refusal can name it.
  const buildPayload = (): FLPatchSpieltagPayload => ({ id: spieltag.id, beginn, ende });

  const draftFields: FLSpieltagDraftFields = { beginn, ende };
  const storedFields: FLSpieltagDraftFields = { beginn: spieltag.beginn ?? "", ende: spieltag.ende ?? "" };

  const status = deriveSpieltagDraftStatus({ stored: storedFields, draft: draftFields, fieldErrors, isSingleDay });
  const isDirty = status.isDirty && !hasSaved;

  // The latch's job ends the moment the revalidated matchday arrives and the two agree; left
  // latched, every later edit on a restored tree read as not-dirty.
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

  // Every date is picked rather than typed, so every control is judged on change — and the cross-field
  // span rule reports on `ende`, so both paths refresh together or its message never clears.
  useForgiveFixed({ spieltag: buildPayload() });

  const validatePicked = (paths: readonly string[], picked: Partial<FLSpieltagDraftFields>) =>
    validatePaths("spieltag", { ...buildPayload(), ...picked }, paths);

  const isZeitraumChanged = status.changed.some((field) => field.group === "Zeitraum");

  const banners = buildSpieltagBanners({
    isZeitraumChanged,
    isEndeVorBeginn: beginn !== "" && ende !== "" && ende < beginn,
    spieleAngelegt: spieltag.spieleAngelegt,
    anzahlSpiele: spieltag.anzahl_spiele,
  });

  const leavePage = () => {
    // Blur first: react-aria's focus attribute survives a kept-alive tree.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    // Hover next, and the disabled flag is what ends it: `useHover` clears `data-hovered` when a
    // control turns disabled, and no `pointerleave` follows a click that leaves.
    startLeaving(() => {
      if (window.history.length > 1) router.back();
      else router.push(saisonHref("/admin/spieltage"));
    });
  };

  const requestLeave = () => {
    if (isDirty) {
      setHasLeftViaDiscard(false);
      setIsConfirmingDiscard(true);
      return;
    }
    leavePage();
  };

  const resetDraftToStored = () => {
    setBeginn(spieltag.beginn ?? "");
    setEnde(spieltag.ende ?? "");

    setSubmitFieldErrors({}, {});
  };

  const discardAndLeave = () => {
    resetDraftToStored();
    setIsConfirmingDiscard(false);
    setHasLeftViaDiscard(true);
    leavePage();
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
    // `aria` blocks nothing natively, so this call is what keeps an incomplete draft off the wire, in the
    // schema's own German rather than the browser's bubble. It RUNS the write, so there is no answer to drop.
    guardSubmit({ spieltag: buildPayload() }, writeAfterBlock);
  };

  const writeAfterBlock = () => {
    startTransition(async () => {
      // Read before the write: the props still hold the pre-save values, and the toast that replays
      // them outlives this component. The payload carries both dates or neither of them, so no replay
      // can ask the endpoint to take the dates away again.
      const undoPayload: FLPatchSpieltagPayload | null =
        spieltag.beginn === null || spieltag.ende === null ? null : { id: spieltag.id, beginn: spieltag.beginn, ende: spieltag.ende };

      const payload = buildPayload();
      const res = await patchSpieltagAction(payload);
      if (!res.success) {
        setSubmitFieldErrors(res.fieldErrors ?? {}, { spieltag: payload });
        appToast.danger("Speichern fehlgeschlagen", { description: res.error ?? "Der Spieltag konnte nicht gespeichert werden." });
        return;
      }

      setSubmitFieldErrors({}, {});
      setHasSaved(true);

      if (undoPayload === null) appToast.success("Änderung gespeichert", { description: "Der Spieltag hat jetzt einen Zeitraum." });
      else offerUndo(undoPayload);

      // AFTER the undo payload is built, which reads the props rather than these atoms: typed values
      // left in state let a save-then-undo reopen on values the matchday no longer holds.
      resetDraftToStored();
      leavePage();
    });
  };

  /**
   * The toast outlives this component, so the press runs detached — `AdminEditSpielDataForm` has the
   * pitfalls. **The replay can be refused**: it is an ordinary `PATCH`, so a span narrowed meanwhile
   * comes back as `REQ-DATE-003` rather than a restore.
   */
  const offerUndo = (payload: FLPatchSpieltagPayload) => {
    appToast.success("Änderung gespeichert", {
      description: "Der Spieltag wurde aktualisiert.",
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
                // The connection alone: the request never reached a judgement, so naming
                // the Spieltag would send the admin to inspect values nothing here read.
                description: "Die Änderung steht weiterhin. Prüfe die Verbindung.",
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
        // Missing belongs to the submit, not to a blur: `native` commits on every DOM `change`, painting
        // the browser's required message the moment an edited field is cleared. `aria` keeps
        // `aria-required` and leaves every message to `useDraftFieldErrors`.
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
              nomen="Spieltag"
            />
          }>
          <FormZeitraumSection
            beginn={beginn}
            ende={ende}
            isSingleDay={isSingleDay}
            onBeginnChange={(next) => {
              setBeginn(next);
              // One picked day fills both ends of a single-day matchday's span, so the payload keeps
              // the pair the endpoint takes and the save path stays the one every matchday uses.
              if (isSingleDay) setEnde(next);
              // Both paths, because the span refinement reports on `ende` whichever date moved.
              validatePicked(["beginn", "ende"], isSingleDay ? { beginn: next, ende: next } : { beginn: next });
            }}
            onEndeChange={(next) => {
              setEnde(next);
              validatePicked(["beginn", "ende"], { ende: next });
            }}
            saisonSpan={saisonSpan}
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
