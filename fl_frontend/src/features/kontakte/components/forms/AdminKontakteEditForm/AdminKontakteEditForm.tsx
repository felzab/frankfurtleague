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
import { appToast, UNDO_TIMEOUT_MS } from "@/shared/utils/appToast";

import { buildKontakteBanners } from "./banners";
import { FormKontakteLoeschenSection } from "./FormKontakteLoeschenSection";
import { FormKontakteSection } from "./FormKontakteSection";

import type { FLPatchSaisonTeamKontaktePayload } from "@/features/kontakte/schemas";
import type { SaisonTeamKontaktePayloadDraft } from "@/features/kontakte/types";
import type { SaisonTeamKontakteDraft, TeamSaisonMembership } from "@/features/teams/types";
import type { EditPageHeaderContent } from "@/shared/components/ui/EditPageHeader";
import type { BlockingBanners } from "@/shared/components/ui/railBanner";

/**
 * A `fetch` and not a server action: by the time the offer is pressed this component is unmounted,
 * and a server action dispatched from there trips Next's E592 invariant. Revert to a server action
 * once E592 is fixed upstream.
 */
async function postKontakteUndo(payload: FLPatchSaisonTeamKontaktePayload): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch("/api/admin/kontakte/undo", {
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
    validatePaths("kontakte", { ...buildPayload(), ...selected }, paths);

  const banners = buildKontakteBanners({
    saisonId: saison.saisonId,
    saisonStatus: saison.saisonStatus,
    isMember: storedMembership !== null,
    isBlockRemoved: storedKontakte !== null && kontakte === null,
    // Read off the two blocks rather than off the controls: `trainer_ist_zugleich` empties the seat
    // it names without that seat's own control ever being pressed.
    emptiedSeatLabels: emptiedSeatLabels(storedKontakte, kontakte),
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

      offerUndo(undoPayload, res.message);

      // AFTER the undo payload is built: leaving with typed values still in state is what let a
      // save-then-undo reopen the editor on values the season no longer holds.
      resetDraftToStored();
      leavePage();
    });
  };

  /**
   * The toast outlives this component, so the press runs in a detached closure — `router` is a stable
   * singleton and legal to call from one, and its `refresh` is what re-renders a screen the write's
   * own page can no longer reach.
   */
  const offerUndo = (payload: FLPatchSaisonTeamKontaktePayload, message?: string) => {
    // Judged here and not left to the undo route: backend I36 (`docs/backend/spec.md`) admits a
    // malformed address on read, that row is no legal write, and the shared spine can only answer
    // such a body with a reload nothing would change.
    const unrestorable = describeUnrestorableKontakte(payload);

    appToast.success("Änderung gespeichert", {
      description: message ?? "Die Kontakte wurden aktualisiert.",
      timeout: UNDO_TIMEOUT_MS,
      actionProps: {
        children: "Rückgängig",
        onPress: () => {
          appToast.clear();
          if (unrestorable !== null) {
            appToast.danger("Rücknahme nicht möglich", { description: unrestorable });
            return;
          }

          // Closed by its own key: a toast with no explicit timeout inherits a default that would
          // retire it mid-flight.
          const pendingKey = appToast.pending("Änderung wird zurückgenommen...");

          // The two-argument `then`, so a failure downstream of a committed restore is never blamed
          // on the transport.
          void postKontakteUndo(payload).then(
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
                // The connection alone: the request never reached a judgement, so naming the contact
                // data would send the admin to inspect values nothing here read.
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
