"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Form } from "@heroui/react";

import { patchSaisonSpielerAction, patchSpielerAction } from "@/features/spieler/actions";
import { FLPatchSaisonSpielerPayloadSchema, FLPatchSpielerPayloadSchema } from "@/features/spieler/schemas";
import { deriveSpielerDraftStatus } from "@/features/spieler/spielerDraftStatus";
import { isSquadNummerNewlyShared } from "@/features/spieler/utils";
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
import { appToast } from "@/shared/utils/appToast";

import { buildSpielerBanners } from "./banners";
import { FormAustragenSection } from "./FormAustragenSection";
import { FormKaderSection } from "./FormKaderSection";
import { FormPersonSection } from "./FormPersonSection";

import type { FLPatchSaisonSpielerPayload, FLPatchSpielerPayload, FLSpielerPosition, FLSpielerStufe } from "@/features/spieler/schemas";
import type { FLSpielerDraftFields } from "@/features/spieler/spielerDraftStatus";
import type { SpielerPersonFields, SpielerSaisonMembership, SpielerTeamOption } from "@/features/spieler/types";
import type { BlockingBanners } from "@/shared/components/ui/railBanner";
import type { FieldErrors } from "@/shared/utils/validation";
import type { ReactNode } from "react";

const UNDO_TIMEOUT_MS = 15000;

/** What the undo replays: the halves the save wrote, holding their PRE-SAVE values. */
type SpielerUndoPayloads = {
  person?: FLPatchSpielerPayload;
  saison?: FLPatchSaisonSpielerPayload;
};

/**
 * A `fetch`, not a server action: by the time the offer is pressed this component is unmounted and
 * the browser elsewhere, and an action dispatched from there trips Next's E592 invariant.
 * **Revert once E592 is fixed upstream.**
 */
async function postSpielerUndo(payloads: SpielerUndoPayloads): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch("/api/admin/spieler/undo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payloads),
  });

  // The route answers 200 with the outcome in the body for every reportable case, so a non-2xx is a
  // genuine transport failure.
  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}`);
  }

  return response.json() as Promise<{ success: boolean; message?: string; error?: string }>;
}

/**
 * **One save bar over TWO endpoints**, run in order for whichever halves are dirty. A partial
 * failure is toasted as well as shown inline, because the half that SUCCEEDED revalidates and
 * remounts this form over the inline message.
 */
export function AdminSpielerEditForm({
  spieler,
  saison,
  teams,
  registerRequestLeave,
  pageHeader,
}: {
  spieler: { id: string; vorname: string; nachname: string | null; inactive_since: string | null };
  /** The sidemenu selector's season and its squad row, resolved by the page. */
  saison: SpielerSaisonMembership;
  /** The selected season's teams, for the picker and for reading a `team_id` as a name. */
  teams: readonly SpielerTeamOption[];
  registerRequestLeave?: (requestLeave: () => void) => void;
  pageHeader?: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const storedMembership = saison.membership;

  const [personDraft, setPersonDraft] = useState<SpielerPersonFields>({
    vorname: spieler.vorname,
    nachname: spieler.nachname,
  });

  const [teamId, setTeamId] = useState<string | null>(storedMembership?.team_id ?? null);
  const [nummer, setNummer] = useState(storedMembership?.nummer ?? "");
  const [position, setPosition] = useState<FLSpielerPosition | null>(storedMembership?.position ?? null);
  const [stufe, setStufe] = useState<FLSpielerStufe | null>(storedMembership?.stufe ?? null);
  // Read-only on this page, but held in state anyway: the patch replaces the row wholesale, so
  // dropping it from the payload would clear it.
  const [isNachgetragen, setIsNachgetragen] = useState(storedMembership?.is_nachgetragen ?? false);
  const [isCaptain, setIsCaptain] = useState(storedMembership?.is_captain ?? false);

  const [hasSaved, setHasSaved] = useState(false);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [confirmingBanners, setConfirmingBanners] = useState<BlockingBanners | null>(null);
  const [hasLeftViaDiscard, setHasLeftViaDiscard] = useState(false);

  const { fieldErrors, setSubmitFieldErrors, validatePaths, formRef } = useDraftFieldErrors({
    schemas: { spieler: FLPatchSpielerPayloadSchema, saisonSpieler: FLPatchSaisonSpielerPayloadSchema },
    onUnhandledErrors: () =>
      appToast.danger("Speichern fehlgeschlagen", {
        description: "Der Server hat eine Angabe beanstandet, die dieses Formular nicht anzeigt. Lade die Seite neu.",
      }),
  });

  // The ids ride in the request URI and `is_nachgetragen` is round-tripped read-only, so none of
  // them is a path an input renders or a refusal can name.
  const buildPersonPayload = () => ({ id: spieler.id, ...personDraft });
  const buildSaisonPayload = () => ({
    spieler_id: spieler.id,
    saison_id: saison.saisonId,
    team_id: teamId,
    // Emptied means absent — the boundary where `""` becomes null, as on the person half.
    nummer: nummer.trim() === "" ? null : nummer.trim(),
    position,
    stufe,
    is_nachgetragen: isNachgetragen,
    is_captain: isCaptain,
  });

  const draftFields: FLSpielerDraftFields = {
    vorname: personDraft.vorname,
    nachname: personDraft.nachname ?? "",
    membership:
      storedMembership === null ? null : { team_id: teamId, nummer, position, stufe, is_nachgetragen: isNachgetragen, is_captain: isCaptain },
  };
  const storedFields: FLSpielerDraftFields = {
    vorname: spieler.vorname,
    nachname: spieler.nachname ?? "",
    membership:
      storedMembership === null
        ? null
        : {
            team_id: storedMembership.team_id,
            // `?? ""` so both sides of the comparison are the shape the input holds.
            nummer: storedMembership.nummer ?? "",
            position: storedMembership.position,
            stufe: storedMembership.stufe,
            is_nachgetragen: storedMembership.is_nachgetragen,
            is_captain: storedMembership.is_captain,
          },
  };

  const status = deriveSpielerDraftStatus({ stored: storedFields, draft: draftFields, fieldErrors, teams });
  const isDirty = status.isDirty && !hasSaved;

  // The latch's job ends when the revalidated player arrives and the two agree — left latched, every
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

  const validatePersonFields = (paths: readonly string[]) => validatePaths("spieler", buildPersonPayload(), paths);
  const validateSaisonFields = (paths: readonly string[]) => validatePaths("saisonSpieler", buildSaisonPayload(), paths);
  // Judged with the value that arrived in the event, because state has not committed yet.
  const validateTeamSelection = (paths: readonly string[], selected: { team_id: string }) =>
    validatePaths("saisonSpieler", { ...buildSaisonPayload(), ...selected }, paths);

  const isChanged = (path: string) => status.byPath.get(path)?.isChanged ?? false;

  // Judged on every keystroke rather than on blur: unlike the field's own bounds this is a fact about
  // the squad, so the answer changes when the team picker moves and the number does not.
  const newlySharedNummer = isSquadNummerNewlyShared({
    draft: { teamId, nummer },
    stored: storedMembership === null ? null : { teamId: storedMembership.team_id, nummer: storedMembership.nummer },
    takenInDraftTeam: teams.find((team) => team.teamId === teamId)?.takenNummern ?? [],
  })
    ? nummer.trim()
    : null;

  const personDirty = status.changed.some((field) => field.group === "Person");
  const saisonDirty = storedMembership !== null && status.changed.some((field) => field.group === "Kader");

  const banners = buildSpielerBanners({
    isRetired: spieler.inactive_since !== null,
    saisonId: saison.saisonId,
    saisonStatus: saison.saisonStatus,
    isMember: storedMembership !== null,
    rowInactiveSince: storedMembership?.inactive_since ?? null,
    isNachgetragen,
    isTeamChanged: isChanged("team_id"),
    newlySharedNummer,
  });

  const leavePage = () => {
    // Blur first: react-aria's focus attribute survives a kept-alive tree.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    if (window.history.length > 1) router.back();
    else router.push("/admin/spieler");
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
    setPersonDraft({ vorname: spieler.vorname, nachname: spieler.nachname });
    setTeamId(storedMembership?.team_id ?? null);
    setNummer(storedMembership?.nummer ?? "");
    setPosition(storedMembership?.position ?? null);
    setStufe(storedMembership?.stufe ?? null);
    setIsNachgetragen(storedMembership?.is_nachgetragen ?? false);
    setIsCaptain(storedMembership?.is_captain ?? false);

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
    startTransition(async () => {
      const collectedErrors: FieldErrors = {};
      // Built once, so what goes to each action is also what a later blur is graded against.
      const personPayload = buildPersonPayload();
      const saisonPayload = buildSaisonPayload();
      // Only what the admin cannot see from the form earns a sentence: a transfer moves the player
      // out of one public squad list and into another.
      const transferTouched = isChanged("team_id");
      const consequenceNotes: string[] = [];
      const savedParts: string[] = [];
      const failedNotes: string[] = [];

      // Person half first: it cannot depend on the squad half.
      if (personDirty) {
        const res = await patchSpielerAction(personPayload);
        if (res.success) {
          savedParts.push("Name gespeichert.");
        } else {
          Object.assign(collectedErrors, res.fieldErrors ?? {});
          failedNotes.push(res.error ?? "Die Personendaten konnten nicht gespeichert werden.");
        }
      }

      if (saisonDirty) {
        const res = await patchSaisonSpielerAction(saisonPayload);
        if (res.success) {
          savedParts.push("Kadereintrag gespeichert.");
          if (transferTouched) consequenceNotes.push("Der Spieler steht ab sofort im neuen Team.");
        } else {
          Object.assign(collectedErrors, res.fieldErrors ?? {});
          failedNotes.push(res.error ?? "Der Kadereintrag konnte nicht gespeichert werden.");
        }
      }

      if (failedNotes.length > 0) {
        setSubmitFieldErrors(collectedErrors, { spieler: personPayload, saisonSpieler: saisonPayload });
        // ALWAYS toasted, field errors or not — an inline message would be gone before it was read.
        appToast.danger(savedParts.length > 0 ? "Nur teilweise gespeichert" : "Speichern fehlgeschlagen", {
          description: [...savedParts, ...failedNotes].join(" "),
        });
        return;
      }

      setSubmitFieldErrors({}, {});
      setHasSaved(true);

      // `spieler` and `storedMembership` are this render's props, so they still carry the pre-save
      // values. Built BEFORE leaving, because the toast outlives the page.
      const undoPayloads: SpielerUndoPayloads = {
        ...(personDirty ? { person: { id: spieler.id, vorname: spieler.vorname, nachname: spieler.nachname } } : {}),
        ...(saisonDirty && storedMembership !== null
          ? {
              saison: {
                spieler_id: spieler.id,
                saison_id: saison.saisonId,
                team_id: storedMembership.team_id,
                nummer: storedMembership.nummer,
                position: storedMembership.position,
                stufe: storedMembership.stufe,
                is_nachgetragen: storedMembership.is_nachgetragen,
                is_captain: storedMembership.is_captain,
              },
            }
          : {}),
      };
      offerUndo(undoPayloads, consequenceNotes.join(" ") || undefined);

      // AFTER the undo payloads are built: leaving with typed values still in state is what let a
      // save-then-undo reopen on values the player no longer holds.
      resetDraftToStored();
      leavePage();
    });
  };

  /** A success rather than a warning: this save destroys nothing without another copy. */
  const offerUndo = (payloads: SpielerUndoPayloads, message?: string) => {
    appToast.success("Änderung gespeichert", {
      description: message ?? "Die Spielerdaten wurden aktualisiert.",
      // A decision window, not a reading time — the one case the text's length does not govern.
      timeout: UNDO_TIMEOUT_MS,
      actionProps: {
        children: "Rückgängig",
        onPress: () => {
          appToast.clear();
          // Closed by its own key below: a toast with no explicit timeout inherits a four-second
          // default that would retire it mid-flight.
          const pendingKey = appToast.pending("Änderung wird zurückgenommen...");

          // A detached closure — the toast outlives this component. TWO-ARGUMENT `then`, so a failure
          // downstream of a committed restore is never blamed on the transport.
          void postSpielerUndo(payloads).then(
            (result) => {
              appToast.close(pendingKey);
              if (!result.success) {
                appToast.danger("Rücknahme fehlgeschlagen", { description: result.error ?? "Die Änderung steht weiterhin." });
                return;
              }

              // Reported BEFORE the refresh: the restore is committed and nothing below changes that.
              appToast.success("Änderung zurückgenommen", { description: result.message });

              // Best-effort: a refresh that cannot run costs a stale screen, not the restore.
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
                description: "Die Änderung steht weiterhin. Prüfe die Verbindung und den Spieler.",
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
              nomen="Spieler"
            />
          }>
          <FormPersonSection
            draft={personDraft}
            onChange={setPersonDraft}
            onFieldLeft={validatePersonFields}
          />

          <FormKaderSection
            saison={{ saisonId: saison.saisonId, saisonStatus: saison.saisonStatus, erlaubteStufen: saison.erlaubteStufen }}
            teams={teams}
            isMember={storedMembership !== null}
            teamId={teamId}
            onTeamIdChange={setTeamId}
            nummer={nummer}
            onNummerChange={setNummer}
            position={position}
            onPositionChange={setPosition}
            stufe={stufe}
            onStufeChange={setStufe}
            isCaptain={isCaptain}
            onIsCaptainChange={setIsCaptain}
            onValidateFields={validateSaisonFields}
            onValidateSelection={validateTeamSelection}
            spielerId={spieler.id}
            banners={banners}
          />

          {/* Only where a row exists: there is nothing to take out of a squad the player is not in,
              and the Kader panel above offers the entry instead. */}
          {storedMembership !== null && (
            <FormAustragenSection
              spielerId={spieler.id}
              saisonId={saison.saisonId}
              rowInactiveSince={storedMembership.inactive_since}
              banners={banners}
            />
          )}
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
