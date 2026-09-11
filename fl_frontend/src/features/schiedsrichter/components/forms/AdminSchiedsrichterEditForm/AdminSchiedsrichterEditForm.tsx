"use client";

import { useState, useTransition } from "react";
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
import { useEditorExit } from "@/shared/hooks/useEditorExit";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { useSaveShortcut } from "@/shared/hooks/useSaveShortcut";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";
import { appToast } from "@/shared/utils/appToast";
import { guardAgainstDraft } from "@/shared/utils/draftGuard";
import { buildRefusal } from "@/shared/utils/refusal";
import { offerUndo } from "@/shared/utils/undoDispatch";

import { buildSchiedsrichterBanners } from "./banners";
import { FormAnonymisierenSection } from "./FormAnonymisierenSection";
import { FormHonorarSection } from "./FormHonorarSection";
import { FormKontaktSection } from "./FormKontaktSection";
import { FormPersonSection } from "./FormPersonSection";

import type { FLPatchSchiedsrichterPayload } from "@/features/schiedsrichter/schemas";
import type { FLSchiedsrichterDraftFields } from "@/features/schiedsrichter/schiedsrichterDraftStatus";
import type { EditPageHeaderContent } from "@/shared/components/ui/EditPageHeader";
import type { BlockingBanners } from "@/shared/components/ui/railBanner";
import type { FLKontakt } from "@/shared/schemas";

/**
 * The undo's refusal for a row this save gave its first name. `PersonNameSchema` refuses an empty
 * one, so the pre-save state is no legal write and the replay is judged here rather than dispatched.
 */
const OHNE_GESPEICHERTEN_NAMEN = buildRefusal({
  reason: "Vor dem Speichern war zu diesem Eintrag kein Name hinterlegt, und ohne Namen lässt er sich nicht zurückschreiben",
  repair: "Öffne den Eintrag erneut, wenn der Name falsch ist",
});

/**
 * One save bar over one endpoint, unlike the squad editor's two: a referee is a single document with
 * no junction row, so the patch carries the whole draft and a partial failure is not a state this
 * form can reach.
 */
export function AdminSchiedsrichterEditForm({
  schiedsrichter,
  isRetired,
  pageHeader,
}: {
  /** `name` is nullable because a hand-write can leave a row without one; the erasure's rows never reach here. */
  schiedsrichter: { id: string; name: string | null; schule: string | null; kontakt: FLKontakt; default_payment: number };
  /** A fact about the row rather than a field this form commits, so it arrives beside the values. */
  isRetired: boolean;
  pageHeader: EditPageHeaderContent;
}) {
  const router = useRouter();
  const saisonHref = useSaisonHref();
  const [isPending, startTransition] = useTransition();

  // The BOX is a string where the record may hold no name: an empty one is what the admin then types
  // into, and `PersonNameSchema` refuses it at the submit rather than storing the sentinel back.
  const [name, setName] = useState(schiedsrichter.name ?? "");
  const [schule, setSchule] = useState(schiedsrichter.schule);
  const [kontakt, setKontakt] = useState<FLKontakt>(schiedsrichter.kontakt);
  const [defaultPayment, setDefaultPayment] = useState<number | null>(schiedsrichter.default_payment);

  const [hasSaved, setHasSaved] = useState(false);
  const [confirmingBanners, setConfirmingBanners] = useState<BlockingBanners | null>(null);

  const { fieldErrors, setSubmitFieldErrors, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { schiedsrichter: FLPatchSchiedsrichterPayloadSchema },
  });

  // The wire carries `id` in the path, so no refusal can name it and no input renders it.

  // The widening `fl_frontend/src/features/schiedsrichter/schemas.ts :: FLSchiedsrichterPayloadDraft` states in full.
  type SchiedsrichterPatchDraft = Omit<FLPatchSchiedsrichterPayload, "default_payment"> & { default_payment: number | null };

  // The STORED record replayed as it stood, which the payload type cannot hold: an undo restoring a
  // nameless row is refused at the offer rather than being sent as a body no schema admits.
  type SchiedsrichterUndoBody = Omit<FLPatchSchiedsrichterPayload, "name"> & { name: string | null };

  const buildPayload = (): SchiedsrichterPatchDraft => ({
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

  // Forgiveness runs on every draft change and only ever RETRACTS: a corrected field clears without a blur.
  useForgiveFixed({ schiedsrichter: buildPayload() });

  const validateFields = (paths: readonly string[]) => validatePaths("schiedsrichter", buildPayload(), paths);
  // Judged with the value that arrived in the event, because state has not committed yet.
  const validatePicked = (paths: readonly string[], picked: { default_payment: number | null }) =>
    validatePaths("schiedsrichter", { ...buildPayload(), ...picked }, paths);

  const isChanged = (path: string) => status.byPath.get(path)?.isChanged ?? false;

  const banners = buildSchiedsrichterBanners({
    isRetired,
    isNameless: schiedsrichter.name === null,
    isNameChanged: isChanged("name"),
  });

  const resetDraftToStored = () => {
    setName(schiedsrichter.name ?? "");
    setSchule(schiedsrichter.schule);
    setKontakt(schiedsrichter.kontakt);
    setDefaultPayment(schiedsrichter.default_payment);

    setSubmitFieldErrors({}, {});
  };

  const { isLeaving, leavePage, isConfirmingDiscard, closeDiscard, hasLeftViaDiscard, requestLeave, discardAndLeave } = useEditorExit({
    fallbackHref: saisonHref("/admin/schiedsrichter"),
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
    guardSubmit({ schiedsrichter: buildPayload() }, writeAfterBlock);
  };

  const writeAfterBlock = () => {
    startTransition(async () => {
      // Read before the write: the props still hold the pre-save values, and the toast that replays
      // them outlives this component.
      const undoPayload: SchiedsrichterUndoBody = {
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
        appToast.danger("Änderung nicht gespeichert", { description: res.error });
        return;
      }

      setSubmitFieldErrors({}, {});
      setHasSaved(true);

      offerUndo({
        endpoint: "/api/admin/schiedsrichter/undo",
        body: undoPayload,
        message: renameTouched ? "Der neue Name steht ab sofort auch an jedem Spiel." : undefined,
        fallback: "Die Schiedsrichterdaten wurden aktualisiert.",
        // Judged here and not left to the undo route: the shared spine can only answer a body the
        // schema refuses with a reload nothing would change.
        unrestorable: schiedsrichter.name === null ? OHNE_GESPEICHERTEN_NAMEN : null,
        router,
      });

      // After the undo payload is built: leaving with typed values still in state let a save-then-undo
      // reopen on values the referee no longer holds.
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
          />

          <FormHonorarSection
            defaultPayment={defaultPayment}
            onChange={setDefaultPayment}
            onFieldChanged={validatePicked}
          />

          {/* Last on the page, the position the season editor's rollover holds: the one control here
              that writes on press and that no later edit reverses. The STORED contact record, never
              the draft — this clears what is saved. */}
          <FormAnonymisierenSection
            schiedsrichterId={schiedsrichter.id}
            name={schiedsrichter.name}
            schule={schiedsrichter.schule}
            kontakt={schiedsrichter.kontakt}
            // The page keys this view on the STORED record, so the write's refresh remounts the form
            // onto the cleared one — an unsaved draft would go with it.
            onBeforeAnonymise={() => guardAgainstDraft(isDirty, "Das Löschen verwirft die nicht gespeicherten Änderungen.")}
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
          handleFormSubmit();
        }}
      />
    </DraftStatusProvider>
  );
}
