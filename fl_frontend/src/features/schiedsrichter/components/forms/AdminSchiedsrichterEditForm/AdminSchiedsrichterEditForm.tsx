"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Form } from "@heroui/react";

import { patchSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { FLPatchSchiedsrichterPayloadSchema } from "@/features/schiedsrichter/schemas";
import { deriveSchiedsrichterDraftStatus } from "@/features/schiedsrichter/schiedsrichterDraftStatus";
import { ConfirmDiscardModal } from "@/shared/components/ui/ConfirmDiscardModal";
import { ConfirmSaveModal } from "@/shared/components/ui/ConfirmSaveModal";
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { resolveBlockingBanners } from "@/shared/components/ui/railBanner";
import { useDraftValidation } from "@/shared/hooks/useDraftValidation";
import { useServerFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";
import { appToast } from "@/shared/utils/appToast";

import { buildSchiedsrichterBanners } from "./banners";
import { FormHonorarSection } from "./FormHonorarSection";
import { FormKontaktSection } from "./FormKontaktSection";
import { FormPersonSection } from "./FormPersonSection";
import { SchiedsrichterActionBar } from "./SchiedsrichterActionBar";
import { SchiedsrichterDraftStatusProvider } from "./SchiedsrichterDraftStatusContext";
import { SchiedsrichterRail } from "./SchiedsrichterRail";

import type { FLPatchSchiedsrichterPayload } from "@/features/schiedsrichter/schemas";
import type { FLSchiedsrichterDraftFields } from "@/features/schiedsrichter/schiedsrichterDraftStatus";
import type { BlockingBanners } from "@/shared/components/ui/railBanner";
import type { FLKontakt } from "@/shared/schemas";
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
async function postSchiedsrichterUndo(payload: FLPatchSchiedsrichterPayload): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch("/api/admin/schiedsrichter/undo", {
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
 * The referee editor's form: three panels, a sticky summary rail, and one derivation behind both —
 * the match editor's shape (ADR-0040) over a referee. Every field is controlled, judged when it is
 * left with the same schema the action parses, and marked in place when its draft differs from stored.
 *
 * **One save bar over ONE endpoint**, unlike the squad editor's two: a referee is a single document
 * with no junction row, so `PATCH /schiedsrichter/{id}` carries the whole draft and a partial failure
 * is not a state this form can reach.
 */
export function AdminSchiedsrichterEditForm({
  schiedsrichter,
  registerRequestLeave,
  pageHeader,
}: {
  schiedsrichter: { id: string; name: string; schule: string | null; kontakt: FLKontakt; default_payment: number };
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

  const {
    fieldErrors: serverFieldErrors,
    setFieldErrors,
    formRef,
  } = useServerFieldErrors(() =>
    appToast.danger("Speichern fehlgeschlagen", {
      description: "Der Server hat eine Angabe beanstandet, die dieses Formular nicht anzeigt. Lade die Seite neu.",
    }),
  );

  const validation = useDraftValidation(FLPatchSchiedsrichterPayloadSchema);

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

  const fieldErrors = validation.mergedWith(serverFieldErrors);
  const status = deriveSchiedsrichterDraftStatus({ stored: storedFields, draft: draftFields, fieldErrors });
  const isDirty = status.isDirty && !hasSaved;

  // See the match editor: the latch's job ends the moment the revalidated referee arrives and the two
  // agree — left latched, every later edit on a restored tree read as not-dirty.
  if (hasSaved && !status.isDirty) setHasSaved(false);

  useUnsavedChangesWarning(isDirty);

  // Ctrl+S / Cmd+S submits, gated on the same conditions as the Speichern button — the match
  // editor's reasoning, unchanged.
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

  const validateFields = (paths: readonly string[]) => validation.validatePaths(buildPayload(), paths);
  // The picked-control variant — judged with the value that arrived in the event, because state has
  // not committed yet (see the match editor's `validateSelection`).
  const validatePicked = (paths: readonly string[], picked: { default_payment: number }) =>
    validation.validatePaths({ ...buildPayload(), ...picked }, paths);

  const isChanged = (path: string) => status.byPath.get(path)?.isChanged ?? false;

  /** Every Hinweis this draft raises — the rail's list and the panels' inline callouts alike. */
  const banners = buildSchiedsrichterBanners({
    isNameChanged: isChanged("name"),
    isPaymentChanged: isChanged("default_payment"),
    hasKontakt: kontakt.email !== null || kontakt.telefon !== null,
  });

  const leavePage = () => {
    // Blur first — see the match editor: react-aria's focus attribute survives a kept-alive tree.
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

  /** Every atom back to what is stored — both exits run it; see the match editor's reasoning. */
  const resetDraftToStored = () => {
    setName(schiedsrichter.name);
    setSchule(schiedsrichter.schule);
    setKontakt(schiedsrichter.kontakt);
    setDefaultPayment(schiedsrichter.default_payment);

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
      // Read before the write, because the props still hold the pre-save values here and the toast
      // that replays them outlives this component (ADR-0041, ADR-0049).
      const undoPayload: FLPatchSchiedsrichterPayload = {
        id: schiedsrichter.id,
        name: schiedsrichter.name,
        schule: schiedsrichter.schule,
        kontakt: schiedsrichter.kontakt,
        default_payment: schiedsrichter.default_payment,
      };
      // Only what the admin cannot see from the form itself earns a sentence: the rename, because it
      // rewrites the referee's name inside every match that already names them.
      const renameTouched = isChanged("name");

      const res = await patchSchiedsrichterAction(buildPayload());
      if (!res.success) {
        setFieldErrors(res.fieldErrors ?? {});
        appToast.danger("Speichern fehlgeschlagen", { description: res.error ?? "Die Schiedsrichterdaten konnten nicht gespeichert werden." });
        return;
      }

      setFieldErrors({});
      validation.clearVerdicts();
      setHasSaved(true);

      offerUndo(undoPayload, renameTouched ? "Der neue Name steht ab sofort auch an jedem Spiel." : undefined);

      // AFTER the undo payload is built, which reads the props rather than these atoms — see the
      // match editor: leaving with typed values still in state is what let a save-then-undo reopen
      // on values the referee no longer holds.
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
   * Always a success rather than a warning, as the squad editor's is: every field this save writes is
   * a short value the admin can retype, and the one write that reaches another document — the name's
   * fan-out — is replayed in full by the undo, which sends the old name back through the same patch.
   */
  const offerUndo = (payload: FLPatchSchiedsrichterPayload, message?: string) => {
    appToast.success("Änderung gespeichert", {
      description: message ?? "Die Schiedsrichterdaten wurden aktualisiert.",
      // A decision window, not a reading time — the one case where the text's length does not
      // govern the toast's duration.
      timeout: UNDO_TIMEOUT_MS,
      actionProps: {
        children: "Rückgängig",
        onPress: () => {
          appToast.clear();
          const pendingKey = appToast.pending("Änderung wird zurückgenommen...");

          void postSchiedsrichterUndo(payload).then(
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
                description: "Die Änderung steht weiterhin. Prüfe die Verbindung und den Schiedsrichter.",
              });
            },
          );
        },
      },
    });
  };

  return (
    <SchiedsrichterDraftStatusProvider status={status}>
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
                <SchiedsrichterRail banners={banners} />
              </div>

              <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 xl:col-start-1 xl:row-start-1 xl:mx-0 xl:max-w-none">
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
              </div>
            </div>
          </div>
        </div>

        <SchiedsrichterActionBar
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
    </SchiedsrichterDraftStatusProvider>
  );
}
