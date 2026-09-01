"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Form } from "@heroui/react";

import { patchSaisonTeamKontakteAction } from "@/features/kontakte/actions";
import { deriveKontakteDraftStatus } from "@/features/kontakte/kontakteDraftStatus";
import { FLPatchSaisonTeamKontaktePayloadSchema } from "@/features/kontakte/schemas";
import { describeUnrestorableKontakte, emptiedSeatLabels, mirrorKontakte, teamPageHref } from "@/features/kontakte/utils";
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

import { buildKontakteBanners } from "./banners";
import { FormKontakteLoeschenSection } from "./FormKontakteLoeschenSection";
import { FormKontakteSection } from "./FormKontakteSection";

import type { FLPatchSaisonTeamKontaktePayload } from "@/features/kontakte/schemas";
import type { SaisonTeamKontaktePayloadDraft } from "@/features/kontakte/types";
import type { SaisonTeamKontakteDraft, TeamSaisonMembership } from "@/features/teams/types";
import type { EditPageHeaderContent } from "@/shared/components/ui/EditPageHeader";
import type { BlockingBanners } from "@/shared/components/ui/railBanner";

/**
 * **One save bar over one endpoint.** `PATCH /teams/{team_id}/saisons/{saison_id}/kontakte` writes the
 * three seats and nothing else, so this page never has to report a half-saved row the way the club
 * editor's two-endpoint save does.
 */
export function AdminKontakteEditForm({
  teamId,
  saison,
  pageHeader,
}: {
  teamId: string;
  /** The sidemenu selector's season and its junction row, resolved by the page. */
  saison: TeamSaisonMembership;
  pageHeader: EditPageHeaderContent;
}) {
  const router = useRouter();
  const saisonHref = useSaisonHref();
  const [isPending, startTransition] = useTransition();
  const [isLeaving, startLeaving] = useTransition();

  const storedMembership = saison.membership;
  const storedKontakte = storedMembership?.kontakte ?? null;

  const [kontakte, setKontakte] = useState<SaisonTeamKontakteDraft | null>(storedKontakte);

  const [hasSaved, setHasSaved] = useState(false);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [confirmingBanners, setConfirmingBanners] = useState<BlockingBanners | null>(null);
  const [hasLeftViaDiscard, setHasLeftViaDiscard] = useState(false);

  const { fieldErrors, setSubmitFieldErrors, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { kontakte: FLPatchSaisonTeamKontaktePayloadSchema },
  });

  // Both ids ride in the request path, so neither is a field an input renders or a refusal can name.
  /* The claim is honoured HERE and nowhere earlier. Composed, the seat that made it stays the one
     place its person is edited, and lifting it returns the Trainer's own; written into the draft it
     overwrites whichever of two real people it does not name. */
  const buildPayload = (): SaisonTeamKontaktePayloadDraft => ({
    team_id: teamId,
    saison_id: saison.saisonId,
    kontakte: kontakte === null ? null : mirrorKontakte(kontakte),
  });

  const status = deriveKontakteDraftStatus({ stored: { kontakte: storedKontakte }, draft: { kontakte }, fieldErrors });
  const isDirty = status.isDirty && !hasSaved;

  // The latch's job ends when the revalidated row arrives and the two agree — left latched, every
  // later edit on a restored tree reads as not-dirty.
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

  // Forgiveness runs on every draft change and only ever RETRACTS: a corrected field clears without a blur.
  useForgiveFixed({ kontakte: buildPayload() });

  const validateFields = (paths: readonly string[]) => validatePaths("kontakte", buildPayload(), paths);
  // Judged with the value that arrived in the event, because state has not committed yet.
  const validateSelection = (paths: readonly string[], selected: { kontakte: SaisonTeamKontakteDraft | null }) =>
    // Mirrored like every other judgement: spread raw, a pick was judged against the unmirrored draft
    // while a blur was judged against the composed one, so the two disagreed about the Trainer.
    validatePaths("kontakte", { ...buildPayload(), kontakte: selected.kontakte === null ? null : mirrorKontakte(selected.kontakte) }, paths);

  const banners = buildKontakteBanners({
    saisonId: saison.saisonId,
    saisonStatus: saison.saisonStatus,
    isMember: storedMembership !== null,
    isBlockRemoved: storedKontakte !== null && kontakte === null,
    // Off the two COMPOSED blocks, never the controls: emptying the named seat empties the Trainer
    // with it, and neither seat's own control was pressed.
    emptiedSeatLabels: emptiedSeatLabels(storedKontakte, kontakte === null ? null : mirrorKontakte(kontakte)),
  });

  const leavePage = () => {
    // Blur first: react-aria's focus attribute survives a kept-alive tree.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    // Hover next, and the disabled flag is what ends it: `useHover` clears `data-hovered` when a
    // control turns disabled, and no `pointerleave` follows a click that leaves.
    startLeaving(() => {
      if (window.history.length > 1) router.back();
      else router.push(saisonHref("/admin/kontakte"));
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
    setKontakte(storedKontakte);

    setSubmitFieldErrors({}, {});
  };

  const discardAndLeave = () => {
    resetDraftToStored();
    setIsConfirmingDiscard(false);
    setHasLeftViaDiscard(true);
    leavePage();
  };

  const requestSave = () => {
    // Snapshotted, not read live: the reader agrees to the list the gate stopped on, and a background
    // revalidation re-deriving the banners under an open dialog would move it.
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
    guardSubmit({ kontakte: buildPayload() }, writeAfterBlock);
  };

  const writeAfterBlock = () => {
    startTransition(async () => {
      // Read before the write: `saison` is this render's prop and still holds the pre-save block, and
      // the toast that replays it outlives this component.
      const undoPayload: FLPatchSaisonTeamKontaktePayload = { team_id: teamId, saison_id: saison.saisonId, kontakte: storedKontakte };

      const payload = buildPayload();
      const res = await patchSaisonTeamKontakteAction(payload);

      if (!res.success) {
        setSubmitFieldErrors(res.fieldErrors ?? {}, { kontakte: payload });
        appToast.danger("Speichern fehlgeschlagen", { description: res.error ?? "Die Kontakte konnten nicht gespeichert werden." });
        return;
      }

      setSubmitFieldErrors({}, {});
      setHasSaved(true);

      offerUndo({
        endpoint: "/api/admin/kontakte/undo",
        body: undoPayload,
        message: res.message,
        fallback: "Die Kontakte wurden aktualisiert.",
        // Judged here and not left to the undo route: backend I36 (`docs/backend/spec.md`) admits a
        // malformed address on read, that row is no legal write, and the shared spine can only
        // answer such a body with a reload nothing would change.
        unrestorable: describeUnrestorableKontakte(undoPayload),
        router,
      });

      // AFTER the undo payload is built: leaving with typed values still in state is what let a
      // save-then-undo reopen the editor on values the season no longer holds.
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
              nomen="Kontakte"
            />
          }>
          <FormKontakteSection
            value={kontakte}
            isMember={storedMembership !== null}
            teamHref={teamPageHref(teamId, saison.saisonId)}
            banners={banners}
            onChange={setKontakte}
            onFieldLeft={validateFields}
            isDirty={isDirty}
            onValidateSelection={validateSelection}
          />

          {/* LAST on the page, the position every editor's destructive section holds: what it stages is
              the one save that takes the block away. */}
          {storedMembership !== null && (
            <FormKontakteLoeschenSection
              teamId={teamId}
              saisonId={saison.saisonId}
              hasStored={storedKontakte !== null}
              isDirty={isDirty}
            />
          )}
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

      {/* Closed rather than unmounted, unlike the discard dialog: the write is awaited before
          anything navigates, so the exit animation has run before the tree is left. */}
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
