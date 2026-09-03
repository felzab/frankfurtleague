"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Form } from "@heroui/react";

import { patchSaisonSpielerAction, patchSpielerAction } from "@/features/spieler/actions";
import { rolleLabel } from "@/features/spieler/constants";
import { FLPatchSaisonSpielerPayloadSchema, FLPatchSpielerPayloadSchema } from "@/features/spieler/schemas";
import { deriveSpielerDraftStatus } from "@/features/spieler/spielerDraftStatus";
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
import { offerUndo } from "@/shared/utils/undoDispatch";

import { buildSpielerBanners } from "./banners";
import { FormAustragenSection } from "./FormAustragenSection";
import { FormKaderSection } from "./FormKaderSection";
import { FormLoeschenSection } from "./FormLoeschenSection";
import { FormPersonSection } from "./FormPersonSection";

import type {
  FLPatchSaisonSpielerPayload,
  FLPatchSpielerPayload,
  FLSpielerPosition,
  FLSpielerRolle,
  FLSpielerStufe,
} from "@/features/spieler/schemas";
import type { FLSpielerDraftFields } from "@/features/spieler/spielerDraftStatus";
import type { SpielerPersonFields, SpielerSaisonMembership, SpielerTeamOption } from "@/features/spieler/types";
import type { EditPageHeaderContent } from "@/shared/components/ui/EditPageHeader";
import type { BlockingBanners } from "@/shared/components/ui/railBanner";
import type { FieldErrors } from "@/shared/utils/validation";

/** What the undo replays: the halves the save wrote, holding their PRE-SAVE values. */
type SpielerUndoPayloads = {
  person?: FLPatchSpielerPayload;
  saison?: FLPatchSaisonSpielerPayload;
};

/** **One save bar over TWO endpoints**: a partial failure is toasted as well as shown inline. */
export function AdminSpielerEditForm({
  spieler,
  saison,
  teams,
  membershipCount,
  pageHeader,
}: {
  spieler: { id: string; vorname: string; nachname: string | null; inactive_since: string | null };
  /** The sidemenu selector's season and its squad row, resolved by the page. */
  saison: SpielerSaisonMembership;
  /** The selected season's teams, for the picker and for reading a `team_id` as a name. */
  teams: readonly SpielerTeamOption[];
  /** Squad rows across EVERY season, retired ones included: what the erasure would take with it. */
  membershipCount: number;
  pageHeader: EditPageHeaderContent;
}) {
  const router = useRouter();
  const saisonHref = useSaisonHref();
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
  const [rolle, setRolle] = useState<FLSpielerRolle | null>(storedMembership?.rolle ?? null);

  const [hasSaved, setHasSaved] = useState(false);
  const [confirmingBanners, setConfirmingBanners] = useState<BlockingBanners | null>(null);

  const { fieldErrors, setSubmitFieldErrors, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { spieler: FLPatchSpielerPayloadSchema, saisonSpieler: FLPatchSaisonSpielerPayloadSchema },
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
    rolle,
  });

  const draftFields: FLSpielerDraftFields = {
    vorname: personDraft.vorname,
    nachname: personDraft.nachname ?? "",
    membership: storedMembership === null ? null : { team_id: teamId, nummer, position, stufe, is_nachgetragen: isNachgetragen, rolle },
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
            rolle: storedMembership.rolle,
          },
  };

  const status = deriveSpielerDraftStatus({ stored: storedFields, draft: draftFields, fieldErrors, teams });
  const isDirty = status.isDirty && !hasSaved;

  // The latch's job ends when the revalidated player arrives and the two agree — left latched, every
  // later edit on a restored tree reads as not-dirty.
  if (hasSaved && !status.isDirty) setHasSaved(false);

  useUnsavedChangesWarning(isDirty);

  // Forgiveness runs on every draft change and only ever RETRACTS: a corrected field clears without a blur.
  useForgiveFixed({ spieler: buildPersonPayload(), saisonSpieler: buildSaisonPayload() });

  const validatePersonFields = (paths: readonly string[]) => validatePaths("spieler", buildPersonPayload(), paths);
  const validateSaisonFields = (paths: readonly string[]) => validatePaths("saisonSpieler", buildSaisonPayload(), paths);
  // Judged with the value that arrived in the event, because state has not committed yet.
  const validateTeamSelection = (paths: readonly string[], selected: { team_id: string }) =>
    validatePaths("saisonSpieler", { ...buildSaisonPayload(), ...selected }, paths);

  const isChanged = (path: string) => status.byPath.get(path)?.isChanged ?? false;

  // Read off the DRAFT's team: moving the picker moves who already leads.
  const heldRollen = teams.find((team) => team.teamId === teamId)?.heldRollen ?? {};
  const heldBy = rolle === null ? undefined : heldRollen[rolle];
  // Only where SOMEBODY ELSE holds it. The current holder keeps the control so they can give it up.
  const blockedRolle = rolle !== null && heldBy !== undefined ? { label: rolleLabel(rolle), heldBy } : null;

  const personDirty = status.changed.some((field) => field.group === "Person");
  const saisonDirty = storedMembership !== null && status.changed.some((field) => field.group === "Kader");

  // The predicate `REQ-SQUAD-001` counts, asked of the same fact: `teams` is exactly this season's
  // junction rows, and a club replacement repoints one away from the squad rows still naming it.
  const isRowTeamInSaison = storedMembership === null || teams.some((team) => team.teamId === storedMembership.team_id);

  const banners = buildSpielerBanners({
    isRetired: spieler.inactive_since !== null,
    saisonId: saison.saisonId,
    saisonStatus: saison.saisonStatus,
    isMember: storedMembership !== null,
    rowInactiveSince: storedMembership?.inactive_since ?? null,
    isRowTeamInSaison,
    isNachgetragen,
    isTeamChanged: isChanged("team_id"),
    blockedRolle,
  });

  const resetDraftToStored = () => {
    setPersonDraft({ vorname: spieler.vorname, nachname: spieler.nachname });
    setTeamId(storedMembership?.team_id ?? null);
    setNummer(storedMembership?.nummer ?? "");
    setPosition(storedMembership?.position ?? null);
    setStufe(storedMembership?.stufe ?? null);
    setIsNachgetragen(storedMembership?.is_nachgetragen ?? false);
    setRolle(storedMembership?.rolle ?? null);

    setSubmitFieldErrors({}, {});
  };

  const { isLeaving, leavePage, isConfirmingDiscard, closeDiscard, hasLeftViaDiscard, requestLeave, discardAndLeave } = useEditorExit({
    fallbackHref: saisonHref("/admin/spieler"),
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
    // Only the halves this press writes: judging an untouched half refuses a save over a field nobody sends.
    guardSubmit(
      {
        ...(personDirty ? { spieler: buildPersonPayload() } : {}),
        ...(saisonDirty ? { saisonSpieler: buildSaisonPayload() } : {}),
      },
      writeAfterBlock,
    );
  };

  const writeAfterBlock = () => {
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
                rolle: storedMembership.rolle,
              },
            }
          : {}),
      };
      // A success rather than a warning: this save destroys nothing without another copy.
      offerUndo({
        endpoint: "/api/admin/spieler/undo",
        body: undoPayloads,
        message: consequenceNotes.join(" ") || undefined,
        fallback: "Die Spielerdaten wurden aktualisiert.",
        router,
      });

      // AFTER the undo payloads are built: leaving with typed values still in state is what let a
      // save-then-undo reopen on values the player no longer holds.
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
            onTeamIdChange={(next) => {
              setTeamId(next);
              const takenInNext = teams.find((team) => team.teamId === next)?.heldRollen ?? {};
              if (rolle !== null && takenInNext[rolle] !== undefined) setRolle(null);
            }}
            nummer={nummer}
            onNummerChange={setNummer}
            position={position}
            onPositionChange={setPosition}
            stufe={stufe}
            onStufeChange={setStufe}
            rolle={rolle}
            onRolleChange={setRolle}
            heldRollen={heldRollen}
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
              isRowTeamInSaison={isRowTeamInSaison}
              banners={banners}
            />
          )}

          {/* Last on the page, the position the season editor's rollover holds: the one control here
              that no later edit reverses, and the only one that removes rather than retires. Always
              rendered — closed, it is where the admin reads that retirement comes first. */}
          <FormLoeschenSection
            spielerId={spieler.id}
            fullName={spieler.nachname === null ? spieler.vorname : `${spieler.vorname} ${spieler.nachname}`}
            isRetired={spieler.inactive_since !== null}
            membershipCount={membershipCount}
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
