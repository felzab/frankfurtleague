"use client";

import { useState, useTransition } from "react";

import { patchSaisonSpielerAction, patchSpielerAction } from "@/features/spieler/actions";
import { KADER_ABSCHNITT, rolleLabel } from "@/features/spieler/constants";
import { FLPatchSaisonSpielerPayloadSchema, FLPatchSpielerPayloadSchema } from "@/features/spieler/schemas";
import { deriveSpielerDraftStatus } from "@/features/spieler/spielerDraftStatus";
import { judgeRowReturn, nummerPayload } from "@/features/spieler/utils";
import { ConfirmDiscardModal } from "@/shared/components/ui/ConfirmDiscardModal";
import { ConfirmSaveModal } from "@/shared/components/ui/ConfirmSaveModal";
import { DraftRail } from "@/shared/components/ui/DraftRail";
import { DraftStatusProvider } from "@/shared/components/ui/DraftStatusContext";
import { EditFormLayout } from "@/shared/components/ui/EditFormLayout";
import { Form } from "@/shared/components/ui/Form";
import { FormActionBar } from "@/shared/components/ui/FormActionBar";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { useEditorExit } from "@/shared/hooks/useEditorExit";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { useSaveShortcut } from "@/shared/hooks/useSaveShortcut";
import { hasFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";
import { unansweredAction } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

import { buildSpielerBanners } from "./banners";
import { FormAdresseSection } from "./FormAdresseSection";
import { FormAustragenSection } from "./FormAustragenSection";
import { FormEinwilligungSection } from "./FormEinwilligungSection";
import { FormKaderSection } from "./FormKaderSection";
import { FormPersonSection } from "./FormPersonSection";

import type { FLEinwilligung, FLSpielerPosition, FLSpielerRolle, FLSpielerStufe } from "@/core/generated/client/types";
import type { FLSpielerDraftFields } from "@/features/spieler/spielerDraftStatus";
import type { AdminSpielerStored, SpielerPersonFields, SpielerSaisonMembership, SpielerTeamOption } from "@/features/spieler/types";
import type { EditPageHeaderContent } from "@/shared/components/ui/EditPageHeader";
import type { BlockingBanners } from "@/shared/components/ui/railBanner";
import type { ActionFailure } from "@/shared/types/types";
import type { FieldErrors } from "@/shared/utils/validation";

type AdminSpielerEditFormProps = {
  spieler: AdminSpielerStored;
  einwilligung: FLEinwilligung;
  /** The sidemenu selector's season and its squad row, resolved by the page. */
  saison: SpielerSaisonMembership;
  /** The selected season's teams, for the roles they hold and whether a retired row can return. */
  teams: readonly SpielerTeamOption[];
  pageHeader: EditPageHeaderContent;
};

/** The editor, keyed by the stored state its drafts mirror, so a save's refresh remounts it on the saved values. */
export function AdminSpielerEditForm(props: AdminSpielerEditFormProps) {
  return (
    <SpielerEditForm
      key={JSON.stringify({ spieler: props.spieler, saison: props.saison })}
      {...props}
    />
  );
}

/** **One save bar over TWO endpoints**: a partial failure is toasted as well as shown inline. */
function SpielerEditForm({ spieler, einwilligung, saison, teams, pageHeader }: AdminSpielerEditFormProps) {
  const saisonHref = useSaisonHref();
  const [isPending, startSaving] = useTransition();

  const storedMembership = saison.membership;

  const [personDraft, setPersonDraft] = useState<SpielerPersonFields>({
    first_name: spieler.first_name,
    last_name: spieler.last_name,
    birth_date: spieler.birth_date,
  });

  const [nummer, setNummer] = useState(storedMembership?.nummer ?? "");
  const [position, setPosition] = useState<FLSpielerPosition | null>(storedMembership?.position ?? null);
  const [stufe, setStufe] = useState<FLSpielerStufe | null>(storedMembership?.stufe ?? null);
  const [rolle, setRolle] = useState<FLSpielerRolle | null>(storedMembership?.rolle ?? null);

  const [hasSaved, setHasSaved] = useState(false);
  const [confirmingBanners, setConfirmingBanners] = useState<BlockingBanners | null>(null);

  const { fieldErrors, setSubmitFieldErrors, reportSubmitFailure, guardSubmit, validatePaths, useForgiveFixed, formRef, formWiring } =
    useDraftFieldErrors({
      schemas: { spieler: FLPatchSpielerPayloadSchema, saisonSpieler: FLPatchSaisonSpielerPayloadSchema },
    });

  // The ids ride in the request URI, so neither is a path an input renders or a refusal can name.
  const buildPersonPayload = () => ({ id: spieler.id, ...personDraft });
  const buildSaisonPayload = () => ({
    spieler_id: spieler.id,
    saison_id: saison.saisonId,
    // Emptied means absent — the boundary where `""` becomes null, as on the person half.
    nummer: nummerPayload(nummer),
    position,
    stufe,
    rolle,
  });

  const draftFields: FLSpielerDraftFields = {
    first_name: personDraft.first_name,
    last_name: personDraft.last_name ?? "",
    birth_date: personDraft.birth_date,
    membership: storedMembership === null ? null : { nummer, position, stufe, rolle },
  };
  const storedFields: FLSpielerDraftFields = {
    first_name: spieler.first_name,
    last_name: spieler.last_name ?? "",
    birth_date: spieler.birth_date,
    membership:
      storedMembership === null
        ? null
        : {
            // `?? ""` so both sides of the comparison are the shape the input holds.
            nummer: storedMembership.nummer ?? "",
            position: storedMembership.position,
            stufe: storedMembership.stufe,
            rolle: storedMembership.rolle,
          },
  };

  const status = deriveSpielerDraftStatus({ stored: storedFields, draft: draftFields, fieldErrors });
  const isDirty = status.isDirty && !hasSaved;

  // The latch's job ends when the revalidated player arrives and the two agree — left latched, every
  // later edit on a restored tree reads as not-dirty.
  if (hasSaved && !status.isDirty) setHasSaved(false);

  useUnsavedChangesWarning(isDirty);

  // Forgiveness runs on every draft change and only ever RETRACTS: a corrected field clears without a blur.
  useForgiveFixed({ spieler: buildPersonPayload(), saisonSpieler: buildSaisonPayload() });

  const validatePersonFields = (paths: readonly string[]) => validatePaths("spieler", buildPersonPayload(), paths);
  const validateSaisonFields = (paths: readonly string[]) => validatePaths("saisonSpieler", buildSaisonPayload(), paths);

  const heldRollen = teams.find((team) => team.teamId === storedMembership?.team_id)?.heldRollen ?? {};
  const heldBy = rolle === null ? undefined : heldRollen[rolle];
  // Only where SOMEBODY ELSE holds it. The current holder keeps the control so they can give it up.
  const blockedRolle = rolle !== null && heldBy !== undefined ? { label: rolleLabel(rolle), heldBy } : null;

  const personDirty = status.changed.some((field) => field.group === "Person");
  const saisonDirty = storedMembership !== null && status.changed.some((field) => field.group === KADER_ABSCHNITT);

  const rowReturn = storedMembership === null ? "open" : judgeRowReturn(storedMembership.team_id, teams);

  const banners = buildSpielerBanners({
    saisonId: saison.saisonId,
    rowInactiveSince: storedMembership?.inactive_since ?? null,
    isRowTeamInSaison: rowReturn !== "clubLeft",
    istNachnominiert: storedMembership?.ist_nachnominiert ?? false,
    blockedRolle,
  });

  const resetDraftToStored = () => {
    setPersonDraft({ first_name: spieler.first_name, last_name: spieler.last_name, birth_date: spieler.birth_date });
    setNummer(storedMembership?.nummer ?? "");
    setPosition(storedMembership?.position ?? null);
    setStufe(storedMembership?.stufe ?? null);
    setRolle(storedMembership?.rolle ?? null);

    setSubmitFieldErrors({}, {});
  };

  const { isLeaving, leavePage, isConfirmingDiscard, closeDiscard, hasLeftViaDiscard, requestLeave, discardAndLeave } = useEditorExit({
    fallbackHref: saisonHref("/area/admin/spieler"),
    isDirty,
    resetDraftToStored,
  });

  useSaveShortcut(formRef, !isPending && !isConfirmingDiscard && confirmingBanners === null && isDirty);

  const requestSave = () => {
    // Only the halves this press writes: judging an untouched half refuses a save over a field nobody sends.
    guardSubmit(
      {
        ...(personDirty ? { spieler: buildPersonPayload() } : {}),
        ...(saisonDirty ? { saisonSpieler: buildSaisonPayload() } : {}),
      },
      writeAfterBlock,
      // The banners go to the gate and are never resolved here, where the dialog would open ahead of the block.
      { banners, confirm: setConfirmingBanners },
    );
  };

  const writeAfterBlock = () => {
    startSaving(async () => {
      const collectedErrors: FieldErrors = {};
      // Built once, so what goes to each action is also what a later blur is graded against.
      const personPayload = buildPersonPayload();
      const saisonPayload = buildSaisonPayload();
      const savedParts: string[] = [];
      const failures: ActionFailure[] = [];

      // Person half first: it cannot depend on the squad half.
      if (personDirty) {
        // A rejected action may still have saved, and uncaught here it takes the editor down with it.
        const res = await patchSpielerAction(personPayload).catch(unansweredAction);
        if (res.success) {
          savedParts.push("Personendaten gespeichert.");
        } else {
          Object.assign(collectedErrors, res.fieldErrors ?? {});
          failures.push(res);
        }
      }

      if (saisonDirty) {
        // A rejected action may still have saved, and uncaught here it takes the editor down with it.
        const res = await patchSaisonSpielerAction(saisonPayload).catch(unansweredAction);
        if (res.success) {
          savedParts.push("Kadereintrag gespeichert.");
        } else {
          Object.assign(collectedErrors, res.fieldErrors ?? {});
          failures.push(res);
        }
      }

      // Wrapped again: React leaves an update after an `await` outside the transition that awaited,
      // so bare it commits before the pending state lifts.
      startSaving(() => {
        if (failures.length > 0) {
          // One press, one failure: the half that saved leads each sentence and marks the press partly
          // saved, and one half of unknown outcome makes the whole press one, whatever the other answered.
          reportSubmitFailure(
            {
              success: false,
              error: [...savedParts, ...failures.map((failure) => failure.error)].join(" "),
              fieldErrors: collectedErrors,
              unplacedError: [...savedParts, ...failures.map((failure) => failure.unplacedError ?? failure.error)].join(" "),
              outcome: failures.some((failure) => failure.outcome === "unknown") ? "unknown" : savedParts.length > 0 ? "partial" : undefined,
            },
            { spieler: personPayload, saisonSpieler: saisonPayload },
            {
              // A mark speaks for its own half alone: a half that saved, or one failing with no map, is
              // said nowhere else.
              evenWhenShown: savedParts.length > 0 || failures.some((failure) => !hasFieldErrors(failure.fieldErrors)),
            },
          );
          return;
        }

        setSubmitFieldErrors({}, {});
        setHasSaved(true);

        // A success rather than a warning: this save destroys nothing without another copy.
        appToast.success("Änderung gespeichert");

        resetDraftToStored();
        leavePage();
      });
    });
  };

  return (
    <DraftStatusProvider status={status}>
      <Form
        wiring={formWiring}
        className="flex min-h-0 w-full flex-1 flex-col"
        onSubmit={requestSave}>
        <EditFormLayout
          header={pageHeader}
          onLeave={requestLeave}
          isLeaving={isLeaving}
          isDirty={isDirty}
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

          <FormAdresseSection
            email={spieler.email}
            adresswechselId={spieler.adresswechsel_id}
            adresswechselVerwehrt={spieler.adresswechsel_einsehbar_verwehrt}
          />

          {/* Beside the name and above the season's panels: consent is the person's, and it does not
              change when the sidemenu's season does. */}
          <FormEinwilligungSection einwilligung={einwilligung} />

          {storedMembership !== null && (
            <FormKaderSection
              saison={{ saisonId: saison.saisonId, saisonStatus: saison.saisonStatus, erlaubteStufen: saison.erlaubteStufen }}
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
              banners={banners}
            />
          )}

          {/* Only where a row exists: there is nothing to take out of a squad the player is not in. */}
          {storedMembership !== null && (
            <FormAustragenSection
              isDirty={isDirty}
              spielerId={spieler.id}
              saisonId={saison.saisonId}
              rowInactiveSince={storedMembership.inactive_since}
              rowReturn={rowReturn}
              banners={banners}
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
          // Never back through the gate: it judged this draft before raising the dialog, and would raise it again.
          writeAfterBlock();
        }}
      />
    </DraftStatusProvider>
  );
}
