"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Form } from "@heroui/react";

import { patchSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { FLPatchSchiedsrichterPayloadSchema } from "@/features/schiedsrichter/schemas";
import { deriveSchiedsrichterDraftStatus } from "@/features/schiedsrichter/schiedsrichterDraftStatus";
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

import { buildSchiedsrichterBanners } from "./banners";
import { FormHonorarSection } from "./FormHonorarSection";
import { FormKontaktSection } from "./FormKontaktSection";
import { FormPersonSection } from "./FormPersonSection";

import type { FLPatchSchiedsrichterPayload } from "@/features/schiedsrichter/schemas";
import type { FLSchiedsrichterDraftFields } from "@/features/schiedsrichter/schiedsrichterDraftStatus";
import type { BlockingBanners } from "@/shared/components/ui/railBanner";
import type { FLKontakt } from "@/shared/schemas";
import type { ReactNode } from "react";

/**
 * A `fetch` and not a server action: by the time the offer is pressed this component is unmounted,
 * and a server action dispatched from there trips Next's E592 invariant. Revert to a server action
 * once E592 is fixed upstream.
 */
async function postSchiedsrichterUndo(payload: FLPatchSchiedsrichterPayload): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch("/api/admin/schiedsrichter/undo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The route answers 200 with the outcome in the body for every reportable case, so a non-2xx is a
    // genuine transport failure.
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}`);
  }

  return response.json() as Promise<{ success: boolean; message?: string; error?: string }>;
}

/**
 * One save bar over one endpoint, unlike the squad editor's two: a referee is a single document with
 * no junction row, so the patch carries the whole draft and a partial failure is not a state this
 * form can reach.
 */
export function AdminSchiedsrichterEditForm({
  schiedsrichter,
  isRetired,
  registerRequestLeave,
  pageHeader,
}: {
  schiedsrichter: { id: string; name: string; schule: string | null; kontakt: FLKontakt; default_payment: number };
  /** A fact about the row rather than a field this form commits, so it arrives beside the values. */
  isRetired: boolean;
  registerRequestLeave?: (requestLeave: () => void) => void;
  pageHeader?: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(schiedsrichter.name);
  const [schule, setSchule] = useState(schiedsrichter.schule);
  const [kontakt, setKontakt] = useState<FLKontakt>(schiedsrichter.kontakt);
  const [defaultPayment, setDefaultPayment] = useState(schiedsrichter.default_payment);

  const [hasSaved, setHasSaved] = useState(false);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [confirmingBanners, setConfirmingBanners] = useState<BlockingBanners | null>(null);
  const [hasLeftViaDiscard, setHasLeftViaDiscard] = useState(false);

  const { fieldErrors, setSubmitFieldErrors, validatePaths, formRef } = useDraftFieldErrors({
    schemas: { schiedsrichter: FLPatchSchiedsrichterPayloadSchema },
    onUnhandledErrors: () =>
      appToast.danger("Speichern fehlgeschlagen", {
        description: "Der Server hat eine Angabe beanstandet, die dieses Formular nicht anzeigt. Lade die Seite neu.",
      }),
  });

  // The wire carries `id` in the path, so no refusal can name it and no input renders it.
  const buildPayload = (): FLPatchSchiedsrichterPayload => ({
    id: schiedsrichter.id,
    name,
    schule,
    kontakt,
    default_payment: defaultPayment,
  });

  const draftFields: FLSchiedsrichterDraftFields = { name, schule, kontakt, default_payment: defaultPayment };
  const storedFields: FLSchiedsrichterDraftFields = {
    name: schiedsrichter.name,
    schule: schiedsrichter.schule,
    kontakt: schiedsrichter.kontakt,
    default_payment: schiedsrichter.default_payment,
  };

  const status = deriveSchiedsrichterDraftStatus({ stored: storedFields, draft: draftFields, fieldErrors });
  const isDirty = status.isDirty && !hasSaved;

  // The latch's job ends when the revalidated referee arrives and the two agree; left latched, every
  // later edit on a restored tree read as not-dirty.
  if (hasSaved && !status.isDirty) setHasSaved(false);

  useUnsavedChangesWarning(isDirty);

  // A ref, so the listener registers once and still reads the current gate.
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

  const validateFields = (paths: readonly string[]) => validatePaths("schiedsrichter", buildPayload(), paths);
  // Judged with the value that arrived in the event, because state has not committed yet.
  const validatePicked = (paths: readonly string[], picked: { default_payment: number }) =>
    validatePaths("schiedsrichter", { ...buildPayload(), ...picked }, paths);

  const isChanged = (path: string) => status.byPath.get(path)?.isChanged ?? false;

  const banners = buildSchiedsrichterBanners({
    isRetired,
    isNameChanged: isChanged("name"),
    isPaymentChanged: isChanged("default_payment"),
    hasKontakt: kontakt.email !== null || kontakt.telefon !== null,
  });

  const leavePage = () => {
    // Blur first: react-aria's focus attribute survives a kept-alive tree.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    if (window.history.length > 1) router.back();
    else router.push("/admin/schiedsrichter");
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
    setName(schiedsrichter.name);
    setSchule(schiedsrichter.schule);
    setKontakt(schiedsrichter.kontakt);
    setDefaultPayment(schiedsrichter.default_payment);

    setSubmitFieldErrors({}, {});
  };

  const discardAndLeave = () => {
    resetDraftToStored();
    setIsConfirmingDiscard(false);
    setHasLeftViaDiscard(true);
    leavePage();
  };

  const requestSave = () => {
    // Snapshotted rather than read live: a background revalidation would move the list under an
    // open dialog, and the reader agreed to the one the gate stopped on.
    const blocking = resolveBlockingBanners(banners);
    if (blocking !== null) {
      setConfirmingBanners(blocking);
      return;
    }
    handleFormSubmit();
  };

  const handleFormSubmit = () => {
    startTransition(async () => {
      // Read before the write: the props still hold the pre-save values, and the toast that replays
      // them outlives this component.
      const undoPayload: FLPatchSchiedsrichterPayload = {
        id: schiedsrichter.id,
        name: schiedsrichter.name,
        schule: schiedsrichter.schule,
        kontakt: schiedsrichter.kontakt,
        default_payment: schiedsrichter.default_payment,
      };
      // The rename earns a sentence because it rewrites the name inside every match naming them.
      const renameTouched = isChanged("name");

      const payload = buildPayload();
      const res = await patchSchiedsrichterAction(payload);
      if (!res.success) {
        setSubmitFieldErrors(res.fieldErrors ?? {}, { schiedsrichter: payload });
        appToast.danger("Speichern fehlgeschlagen", { description: res.error ?? "Die Schiedsrichterdaten konnten nicht gespeichert werden." });
        return;
      }

      setSubmitFieldErrors({}, {});
      setHasSaved(true);

      offerUndo(undoPayload, renameTouched ? "Der neue Name steht ab sofort auch an jedem Spiel." : undefined);

      // After the undo payload is built: leaving with typed values still in state let a save-then-undo
      // reopen on values the referee no longer holds.
      resetDraftToStored();
      leavePage();
    });
  };

  /**
   * The toast outlives this component, so the press runs in a detached closure — `router` is a stable
   * singleton and legal to call from one, and its `refresh` is what re-renders a screen the action's
   * own revalidation can no longer reach.
   */
  const offerUndo = (payload: FLPatchSchiedsrichterPayload, message?: string) => {
    appToast.success("Änderung gespeichert", {
      description: message ?? "Die Schiedsrichterdaten wurden aktualisiert.",
      timeout: UNDO_TIMEOUT_MS,
      actionProps: {
        children: "Rückgängig",
        onPress: () => {
          appToast.clear();
          // Closed by its own key: a toast with no explicit timeout inherits a default that would
          // retire it mid-flight.
          const pendingKey = appToast.pending("Änderung wird zurückgenommen...");

          // The two-argument `then`, so a failure downstream of a committed restore is never blamed
          // on the transport.
          void postSchiedsrichterUndo(payload).then(
            (result) => {
              appToast.close(pendingKey);
              if (!result.success) {
                appToast.danger("Rücknahme fehlgeschlagen", { description: result.error ?? "Die Änderung steht weiterhin." });
                return;
              }

              // Reported BEFORE the refresh: the restore is committed and nothing below changes that.
              appToast.success("Änderung zurückgenommen", { description: result.message });

              // Best-effort: a failed refresh costs a stale screen until the next navigation, not the
              // restore.
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
                description: "Die Änderung steht weiterhin. Prüfe die Verbindung und den Schiedsrichter.",
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
              nomen="Schiedsrichter"
            />
          }>
          <FormPersonSection
            name={name}
            onNameChange={setName}
            schule={schule}
            onSchuleChange={setSchule}
            onFieldLeft={validateFields}
          />

          <FormKontaktSection
            kontakt={kontakt}
            onChange={setKontakt}
            onFieldLeft={validateFields}
            banners={banners}
          />

          <FormHonorarSection
            defaultPayment={defaultPayment}
            onChange={setDefaultPayment}
            onFieldChanged={validatePicked}
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

      {/* Closed rather than unmounted on confirm: the write is awaited before anything navigates, so
          the exit animation has run before the tree is left. */}
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
