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
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { resolveBlockingBanners } from "@/shared/components/ui/railBanner";
import { useDraftValidation } from "@/shared/hooks/useDraftValidation";
import { useServerFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";
import { appToast } from "@/shared/utils/appToast";

import { buildSpielerBanners } from "./banners";
import { FormAustragenSection } from "./FormAustragenSection";
import { FormKaderSection } from "./FormKaderSection";
import { FormPersonSection } from "./FormPersonSection";
import { SpielerActionBar } from "./SpielerActionBar";
import { SpielerDraftStatusProvider } from "./SpielerDraftStatusContext";
import { SpielerRail } from "./SpielerRail";

import type { FLPatchSaisonSpielerPayload, FLPatchSpielerPayload, FLSpielerPosition, FLSpielerStufe } from "@/features/spieler/schemas";
import type { FLSpielerDraftFields } from "@/features/spieler/spielerDraftStatus";
import type { SpielerPersonFields, SpielerSaisonMembership, SpielerTeamOption } from "@/features/spieler/types";
import type { FieldErrors } from "@/shared/utils/validation";
import type { ReactNode } from "react";

/**
 * How long the undo offer stands after a save (ADR-0041's window, ADR-0049's transport). It stands
 * on every save, confirmed or not: a confirmation is the carve-out for a draft carrying a warning
 * or a danger, and undo is what still helps the admin who was not paying attention (ADR-0070).
 */
const UNDO_TIMEOUT_MS = 15000;

/** What the undo replays: the halves the save actually wrote, holding their PRE-SAVE values. */
type SpielerUndoPayloads = {
  person?: FLPatchSpielerPayload;
  saison?: FLPatchSaisonSpielerPayload;
};

/**
 * Sends the undo, and it is a `fetch` rather than a server action for one reason (ADR-0049: an undo
 * belongs to a page-owned editor, and nothing else becomes a route handler): by the time the offer
 * is pressed this component is unmounted and the browser is on another route, and a server action
 * dispatched from there trips Next's E592 invariant and is truncated mid-response.
 * **Revert this to a server action once E592 is fixed upstream**; the ADR names that condition.
 */
async function postSpielerUndo(payloads: SpielerUndoPayloads): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch("/api/admin/spieler/undo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The route answers 200 with the outcome in the body for every reportable case, so a non-2xx is
    // a genuine transport failure and belongs in the rejection branch.
    body: JSON.stringify(payloads),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}`);
  }

  return response.json() as Promise<{ success: boolean; message?: string; error?: string }>;
}

/**
 * The squad editor's form: two panels, a sticky summary rail, and one derivation behind both — the
 * match editor's shape (ADR-0040) over a player. Every field is controlled, judged when it is left
 * with the same schemas the actions parse, and marked in place when its draft differs from stored.
 *
 * **One save bar over TWO endpoints.** The person's names are `PATCH /spieler/{spieler_id}` and the
 * squad fields are `PATCH /spieler/{spieler_id}/saisons/{saison_id}`; the submit runs whichever
 * halves are dirty, in that order. A half that fails keeps the page here with its message on the
 * field — and because a half that SUCCEEDED revalidates the route, a partial failure is also named
 * in a toast, which outlives the remount the revalidation causes.
 */
export function AdminSpielerEditForm({
  spieler,
  saison,
  teams,
  registerRequestLeave,
  pageHeader,
}: {
  spieler: { id: string; vorname: string; nachname: string | null; inactive_since: string | null };
  /** The selected season's context and squad row — the sidemenu selector's season, resolved by the page. */
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
  // Read-only on this page (decided 2026-08-07): it records how the entry came about and the create
  // form derives it. Held in state anyway, because the patch replaces the row wholesale and dropping
  // it from the payload would clear it.
  const [isNachgetragen, setIsNachgetragen] = useState(storedMembership?.is_nachgetragen ?? false);
  const [isCaptain, setIsCaptain] = useState(storedMembership?.is_captain ?? false);

  const [hasSaved, setHasSaved] = useState(false);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [isConfirmingSave, setIsConfirmingSave] = useState(false);
  const [hasLeftViaDiscard, setHasLeftViaDiscard] = useState(false);

  const {
    fieldErrors: serverFieldErrors,
    setFieldErrors,
    formRef,
  } = useServerFieldErrors(() =>
    appToast.danger("Speichern fehlgeschlagen", {
      description: "Der Server hat eine Angabe beanstandet, die dieses Formular nicht anzeigt. Lade die Seite neu.",
    }),
  );

  // Two validators, because the two halves are two payloads with two schemas — merged at render so
  // one map reaches the fields, exactly as the server's own messages do.
  const personValidation = useDraftValidation(FLPatchSpielerPayloadSchema);
  const saisonValidation = useDraftValidation(FLPatchSaisonSpielerPayloadSchema);

  const buildPersonPayload = () => ({ id: spieler.id, ...personDraft });
  const buildSaisonPayload = () => ({
    spieler_id: spieler.id,
    saison_id: saison.saisonId,
    team_id: teamId,
    // Emptied means absent, not a number nobody wears — the boundary where `""` becomes null, the
    // same rule `nachname` follows on the person half.
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
            // `?? ""` so both sides of the comparison are the shape the input holds; the derivation
            // reads an empty string and a null identically anyway.
            nummer: storedMembership.nummer ?? "",
            position: storedMembership.position,
            stufe: storedMembership.stufe,
            is_nachgetragen: storedMembership.is_nachgetragen,
            is_captain: storedMembership.is_captain,
          },
  };

  const fieldErrors = saisonValidation.mergedWith(personValidation.mergedWith(serverFieldErrors));
  const status = deriveSpielerDraftStatus({ stored: storedFields, draft: draftFields, fieldErrors, teams });
  const isDirty = status.isDirty && !hasSaved;

  // See the match editor: the latch's job ends the moment the revalidated player arrives and the two
  // agree — left latched, every later edit on a restored tree read as not-dirty.
  if (hasSaved && !status.isDirty) setHasSaved(false);

  useUnsavedChangesWarning(isDirty);

  // Ctrl+S / Cmd+S submits, gated on the same conditions as the Speichern button — the match
  // editor's reasoning, unchanged.
  const canSubmitRef = useRef(true);
  useEffect(() => {
    canSubmitRef.current = !isPending && !isConfirmingDiscard && !isConfirmingSave && isDirty;
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

  const validatePersonFields = (paths: readonly string[]) => personValidation.validatePaths(buildPersonPayload(), paths);
  const validateSaisonFields = (paths: readonly string[]) => saisonValidation.validatePaths(buildSaisonPayload(), paths);
  // The picked-control variant — judged with the value that arrived in the event, because state has
  // not committed yet (see the match editor's `validateSelection`).
  const validateTeamSelection = (paths: readonly string[], selected: { team_id: string }) =>
    saisonValidation.validatePaths({ ...buildSaisonPayload(), ...selected }, paths);

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

  // The nachgetragen note is rail-only, which is what the rail is FOR (decided 2026-08-07): every
  // standing remark about this player in one place, rather than a row inside a panel of editable
  // fields where it read as a control somebody had disabled.
  /** Every Hinweis this draft raises — the rail's list and the panels' inline callouts alike. */
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

  // What the save asks about first (ADR-0070). Resolved, so a banner the rail is not showing cannot
  // be raised in a dialog the admin has no way to reconcile with the page behind it.
  const blockingBanners = resolveBlockingBanners(banners);

  const leavePage = () => {
    // Blur first — see the match editor: react-aria's focus attribute survives a kept-alive tree.
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

  /** Every atom back to what is stored — both exits run it; see the match editor's reasoning. */
  const resetDraftToStored = () => {
    setPersonDraft({ vorname: spieler.vorname, nachname: spieler.nachname });
    setTeamId(storedMembership?.team_id ?? null);
    setNummer(storedMembership?.nummer ?? "");
    setPosition(storedMembership?.position ?? null);
    setStufe(storedMembership?.stufe ?? null);
    setIsNachgetragen(storedMembership?.is_nachgetragen ?? false);
    setIsCaptain(storedMembership?.is_captain ?? false);

    setFieldErrors({});
    personValidation.clearVerdicts();
    saisonValidation.clearVerdicts();
  };

  const discardAndLeave = () => {
    resetDraftToStored();
    setIsConfirmingDiscard(false);
    setHasLeftViaDiscard(true);
    leavePage();
  };

  /**
   * What both submit routes reach first: a draft carrying a warning or a danger is confirmed, and a
   * clean one saves straight through (ADR-0070). The write itself is unchanged either way, undo
   * included.
   */
  const requestSave = () => {
    if (blockingBanners.length > 0) {
      setIsConfirmingSave(true);
      return;
    }
    handleFormSubmit();
  };

  const handleFormSubmit = () => {
    startTransition(async () => {
      const collectedErrors: FieldErrors = {};
      // Only what the admin cannot see from the form itself earns a sentence: the transfer, because
      // it moves the player out of one public squad list and into another. An untouched half
      // contributes nothing to the toast.
      const transferTouched = isChanged("team_id");
      const consequenceNotes: string[] = [];
      const savedParts: string[] = [];
      const failedNotes: string[] = [];

      // Person half first: it cannot depend on the squad half.
      if (personDirty) {
        const res = await patchSpielerAction(buildPersonPayload());
        if (res.success) {
          savedParts.push("Name gespeichert.");
        } else {
          Object.assign(collectedErrors, res.fieldErrors ?? {});
          failedNotes.push(res.error ?? "Die Personendaten konnten nicht gespeichert werden.");
        }
      }

      if (saisonDirty) {
        const res = await patchSaisonSpielerAction(buildSaisonPayload());
        if (res.success) {
          savedParts.push("Kadereintrag gespeichert.");
          if (transferTouched) consequenceNotes.push("Der Spieler steht ab sofort im neuen Team.");
        } else {
          Object.assign(collectedErrors, res.fieldErrors ?? {});
          failedNotes.push(res.error ?? "Der Kadereintrag konnte nicht gespeichert werden.");
        }
      }

      if (failedNotes.length > 0) {
        setFieldErrors(collectedErrors);
        // ALWAYS toasted, field errors or not: the toast is what survives when a half that SUCCEEDED
        // revalidates the route and remounts this form. An inline message alone would be gone before
        // it was read.
        appToast.danger(savedParts.length > 0 ? "Nur teilweise gespeichert" : "Speichern fehlgeschlagen", {
          description: [...savedParts, ...failedNotes].join(" "),
        });
        return;
      }

      setFieldErrors({});
      personValidation.clearVerdicts();
      saisonValidation.clearVerdicts();
      setHasSaved(true);

      // The halves the save wrote, holding their pre-save values — `spieler` and `storedMembership`
      // are this render's props, so they still carry what was stored before the write. Built BEFORE
      // leaving, because the toast outlives the page (ADR-0041, ADR-0049).
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

      // AFTER the undo payloads are built, which read the props rather than these atoms — see the
      // match editor: leaving with typed values still in state is what let a save-then-undo reopen
      // on values the player no longer holds.
      resetDraftToStored();
      leavePage();
    });
  };

  /**
   * The undo toast: fifteen seconds to take the save back (ADR-0041's window over ADR-0049's
   * transport). The pitfalls the match editor documents all apply and are all mirrored here: the
   * toast outlives this component, so the press runs in a detached closure — `router.refresh()` is
   * what re-renders a screen the action's own revalidation can no longer reach (the router instance
   * is a stable singleton, legal after unmount); the replay uses the TWO-ARGUMENT `then`, so a
   * failure downstream of a committed restore is never blamed on the transport; and the pending
   * spinner is `appToast.pending`, closed by its own key, because a toast without an explicit
   * timeout inherits a four-second default that would retire it mid-flight.
   *
   * Always a success rather than a warning, unlike the club editor's: this save destroys nothing
   * without another copy. Every field it writes is a short value the admin can retype, and both
   * retirements on this surface are soft and reversible by their own endpoints (ADR-0025).
   */
  const offerUndo = (payloads: SpielerUndoPayloads, message?: string) => {
    appToast.success("Änderung gespeichert", {
      description: message ?? "Die Spielerdaten wurden aktualisiert.",
      // A decision window, not a reading time — the one case where the text's length does not
      // govern the toast's duration.
      timeout: UNDO_TIMEOUT_MS,
      actionProps: {
        children: "Rückgängig",
        onPress: () => {
          appToast.clear();
          const pendingKey = appToast.pending("Änderung wird zurückgenommen...");

          void postSpielerUndo(payloads).then(
            (result) => {
              appToast.close(pendingKey);
              if (!result.success) {
                appToast.danger("Rücknahme fehlgeschlagen", { description: result.error ?? "Die Änderung steht weiterhin." });
                return;
              }

              // Reported BEFORE the refresh: the restore is committed and nothing below changes that.
              appToast.success("Änderung zurückgenommen", { description: result.message });

              // Best-effort, never allowed to fail the undo — a refresh that cannot run costs a
              // stale screen until the next navigation, not the restore.
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
    <SpielerDraftStatusProvider status={status}>
      {/* The match editor's shell: the inner container scrolls the page and the action bar is its
          STATIC sibling below, where nothing can move it. */}
      <Form
        ref={formRef}
        validationErrors={fieldErrors}
        className="flex min-h-0 w-full flex-1 flex-col"
        onSubmit={runOnSubmit(requestSave)}>
        <div className="min-h-0 w-full flex-1 scrollbar-gutter-stable overflow-y-auto px-4 pt-6 pb-10 sm:px-8">
          <div className="max-w-page mx-auto flex w-full flex-col">
            {pageHeader}

            <div className="grid w-full grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:gap-8">
              <div className="w-full xl:sticky xl:top-6 xl:col-start-2 xl:row-start-1 xl:self-start">
                <SpielerRail banners={banners} />
              </div>

              <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 xl:col-start-1 xl:row-start-1 xl:mx-0 xl:max-w-none">
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

                {/* Last on the page and in the danger tone, beside the season it belongs to — the
                    club editor's Disqualifikation panel in the same position (decided 2026-08-07).
                    Only where a row exists: there is nothing to take out of a squad the player is
                    not in, and the Kader panel above offers the entry instead. */}
                {storedMembership !== null && (
                  <FormAustragenSection
                    spielerId={spieler.id}
                    saisonId={saison.saisonId}
                    rowInactiveSince={storedMembership.inactive_since}
                    banners={banners}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        <SpielerActionBar
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

      {/* Closed rather than unmounted on confirm, unlike the discard dialog: the write is awaited
          before anything navigates, so the exit animation has run long before the tree is left. */}
      <ConfirmSaveModal
        isOpen={isConfirmingSave}
        onClose={() => setIsConfirmingSave(false)}
        onConfirm={() => {
          setIsConfirmingSave(false);
          handleFormSubmit();
        }}
        banners={blockingBanners}
      />
    </SpielerDraftStatusProvider>
  );
}
