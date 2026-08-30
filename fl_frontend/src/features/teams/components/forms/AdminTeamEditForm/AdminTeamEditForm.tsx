"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { parseDate } from "@internationalized/date";

import { Form } from "@heroui/react";

import { patchSaisonTeamAction, patchTeamAction } from "@/features/teams/actions";
import { austrittZustand } from "@/features/teams/constants";
import { FLPatchSaisonTeamPayloadSchema, FLPatchTeamPayloadSchema } from "@/features/teams/schemas";
import { deriveTeamDraftStatus } from "@/features/teams/teamDraftStatus";
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

import { buildTeamBanners } from "./banners";
import { describeSaisonTeamsFanOut, describeSpieleFanOut } from "./fanOutNotes";
import { FormAdresseSection } from "./FormAdresseSection";
import { FormAustrittSection } from "./FormAustrittSection";
import { FormKontakteLinkSection } from "./FormKontakteLinkSection";
import { FormSaisonSection } from "./FormSaisonSection";
import { FormVereinSection } from "./FormVereinSection";

import type { SaisonGruppenSwapContext } from "@/features/saisons/types";
import type {
  FLAustrittType,
  FLGruppenNames,
  FLPatchSaisonTeamPayload,
  FLPatchTeamPayload,
  FLPostTeamPayload,
  FLSchulform,
  FLTeamRecord,
  FLTrikotFarbe,
} from "@/features/teams/schemas";
import type { FLTeamDraftFields } from "@/features/teams/teamDraftStatus";
import type { GruppeOffer, TeamSaisonMembership } from "@/features/teams/types";
import type { EditPageHeaderContent } from "@/shared/components/ui/EditPageHeader";
import type { BlockingBanners } from "@/shared/components/ui/railBanner";
import type { FieldErrors } from "@/shared/utils/validation";
import type { CalendarDate } from "@internationalized/date";

/** What the undo replays: the halves the save wrote, holding their PRE-SAVE values. */
type TeamUndoPayloads = {
  club?: FLPatchTeamPayload;
  saison?: FLPatchSaisonTeamPayload;
};

/**
 * A `fetch`, not a server action: by the time the offer is pressed this component is unmounted and
 * the browser elsewhere, and an action dispatched from there trips Next's E592 invariant.
 * **Revert once E592 is fixed upstream.**
 */
async function postTeamUndo(payloads: TeamUndoPayloads): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch("/api/admin/teams/undo", {
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
export function AdminTeamEditForm({
  team,
  saison,
  today,
  gruppeLocked,
  gruppeOffer,
  swap,
  pageHeader,
}: {
  team: FLTeamRecord;
  /** The sidemenu selector's season and its junction row, resolved by the page. */
  saison: TeamSaisonMembership;
  today: string;
  /** The page's answer to "may the group move": whether the club holds a fixture in this season. */
  gruppeLocked: boolean;
  /** The selected season's groups with their fill state, from `buildGruppeOffer`. */
  gruppeOffer: readonly GruppeOffer[];
  /** The selected season's swap state, from `buildGruppenSwapContext`. */
  swap: SaisonGruppenSwapContext;
  pageHeader: EditPageHeaderContent;
}) {
  const router = useRouter();
  const saisonHref = useSaisonHref();
  const [isPending, startTransition] = useTransition();
  const [isLeaving, startLeaving] = useTransition();

  const storedMembership = saison.membership;

  const [clubDraft, setClubDraft] = useState<FLPostTeamPayload>({
    name: team.name,
    shorthand: team.shorthand,
    full_name: team.full_name,
    website_url: team.website_url,
    description: team.description,
    address: team.address,
    schulform: team.schulform,
  });

  const [gruppe, setGruppe] = useState<FLGruppenNames | null>(storedMembership?.gruppe ?? null);
  const [trikotFarbe, setTrikotFarbe] = useState<FLTrikotFarbe | null>(storedMembership?.trikot_farbe ?? null);
  const [hasAustritt, setHasAustritt] = useState(storedMembership?.austritt != null);
  // Null until a route is chosen, so a new record accuses nobody; the schema refuses the null.
  const [art, setArt] = useState<FLAustrittType | null>(storedMembership?.austritt?.type ?? null);
  const [grund, setGrund] = useState(storedMembership?.austritt?.grund ?? "");
  const [datum, setDatum] = useState<CalendarDate | null>(() => {
    const storedDatum = storedMembership?.austritt?.datum;
    return storedDatum ? parseDate(storedDatum) : null;
  });

  const [hasSaved, setHasSaved] = useState(false);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [confirmingBanners, setConfirmingBanners] = useState<BlockingBanners | null>(null);
  const [hasLeftViaDiscard, setHasLeftViaDiscard] = useState(false);

  const { fieldErrors, setSubmitFieldErrors, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { team: FLPatchTeamPayloadSchema, saisonTeam: FLPatchSaisonTeamPayloadSchema },
  });

  // The record as the draft would save it. `""` for a cleared date is what the schema rejects with
  // its own German message, so a half-entered record is a field error rather than a silent skip.
  const draftAustritt = hasAustritt ? { type: art, grund, datum: datum?.toString() ?? "" } : null;

  // The ids ride in the request path, so neither is a field an input renders or a refusal can name.
  const buildClubPayload = () => ({ id: team.id, ...clubDraft });
  const buildSaisonPayload = () => ({
    team_id: team.id,
    saison_id: saison.saisonId,
    gruppe,
    austritt: draftAustritt,
    trikot_farbe: trikotFarbe,
  });

  const draftFields: FLTeamDraftFields = {
    ...clubDraft,
    membership: storedMembership === null ? null : { gruppe, austritt: draftAustritt, trikot_farbe: trikotFarbe },
  };
  const storedFields: FLTeamDraftFields = {
    name: team.name,
    shorthand: team.shorthand,
    full_name: team.full_name,
    website_url: team.website_url,
    description: team.description,
    address: team.address,
    schulform: team.schulform,
    membership: storedMembership,
  };

  const status = deriveTeamDraftStatus({ stored: storedFields, draft: draftFields, fieldErrors });
  const isDirty = status.isDirty && !hasSaved;

  // The latch's job ends when the revalidated club arrives and the two agree — left latched, every
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
  useForgiveFixed({ team: buildClubPayload(), saisonTeam: buildSaisonPayload() });

  const validateClubFields = (paths: readonly string[]) => validatePaths("team", buildClubPayload(), paths);
  const validateSaisonFields = (paths: readonly string[]) => validatePaths("saisonTeam", buildSaisonPayload(), paths);
  // Judged with the value that arrived in the event, because state has not committed yet.
  const validateGruppeSelection = (paths: readonly string[], selected: { gruppe: FLGruppenNames }) =>
    validatePaths("saisonTeam", { ...buildSaisonPayload(), ...selected }, paths);
  const validateSchulformSelection = (paths: readonly string[], selected: { schulform: FLSchulform | null }) =>
    validatePaths("team", { ...buildClubPayload(), ...selected }, paths);
  const validateTrikotSelection = (paths: readonly string[], selected: { trikot_farbe: FLTrikotFarbe | null }) =>
    validatePaths("saisonTeam", { ...buildSaisonPayload(), ...selected }, paths);

  const isChanged = (path: string) => status.byPath.get(path)?.isChanged ?? false;
  const clubDirty = status.changed.some((field) => field.group !== "Saison");
  const saisonDirty = storedMembership !== null && status.changed.some((field) => field.group === "Saison");

  // Read by the banners AND by the season panel, whose entry affordance it closes: one derivation,
  // so the sentence and the control it explains cannot disagree.
  const isRetired = team.inactive_since !== null;

  const banners = buildTeamBanners({
    isRetired,
    saisonId: saison.saisonId,
    saisonStatus: saison.saisonStatus,
    isMember: storedMembership !== null,
    storedAustritt: storedMembership?.austritt ?? null,
    hasAustritt,
    draftGrund: grund,
    isGruppeLocked: gruppeLocked,
    isGruppeChanged: isChanged("gruppe"),
  });

  const leavePage = () => {
    // Blur first: react-aria's focus attribute survives a kept-alive tree.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    // Hover next, and the disabled flag is what ends it: `useHover` clears `data-hovered` when a
    // control turns disabled, and no `pointerleave` follows a click that leaves.
    startLeaving(() => {
      if (window.history.length > 1) router.back();
      else router.push(saisonHref("/admin/teams"));
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
    setClubDraft({
      name: team.name,
      shorthand: team.shorthand,
      full_name: team.full_name,
      website_url: team.website_url,
      description: team.description,
      address: team.address,
      schulform: team.schulform,
    });
    setGruppe(storedMembership?.gruppe ?? null);
    setTrikotFarbe(storedMembership?.trikot_farbe ?? null);
    setHasAustritt(storedMembership?.austritt != null);
    setArt(storedMembership?.austritt?.type ?? null);
    setGrund(storedMembership?.austritt?.grund ?? "");
    setDatum(storedMembership?.austritt?.datum ? parseDate(storedMembership.austritt.datum) : null);

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
    // Only the halves this press writes: `aria` blocks nothing natively, and judging an untouched half
    // would refuse a save over a field nobody is sending.
    guardSubmit(
      {
        ...(clubDirty ? { team: buildClubPayload() } : {}),
        ...(saisonDirty ? { saisonTeam: buildSaisonPayload() } : {}),
      },
      writeAfterBlock,
    );
  };

  const writeAfterBlock = () => {
    startTransition(async () => {
      const collectedErrors: FieldErrors = {};
      // Built once, so what goes to each action is also what a later blur is graded against.
      const clubPayload = buildClubPayload();
      const saisonPayload = buildSaisonPayload();
      // Only what the admin cannot see from the form earns a sentence: the fan-out when the name or
      // Kürzel moved, the disqualification when the record changed.
      const renameTouched = isChanged("name") || isChanged("shorthand");
      const austrittTouched = isChanged("austritt");
      const consequenceNotes: string[] = [];
      const savedParts: string[] = [];
      const failedNotes: string[] = [];

      // Club half first: it cannot depend on the season half, and its fan-out note leads the toast.
      if (clubDirty) {
        const res = await patchTeamAction(clubPayload);
        if (res.success) {
          savedParts.push("Stammdaten gespeichert.");
          // Seasons before fixtures: the junction is what the next season copies from, so it is the
          // broader statement, and each count is its own sentence because their zeros differ.
          if (renameTouched) {
            consequenceNotes.push(
              describeSaisonTeamsFanOut(res.fanned_out_to_saison_teams ?? 0),
              describeSpieleFanOut(res.fanned_out_to_spiele ?? 0),
            );
          }
        } else {
          Object.assign(collectedErrors, res.fieldErrors ?? {});
          failedNotes.push(res.fieldErrors?.shorthand ?? res.error ?? "Die Teamdaten konnten nicht gespeichert werden.");
        }
      }

      if (saisonDirty) {
        const res = await patchSaisonTeamAction(saisonPayload);
        if (res.success) {
          savedParts.push("Saison gespeichert.");
          if (austrittTouched) {
            // The echoed record names the route, so the sentence says which one landed rather than
            // reaching for a word that fits only one of the two.
            const saved = res.saison_team?.austritt ?? null;
            consequenceNotes.push(saved === null ? "Der Austritt ist aufgehoben." : `${austrittZustand(saved.type)}: sofort überall sichtbar.`);
          }
        } else {
          Object.assign(collectedErrors, res.fieldErrors ?? {});
          failedNotes.push(res.fieldErrors?.gruppe ?? res.error ?? "Die Saison-Zugehörigkeit konnte nicht gespeichert werden.");
        }
      }

      if (failedNotes.length > 0) {
        setSubmitFieldErrors(collectedErrors, { team: clubPayload, saisonTeam: saisonPayload });
        // ALWAYS toasted, field errors or not — an inline message would be gone before it was read.
        appToast.danger(savedParts.length > 0 ? "Nur teilweise gespeichert" : "Speichern fehlgeschlagen", {
          description: [...savedParts, ...failedNotes].join(" "),
        });
        return;
      }

      setSubmitFieldErrors({}, {});
      setHasSaved(true);

      // `team` and `storedMembership` are this render's props, so they still carry the pre-save
      // values. Built BEFORE leaving, because the toast outlives the page.
      const undoPayloads: TeamUndoPayloads = {
        ...(clubDirty
          ? {
              club: {
                id: team.id,
                name: team.name,
                shorthand: team.shorthand,
                full_name: team.full_name,
                website_url: team.website_url,
                description: team.description,
                address: team.address,
                schulform: team.schulform,
              },
            }
          : {}),
        ...(saisonDirty && storedMembership !== null
          ? {
              saison: {
                team_id: team.id,
                saison_id: saison.saisonId,
                gruppe: storedMembership.gruppe,
                austritt: storedMembership.austritt,
                trikot_farbe: storedMembership.trikot_farbe,
              },
            }
          : {}),
      };
      // A lifted disqualification is the one thing this save can destroy that nothing else copies,
      // so that grade is a warning; an ordinary save is a reversible success.
      const destroyedSomething = austrittTouched && draftAustritt === null && storedMembership?.austritt != null;
      offerUndo(undoPayloads, consequenceNotes.join(" ") || undefined, destroyedSomething);

      // AFTER the undo payloads are built: leaving with typed values still in state is what let a
      // save-then-undo reopen on values the club no longer holds.
      resetDraftToStored();
      leavePage();
    });
  };

  /** A warning where the save destroyed something nothing else copies, a success otherwise. */
  const offerUndo = (payloads: TeamUndoPayloads, message?: string, destroyedSomething = false) => {
    const raise = destroyedSomething ? appToast.warning : appToast.success;

    raise("Änderung gespeichert", {
      description: message ?? "Die Teamdaten wurden aktualisiert.",
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
          void postTeamUndo(payloads).then(
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
                // The connection alone: the request never reached a judgement, so naming
                // the Team would send the admin to inspect values nothing here read.
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
              nomen="Team"
            />
          }>
          <FormVereinSection
            draft={clubDraft}
            onChange={setClubDraft}
            onFieldLeft={validateClubFields}
            onValidateSelection={validateSchulformSelection}
          />

          <FormAdresseSection
            address={clubDraft.address}
            onChange={(nextAddress) => setClubDraft((current) => ({ ...current, address: nextAddress }))}
            onFieldLeft={validateClubFields}
          />

          <FormSaisonSection
            saison={{ saisonId: saison.saisonId, saisonStatus: saison.saisonStatus }}
            gruppeOffer={gruppeOffer}
            gruppeLock={{ locked: gruppeLocked }}
            isMember={storedMembership !== null}
            isRetired={isRetired}
            gruppe={gruppe}
            onGruppeChange={setGruppe}
            onValidateSelection={validateGruppeSelection}
            trikotFarbe={trikotFarbe}
            onTrikotFarbeChange={setTrikotFarbe}
            onValidateTrikotSelection={validateTrikotSelection}
            swap={swap}
            teamId={team.id}
            banners={banners}
          />

          {/* Above the Austritt panel, which is this page's one destructive section and so has to
              close it: a link seated under a red panel reads as one of its consequences. */}
          {storedMembership !== null && (
            <FormKontakteLinkSection
              saisonId={saison.saisonId}
              kontakte={storedMembership.kontakte}
              href={`/admin/kontakte/${team.id}?saison_id=${encodeURIComponent(saison.saisonId)}`}
            />
          )}

          {storedMembership !== null && (
            <FormAustrittSection
              hasAustritt={hasAustritt}
              onHasAustrittChange={(next) => {
                setHasAustritt(next);
                // Seeded with today, the common case for "took effect"; the lift stays a draft
                // until the save sends the explicit null. `art` is NOT seeded -- which route it was
                // is the one thing here nobody can guess for the admin.
                if (next && datum === null) setDatum(parseDate(today));
              }}
              banners={banners}
              art={art}
              onArtChange={setArt}
              grund={grund}
              onGrundChange={setGrund}
              datum={datum}
              onDatumChange={setDatum}
              onValidateFields={validateSaisonFields}
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
