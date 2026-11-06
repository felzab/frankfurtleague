"use client";

import { useState, useTransition } from "react";

import { useUnsavedChangesWarning } from "@/kit/useUnsavedChangesWarning";

import { kaderName, NUMMER_DOUBLE } from "@/features/spieler/constants";
import { patchKaderRowAction } from "@/features/spieler/personActions";
import { FLPatchKaderRowPayloadSchema } from "@/features/spieler/schemas";
import { nummerPayload } from "@/features/spieler/utils";
import { labelBadge } from "@/shared/components/ui/badges";
import { ConfirmDiscardModal } from "@/shared/components/ui/ConfirmDiscardModal";
import { DraftRail } from "@/shared/components/ui/DraftRail";
import { DraftStatusProvider } from "@/shared/components/ui/DraftStatusContext";
import { EditFormLayout } from "@/shared/components/ui/EditFormLayout";
import { Form } from "@/shared/components/ui/Form";
import { FormActionBar } from "@/shared/components/ui/FormActionBar";
import { PAGE_RISE_CLASSES } from "@/shared/components/ui/motion";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { useEditorExit } from "@/shared/hooks/useEditorExit";
import { useSaveShortcut } from "@/shared/hooks/useSaveShortcut";
import { unansweredAction } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

import { FormKaderRowRetireSection } from "./FormKaderRowRetireSection";
import { FormKaderRowSection } from "./FormKaderRowSection";
import { deriveKaderRowDraftStatus } from "./kaderRowDraftStatus";

import type { FLKaderRow, FLSpielerPosition, FLSpielerRolle, FLSpielerStufe } from "@/core/generated/client/types";
import type { FLKaderRowDraftFields } from "./kaderRowDraftStatus";

/**
 * A seat holder's editor over one live squad row. No undo is offered: the person lane has no replay
 * route, and the stored values stand on this page until the save.
 */
export function KaderRowEditForm({
  teamId,
  saisonId,
  row,
  allowedStufen,
  heldRollen,
  kaderHref,
}: {
  teamId: string;
  saisonId: string;
  row: FLKaderRow;
  /** The season's levels in the league's order, which is all the form offers beside the row's own. */
  allowedStufen: readonly FLSpielerStufe[];
  /** Who else holds each role in this squad, read off the squad's other live rows. */
  heldRollen: Partial<Record<FLSpielerRolle, string>>;
  kaderHref: string;
}) {
  const [isPending, startSaving] = useTransition();

  const stored: FLKaderRowDraftFields = { nummer: row.nummer ?? "", position: row.position, stufe: row.stufe, rolle: row.rolle };
  const [nummer, setNummer] = useState(stored.nummer);
  const [position, setPosition] = useState<FLSpielerPosition | null>(stored.position);
  const [stufe, setStufe] = useState<FLSpielerStufe | null>(stored.stufe);
  const [rolle, setRolle] = useState<FLSpielerRolle | null>(stored.rolle);
  const [hasSaved, setHasSaved] = useState(false);

  const { fieldErrors, setSubmitFieldErrors, reportSubmitFailure, guardSubmit, validatePaths, useForgiveFixed, formRef, formWiring } =
    useDraftFieldErrors({ schemas: { kaderRow: FLPatchKaderRowPayloadSchema } });

  // The three ids ride in the request's path, so no refusal can name one and no input renders one.
  const buildPayload = () => ({
    team_id: teamId,
    saison_id: saisonId,
    spieler_id: row.spieler_id,
    // Emptied means absent, the boundary where `""` becomes null.
    nummer: nummerPayload(nummer),
    position,
    stufe,
    rolle,
  });

  const status = deriveKaderRowDraftStatus({ stored, draft: { nummer, position, stufe, rolle }, fieldErrors });
  const isDirty = status.isDirty && !hasSaved;

  // The latch's job ends when the refreshed row arrives and the two agree.
  if (hasSaved && !status.isDirty) setHasSaved(false);

  useUnsavedChangesWarning(isDirty);
  useForgiveFixed({ kaderRow: buildPayload() });

  const validateFields = (paths: readonly string[]) => validatePaths("kaderRow", buildPayload(), paths);

  // The row's stored level stays on offer where the season was narrowed after it: the write takes it
  // back unchanged, and a picker without it would show the field empty.
  const stufeOptions = stored.stufe === null || allowedStufen.includes(stored.stufe) ? allowedStufen : [...allowedStufen, stored.stufe];

  const resetDraftToStored = () => {
    setNummer(stored.nummer);
    setPosition(stored.position);
    setStufe(stored.stufe);
    setRolle(stored.rolle);

    setSubmitFieldErrors({}, {});
  };

  const { isLeaving, leavePage, isConfirmingDiscard, closeDiscard, hasLeftViaDiscard, requestLeave, discardAndLeave } = useEditorExit({
    fallbackHref: kaderHref,
    isDirty,
    resetDraftToStored,
  });

  useSaveShortcut(formRef, !isPending && !isConfirmingDiscard && isDirty);

  const write = () => {
    startSaving(async () => {
      const payload = buildPayload();
      // A rejected action may still have saved, and uncaught here it takes the editor down with it.
      const res = await patchKaderRowAction(payload).catch(unansweredAction);
      // Wrapped again: React leaves an update after an `await` outside the transition that awaited.
      startSaving(() => {
        if (!res.success) {
          reportSubmitFailure(res, { kaderRow: payload });
          return;
        }

        setSubmitFieldErrors({}, {});
        setHasSaved(true);
        appToast.success("Kadereintrag gespeichert");
        resetDraftToStored();
        leavePage();
      });
    });
  };

  return (
    <div className={`${PAGE_RISE_CLASSES} flex min-h-0 w-full flex-1 flex-col`}>
      <DraftStatusProvider status={status}>
        <Form
          wiring={formWiring}
          className="flex min-h-0 w-full flex-1 flex-col"
          onSubmit={() => guardSubmit({ kaderRow: buildPayload() }, write)}>
          <EditFormLayout
            header={{
              title: kaderName(row),
              // A state outranks the number, which is a field of the form below: the clash is said nowhere else here.
              chip: row.nummer_double ? (
                <span className={labelBadge("warning")}>{NUMMER_DOUBLE}</span>
              ) : row.nummer === null ? undefined : (
                <span className="flex h-10 min-w-10 items-center justify-center rounded-xl bg-muted px-2 font-extrabold text-foreground shadow-sm">
                  {row.nummer}
                </span>
              ),
            }}
            onLeave={requestLeave}
            isLeaving={isLeaving}
            isDirty={isDirty}
            rail={
              <DraftRail
                banners={[]}
                nomen="Kadereintrag"
              />
            }>
            <FormKaderRowSection
              nummer={nummer}
              onNummerChange={setNummer}
              position={position}
              onPositionChange={setPosition}
              stufe={stufe}
              onStufeChange={setStufe}
              stufeOptions={stufeOptions}
              rolle={rolle}
              onRolleChange={setRolle}
              heldRollen={heldRollen}
              onValidateFields={validateFields}
            />

            <FormKaderRowRetireSection
              teamId={teamId}
              saisonId={saisonId}
              spielerId={row.spieler_id}
              isDirty={isDirty}
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
      </DraftStatusProvider>
    </div>
  );
}
