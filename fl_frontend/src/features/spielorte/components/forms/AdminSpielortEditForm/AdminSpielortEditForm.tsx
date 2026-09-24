"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { patchSpielortAction } from "@/features/spielorte/actions";
import { FLPatchSpielortPayloadSchema } from "@/features/spielorte/schemas";
import { deriveSpielortDraftStatus } from "@/features/spielorte/spielortDraftStatus";
import { ConfirmDiscardModal } from "@/shared/components/ui/ConfirmDiscardModal";
import { ConfirmSaveModal } from "@/shared/components/ui/ConfirmSaveModal";
import { DraftRail } from "@/shared/components/ui/DraftRail";
import { DraftStatusProvider } from "@/shared/components/ui/DraftStatusContext";
import { EditFormLayout } from "@/shared/components/ui/EditFormLayout";
import { Form } from "@/shared/components/ui/Form";
import { FormActionBar } from "@/shared/components/ui/FormActionBar";
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { useEditorExit } from "@/shared/hooks/useEditorExit";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { useSaveShortcut } from "@/shared/hooks/useSaveShortcut";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";
import { unansweredAction } from "@/shared/utils/actionError";
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

  const [name, setName] = useState(spielort.name);
  const [address, setAddress] = useState<FLAddress>(spielort.address);
  const [defaultMietpreis, setDefaultMietpreis] = useState<number | null>(spielort.default_mietpreis);

  const [hasSaved, setHasSaved] = useState(false);
  const [confirmingBanners, setConfirmingBanners] = useState<BlockingBanners | null>(null);

  const { fieldErrors, setSubmitFieldErrors, reportSubmitFailure, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { spielort: FLPatchSpielortPayloadSchema },
  });

  // The wire carries `id` in the path, so no refusal can name it and no input renders it.

  // The widening `fl_frontend/src/features/spielorte/schemas.ts :: FLSpielortPayloadDraft` states in full.
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

  const resetDraftToStored = () => {
    setName(spielort.name);
    setAddress(spielort.address);
    setDefaultMietpreis(spielort.default_mietpreis);

    setSubmitFieldErrors({}, {});
  };

  const { isLeaving, leavePage, isConfirmingDiscard, closeDiscard, hasLeftViaDiscard, requestLeave, discardAndLeave } = useEditorExit({
    fallbackHref: saisonHref("/admin/spielorte"),
    isDirty,
    resetDraftToStored,
  });

  useSaveShortcut(formRef, !isPending && !isConfirmingDiscard && confirmingBanners === null && isDirty);

  const requestSave = () => {
    // The banners go to the gate and are never resolved here, where the dialog would open ahead of the block
    // (`docs/frontend/spec.md :: I255`).
    guardSubmit({ spielort: buildPayload() }, writeAfterBlock, { banners, confirm: setConfirmingBanners });
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
      // A rejected action may still have saved, and uncaught here it takes the editor down with it.
      const res = await patchSpielortAction(payload).catch(unansweredAction);
      if (!res.success) {
        reportSubmitFailure(res, { spielort: payload });
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
        // `aria`, never `native`: missing belongs to the submit, not a blur (`docs/frontend/spec.md :: I40`, `:: I71`).
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
          onClose={closeDiscard}
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
          // Never back through the gate: it judged this draft before raising the dialog, and would raise it again.
          writeAfterBlock();
        }}
      />
    </DraftStatusProvider>
  );
}
