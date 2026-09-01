"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Form } from "@heroui/react";

import { patchSpielortAction } from "@/features/spielorte/actions";
import { FLPatchSpielortPayloadSchema } from "@/features/spielorte/schemas";
import { deriveSpielortDraftStatus } from "@/features/spielorte/spielortDraftStatus";
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
import { appToast } from "@/shared/utils/appToast";
import { offerUndo } from "@/shared/utils/undoDispatch";

import { buildSpielortBanners } from "./banners";
import { FormAdresseSection } from "./FormAdresseSection";
import { FormMieteSection } from "./FormMieteSection";
import { FormSpielortSection } from "./FormSpielortSection";

import type { FLPatchSpielortPayload } from "@/features/spielorte/schemas";
import type { FLSpielortDraftFields } from "@/features/spielorte/spielortDraftStatus";
import type { EditPageHeaderContent } from "@/shared/components/ui/EditPageHeader";
import type { BlockingBanners } from "@/shared/components/ui/railBanner";
import type { FLAddress } from "@/shared/schemas";

/**
 * The undo replays the identity too: both halves of the fan-out — a Spiel's embedded `ort.name` and
 * its derived `ort.maps_link` — are written by the same patch, so sending the stored values back
 * through it restores every match card too.
 */
export function AdminSpielortEditForm({
  spielort,
  isRetired,
  pageHeader,
}: {
  spielort: { id: string; name: string; address: FLAddress; default_mietpreis: number };
  /** A fact about the row rather than a field this form commits, so it arrives beside the values. */
  isRetired: boolean;
  pageHeader: EditPageHeaderContent;
}) {
  const router = useRouter();
  const saisonHref = useSaisonHref();
  const [isPending, startTransition] = useTransition();
  const [isLeaving, startLeaving] = useTransition();

  const [name, setName] = useState(spielort.name);
  const [address, setAddress] = useState<FLAddress>(spielort.address);
  const [defaultMietpreis, setDefaultMietpreis] = useState<number | null>(spielort.default_mietpreis);

  const [hasSaved, setHasSaved] = useState(false);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [confirmingBanners, setConfirmingBanners] = useState<BlockingBanners | null>(null);
  const [hasLeftViaDiscard, setHasLeftViaDiscard] = useState(false);

  const { fieldErrors, setSubmitFieldErrors, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { spielort: FLPatchSpielortPayloadSchema },
  });

  // The wire carries `id` in the path, so no refusal can name it and no input renders it.
  /**
   * Widened at the money field the way `FLSpielOrtFieldDraft` is: an emptied box holds `null`, and the payload
   * schema's `z.int()` is what asks for a number at the submit.
   */
  type SpielortPatchDraft = Omit<FLPatchSpielortPayload, "default_mietpreis"> & { default_mietpreis: number | null };

  const buildPayload = (): SpielortPatchDraft => ({
    id: spielort.id,
    name,
    address,
    default_mietpreis: defaultMietpreis,
  });

  const draftFields: FLSpielortDraftFields = { name, address, default_mietpreis: defaultMietpreis };
  const storedFields: FLSpielortDraftFields = {
    name: spielort.name,
    address: spielort.address,
    default_mietpreis: spielort.default_mietpreis,
  };

  const status = deriveSpielortDraftStatus({ stored: storedFields, draft: draftFields, fieldErrors });
  const isDirty = status.isDirty && !hasSaved;

  // The latch's job ends when the revalidated venue arrives and the two agree; left latched, every
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

  // Forgiveness runs on every draft change and only ever RETRACTS: a corrected field clears without a blur.
  useForgiveFixed({ spielort: buildPayload() });

  const validateFields = (paths: readonly string[]) => validatePaths("spielort", buildPayload(), paths);
  // Judged with the value that arrived in the event, because state has not committed yet.
  const validatePicked = (paths: readonly string[], picked: { default_mietpreis: number | null }) =>
    validatePaths("spielort", { ...buildPayload(), ...picked }, paths);

  const isChanged = (path: string) => status.byPath.get(path)?.isChanged ?? false;
  const isAddressChanged = status.changed.some((field) => field.group === "Adresse");

  const banners = buildSpielortBanners({
    isRetired,
    isNameChanged: isChanged("name"),
    isAddressChanged,
  });

  const leavePage = () => {
    // Blur first: react-aria's focus attribute survives a kept-alive tree.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    // Hover next, and the disabled flag is what ends it: `useHover` clears `data-hovered` when a
    // control turns disabled, and no `pointerleave` follows a click that leaves.
    startLeaving(() => {
      if (window.history.length > 1) router.back();
      else router.push(saisonHref("/admin/spielorte"));
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
    setName(spielort.name);
    setAddress(spielort.address);
    setDefaultMietpreis(spielort.default_mietpreis);

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
    // `aria` blocks nothing natively, so this call is what keeps an incomplete draft off the wire, in the
    // schema's own German rather than the browser's bubble. It RUNS the write, so there is no answer to drop.
    guardSubmit({ spielort: buildPayload() }, writeAfterBlock);
  };

  const writeAfterBlock = () => {
    startTransition(async () => {
      // Read before the write: the props still hold the pre-save values, and the toast that replays
      // them outlives this component.
      const undoPayload: FLPatchSpielortPayload = {
        id: spielort.id,
        name: spielort.name,
        address: spielort.address,
        default_mietpreis: spielort.default_mietpreis,
      };
      // The fan-out earns a sentence because it reaches every match card at this venue, not this page.
      const identityTouched = isChanged("name") || isAddressChanged;

      const payload = buildPayload();
      const res = await patchSpielortAction(payload);
      if (!res.success) {
        setSubmitFieldErrors(res.fieldErrors ?? {}, { spielort: payload });
        appToast.danger("Speichern fehlgeschlagen", { description: res.error ?? "Die Spielortdaten konnten nicht gespeichert werden." });
        return;
      }

      setSubmitFieldErrors({}, {});
      setHasSaved(true);

      offerUndo({
        endpoint: "/api/admin/spielorte/undo",
        body: undoPayload,
        message: identityTouched ? "Jedes Spiel an diesem Ort zeigt jetzt den neuen Namen und die neue Karte." : undefined,
        fallback: "Die Spielortdaten wurden aktualisiert.",
        router,
      });

      // After the undo payload is built: leaving with typed values still in state let a save-then-undo
      // reopen on values the venue no longer holds.
      resetDraftToStored();
      leavePage();
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
              nomen="Spielort"
            />
          }>
          <FormSpielortSection
            name={name}
            onNameChange={setName}
            onFieldLeft={validateFields}
          />

          <FormAdresseSection
            address={address}
            onChange={setAddress}
            onFieldLeft={validateFields}
            banners={banners}
          />

          <FormMieteSection
            defaultMietpreis={defaultMietpreis}
            onChange={setDefaultMietpreis}
            onFieldChanged={validatePicked}
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
