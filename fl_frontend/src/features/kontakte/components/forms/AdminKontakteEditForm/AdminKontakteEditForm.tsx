"use client";

import { useState, useTransition } from "react";

import { patchSaisonTeamKontakteAction } from "@/features/kontakte/actions";
import { deriveKontakteDraftStatus } from "@/features/kontakte/kontakteDraftStatus";
import { kontakteMayMoveLinks } from "@/features/kontakte/linkMint";
import { FLPatchSaisonTeamKontaktePayloadSchema } from "@/features/kontakte/schemas";
import {
  addressOnlyConfirmedSeatLabels,
  emptiedSeatLabels,
  kontaktZeile,
  mirrorKontakte,
  renamedConfirmedSeatLabels,
  teamPageHref,
  toKontaktePayload,
} from "@/features/kontakte/utils";
import { holdsNobody } from "@/features/teams/utils";
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
import { useStepUp } from "@/shared/hooks/useStepUp";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";
import { unansweredAction } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { versandWarnt } from "@/shared/utils/linkVersand";

import { buildKontakteBanners } from "./banners";
import { FormKontakteLoeschenSection } from "./FormKontakteLoeschenSection";
import { FormKontakteSection } from "./FormKontakteSection";

import type { FLPatchSaisonTeamKontaktePayload } from "@/features/kontakte/schemas";
import type { MedienFragen } from "@/features/spieler/nachweis";
import type { SaisonTeamKontakteDraft, TeamSaisonMembership } from "@/features/teams/types";
import type { EditPageHeaderContent } from "@/shared/components/ui/EditPageHeader";
import type { BlockingBanners } from "@/shared/components/ui/railBanner";

/**
 * **One save bar over one endpoint.** `PATCH /teams/{team_id}/saisons/{saison_id}/kontakte` writes the
 * three seats and nothing else, so this page never has to report a half-saved row the way the club
 * editor's two-endpoint save does.
 */
export function AdminKontakteEditForm({
  laufendesLabel,
  medienFragen,
  teamId,
  saison,
  pageHeader,
}: {
  /** The label the application form runs, read by the page per request: a seat opened blank stamps it. */
  laufendesLabel: string | null;
  medienFragen: MedienFragen;
  teamId: string;
  /** The sidemenu selector's season and its junction row, resolved by the page. */
  saison: TeamSaisonMembership;
  pageHeader: EditPageHeaderContent;
}) {
  const saisonHref = useSaisonHref();
  const [isPending, startSaving] = useTransition();
  const stepUp = useStepUp();

  const storedMembership = saison.membership;
  // Read ONCE, so the seed and the change list's stored half cannot disagree about what the season
  // holds.
  const storedKontakte = storedMembership?.kontakte ?? null;
  // The token the read served, echoed and never rebuilt here. A club outside the season has no row
  // and so no token, and the save that would carry the empty string is a 404 before it is judged.
  const kontakteStand = storedMembership?.kontakte_stand ?? "";
  // Nobody on file opens as a block nobody has entered, whichever shape stores it: seeded raw, a block
  // an erasure emptied opens with every seat switched off where an absent one opens with all three on.
  const seed = holdsNobody(storedKontakte) ? null : storedKontakte;

  const [kontakte, setKontakte] = useState<SaisonTeamKontakteDraft | null>(seed);

  const [hasSaved, setHasSaved] = useState(false);
  const [confirmingBanners, setConfirmingBanners] = useState<BlockingBanners | null>(null);

  const { fieldErrors, setSubmitFieldErrors, reportSubmitFailure, guardSubmit, validatePaths, useForgiveFixed, formRef, formWiring } =
    useDraftFieldErrors({
      schemas: { kontakte: FLPatchSaisonTeamKontaktePayloadSchema },
    });

  // Both ids ride in the request path, so neither is a field an input renders or a refusal can name.
  const buildPayload = (): FLPatchSaisonTeamKontaktePayload => ({
    team_id: teamId,
    saison_id: saison.saisonId,
    // The claim is honoured HERE and nowhere earlier
    // (`fl_frontend/src/features/kontakte/utils.ts :: mirrorKontakte`), and the write shape composed
    // with it: the guard refuses whatever body it is handed, at paths no control renders.
    kontakte: toKontaktePayload(kontakte === null ? null : mirrorKontakte(kontakte)),
    kontakte_stand: kontakteStand,
  });

  const status = deriveKontakteDraftStatus({ stored: { kontakte: storedKontakte }, draft: { kontakte }, fieldErrors });
  const isDirty = status.isDirty && !hasSaved;

  // The latch's job ends when the revalidated row arrives and the two agree — left latched, every
  // later edit on a restored tree reads as not-dirty.
  if (hasSaved && !status.isDirty) setHasSaved(false);

  useUnsavedChangesWarning(isDirty);

  // Forgiveness runs on every draft change and only ever RETRACTS: a corrected field clears without a blur.
  useForgiveFixed({ kontakte: buildPayload() });

  const validateFields = (paths: readonly string[]) => validatePaths("kontakte", buildPayload(), paths);
  // Judged with the value that arrived in the event, because state has not committed yet.
  const validateSelection = (paths: readonly string[], selected: { kontakte: SaisonTeamKontakteDraft | null }) =>
    // Mirrored like every other judgement: spread raw, a pick was judged against the unmirrored draft
    // while a blur was judged against the composed one, so the two disagreed about the Trainer.
    validatePaths(
      "kontakte",
      { ...buildPayload(), kontakte: toKontaktePayload(selected.kontakte === null ? null : mirrorKontakte(selected.kontakte)) },
      paths,
    );

  const banners = buildKontakteBanners({
    saisonId: saison.saisonId,
    saisonStatus: saison.saisonStatus,
    isMember: storedMembership !== null,
    // Off the two COMPOSED blocks, never the controls: emptying the named seat empties the Trainer
    // with it, and neither seat's own control was pressed.
    emptiedSeatLabels: emptiedSeatLabels(storedKontakte, kontakte === null ? null : mirrorKontakte(kontakte)),
    // Composed for the same reason: renaming the named seat renames the Trainer reading it, and the
    // server unstamps the composed block it is sent.
    renamedConfirmedSeatLabels: renamedConfirmedSeatLabels(storedKontakte, kontakte === null ? null : mirrorKontakte(kontakte)),
    addressOnlySeatLabels: addressOnlyConfirmedSeatLabels(storedKontakte, kontakte === null ? null : mirrorKontakte(kontakte)),
  });

  const resetDraftToStored = () => {
    setKontakte(seed);

    setSubmitFieldErrors({}, {});
  };

  const { isLeaving, leavePage, isConfirmingDiscard, closeDiscard, hasLeftViaDiscard, requestLeave, discardAndLeave } = useEditorExit({
    fallbackHref: saisonHref("/bereich/admin/kontakte"),
    isDirty,
    resetDraftToStored,
  });

  useSaveShortcut(formRef, !isPending && !isConfirmingDiscard && confirmingBanners === null && isDirty);

  const requestSave = () => {
    // The banners go to the gate and are never resolved here, where the dialog would open ahead of the block.
    // The dialog holds the gate's snapshot, which a revalidation cannot move.
    guardSubmit({ kontakte: buildPayload() }, writeAfterBlock, { banners, confirm: setConfirmingBanners });
  };

  const writeAfterBlock = () => {
    // A save seating, removing or replacing a person mints or voids a link, a step-up write.
    stepUp.confirmThen(kontakteMayMoveLinks(storedKontakte, buildPayload().kontakte), () =>
      startSaving(async () => {
        const payload = buildPayload();
        // A rejected action may still have saved, and uncaught here it takes the editor down with it.
        const res = await patchSaisonTeamKontakteAction(payload).catch(unansweredAction);

        // Wrapped again: React leaves an update after an `await` outside the transition that awaited,
        // so bare it commits before the pending state lifts.
        startSaving(() => {
          if (!res.success) {
            reportSubmitFailure(res, { kontakte: payload });
            return;
          }

          setSubmitFieldErrors({}, {});
          setHasSaved(true);

          // One whose link did not go out is graded a warning: the seat holds no working link and
          // nobody else is told.
          const warn = versandWarnt(res.versand);
          const raise = warn ? appToast.warning : appToast.success;
          // The link's own sentence in place of the save's: where the save mailed somebody, dropping
          // it leaves an administrator with no record that a message was sent at all.
          raise(warn ? "Mit Folgen gespeichert" : "Änderung gespeichert", { description: res.versandSatz ?? res.message });

          resetDraftToStored();
          leavePage();
        });
      }),
    );
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
              nomen="Kontakte"
            />
          }>
          <FormKontakteSection
            laufendesLabel={laufendesLabel}
            medienFragen={medienFragen}
            value={kontakte}
            stored={storedKontakte}
            bestaetigungen={storedMembership?.bestaetigungen ?? null}
            adresswechsel={storedMembership?.adresswechsel ?? null}
            teamId={teamId}
            saisonId={saison.saisonId}
            nimmtLinks={kontaktZeile(saison.saisonStatus, storedMembership?.austritt ?? null) === "offen"}
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
              hasStored={!holdsNobody(storedKontakte)}
              stand={kontakteStand}
              isDirty={isDirty}
            />
          )}
        </EditFormLayout>

        <FormActionBar
          isPending={isPending || stepUp.isPrompting}
          isLeaving={isLeaving}
          onCancel={requestLeave}
          stepUp={stepUp}
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
