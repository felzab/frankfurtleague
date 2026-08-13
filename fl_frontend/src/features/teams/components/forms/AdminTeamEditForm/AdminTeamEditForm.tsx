"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { parseDate } from "@internationalized/date";

import { Form } from "@heroui/react";

import { patchSaisonTeamAction, patchTeamAction } from "@/features/teams/actions";
import { FLPatchSaisonTeamPayloadSchema, FLPatchTeamPayloadSchema } from "@/features/teams/schemas";
import { deriveTeamDraftStatus } from "@/features/teams/teamDraftStatus";
import { ConfirmDiscardModal } from "@/shared/components/ui/ConfirmDiscardModal";
import { ConfirmSaveModal } from "@/shared/components/ui/ConfirmSaveModal";
import { resolveRailBanners } from "@/shared/components/ui/railBanner";
import { useDraftValidation } from "@/shared/hooks/useDraftValidation";
import { useServerFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";
import { appToast } from "@/shared/utils/appToast";

import { buildTeamBanners } from "./banners";
import { FormAdresseSection } from "./FormAdresseSection";
import { FormDisqualifikationSection } from "./FormDisqualifikationSection";
import { FormSaisonSection } from "./FormSaisonSection";
import { FormVereinSection } from "./FormVereinSection";
import { TeamActionBar } from "./TeamActionBar";
import { TeamDraftStatusProvider } from "./TeamDraftStatusContext";
import { TeamRail } from "./TeamRail";

import type { SaisonGruppenSwapContext } from "@/features/saisons/types";
import type { FLGruppenNames, FLPatchSaisonTeamPayload, FLPatchTeamPayload, FLPostTeamPayload, FLTeamRecord } from "@/features/teams/schemas";
import type { FLTeamDraftFields } from "@/features/teams/teamDraftStatus";
import type { GruppeOffer, TeamSaisonMembership } from "@/features/teams/types";
import type { FieldErrors } from "@/shared/utils/validation";
import type { CalendarDate } from "@internationalized/date";
import type { ReactNode } from "react";

/**
 * How long the undo offer stands after a save (ADR-0041's window, ADR-0049's transport). It stands
 * on every save, confirmed or not: a confirmation is the carve-out for a draft carrying a warning
 * or a danger, and undo is what still helps the admin who was not paying attention (ADR-0070).
 */
const UNDO_TIMEOUT_MS = 15000;

/** What the undo replays: the halves the save actually wrote, holding their PRE-SAVE values. */
type TeamUndoPayloads = {
  club?: FLPatchTeamPayload;
  saison?: FLPatchSaisonTeamPayload;
};

/**
 * Sends the undo, and it is a `fetch` rather than a server action for one reason (ADR-0049): by the
 * time the offer is pressed this component is unmounted and the browser is on another route, and a
 * server action dispatched from there trips Next's E592 invariant and is truncated mid-response.
 * **Revert this to a server action once E592 is fixed upstream**; the ADR names that condition.
 */
async function postTeamUndo(payloads: TeamUndoPayloads): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch("/api/admin/teams/undo", {
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

/** The save toast's fan-out line — the half of `PATCH /teams/{team_id}` that fails silently. */
function describeFanOut(count: number): string {
  if (count === 0) return "Kein Spiel trägt eine Kopie von Name und Kürzel.";
  if (count === 1) return "Name und Kürzel wurden in 1 Spiel nachgezogen.";
  return `Name und Kürzel wurden in ${count} Spielen nachgezogen.`;
}

/**
 * The club editor's form: four panels, a sticky summary rail, and one derivation behind both — the
 * match editor's shape (ADR-0040) over a club (decided 2026-08-07: "a more minimal version of the
 * Spieldaten editor"). Every field is controlled, judged when it is left with the same schemas the
 * actions parse, and marked in place when its draft differs from what is stored.
 *
 * **One save bar over TWO endpoints.** The club fields are `PATCH /teams/{team_id}` and the season
 * fields are `PATCH /teams/{team_id}/saisons/{saison_id}`; the submit runs whichever halves are
 * dirty, in that order. A half that fails keeps the page here with its message on the field — and
 * because a half that SUCCEEDED revalidates the route, a partial failure is also named in a toast,
 * which outlives the remount the revalidation causes.
 */
export function AdminTeamEditForm({
  team,
  saison,
  today,
  gruppeLocked,
  gruppeOffer,
  swap,
  registerRequestLeave,
  pageHeader,
}: {
  team: FLTeamRecord;
  /** The selected season's context and membership — the sidemenu selector's season, resolved by the page. */
  saison: TeamSaisonMembership;
  today: string;
  /** The page's answer to "may the group move": season not `future` and fixtures exist (decided 2026-08-07). */
  gruppeLocked: boolean;
  /** The selected season's groups with their fill state, from `buildGruppeOffer`. */
  gruppeOffer: readonly GruppeOffer[];
  /** The selected season's swap state — the club editor's entry point into the swap (ADR-0071). */
  swap: SaisonGruppenSwapContext;
  registerRequestLeave?: (requestLeave: () => void) => void;
  pageHeader?: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const storedMembership = saison.membership;

  const [clubDraft, setClubDraft] = useState<FLPostTeamPayload>({
    name: team.name,
    shorthand: team.shorthand,
    full_name: team.full_name,
    website_url: team.website_url,
    description: team.description,
    address: team.address,
  });

  const [gruppe, setGruppe] = useState<FLGruppenNames | null>(storedMembership?.gruppe ?? null);
  const [isDisqualified, setIsDisqualified] = useState(storedMembership?.disqualifikation != null);
  const [grund, setGrund] = useState(storedMembership?.disqualifikation?.grund ?? "");
  const [datum, setDatum] = useState<CalendarDate | null>(() => {
    const storedDatum = storedMembership?.disqualifikation?.datum;
    return storedDatum ? parseDate(storedDatum) : null;
  });

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
  const clubValidation = useDraftValidation(FLPatchTeamPayloadSchema);
  const saisonValidation = useDraftValidation(FLPatchSaisonTeamPayloadSchema);

  // The record as the draft would save it. `""` for a cleared date is what the schema rejects with
  // its own German message, so a half-entered record is a field error rather than a silent skip.
  const draftDisqualifikation = isDisqualified ? { grund, datum: datum?.toString() ?? "" } : null;

  const buildClubPayload = () => ({ id: team.id, ...clubDraft });
  const buildSaisonPayload = () => ({
    team_id: team.id,
    saison_id: saison.saisonId,
    gruppe,
    disqualifikation: draftDisqualifikation,
  });

  const draftFields: FLTeamDraftFields = {
    ...clubDraft,
    membership: storedMembership === null ? null : { gruppe, disqualifikation: draftDisqualifikation },
  };
  const storedFields: FLTeamDraftFields = {
    name: team.name,
    shorthand: team.shorthand,
    full_name: team.full_name,
    website_url: team.website_url,
    description: team.description,
    address: team.address,
    membership: storedMembership,
  };

  const fieldErrors = saisonValidation.mergedWith(clubValidation.mergedWith(serverFieldErrors));
  const status = deriveTeamDraftStatus({ stored: storedFields, draft: draftFields, fieldErrors });
  const isDirty = status.isDirty && !hasSaved;

  // See the match editor: the latch's job ends the moment the revalidated club arrives and the two
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

  const validateClubFields = (paths: readonly string[]) => clubValidation.validatePaths(buildClubPayload(), paths);
  const validateSaisonFields = (paths: readonly string[]) => saisonValidation.validatePaths(buildSaisonPayload(), paths);
  // The picked-control variant — judged with the value that arrived in the event, because state has
  // not committed yet (see the match editor's `validateSelection`).
  const validateGruppeSelection = (paths: readonly string[], selected: { gruppe: FLGruppenNames }) =>
    saisonValidation.validatePaths({ ...buildSaisonPayload(), ...selected }, paths);

  const isChanged = (path: string) => status.byPath.get(path)?.isChanged ?? false;
  const clubDirty = status.changed.some((field) => field.group !== "Saison");
  const saisonDirty = storedMembership !== null && status.changed.some((field) => field.group === "Saison");

  /** Every Hinweis this draft raises — the rail's list and the panels' inline callouts alike. */
  const banners = buildTeamBanners({
    isRetired: team.inactive_since !== null,
    saisonId: saison.saisonId,
    saisonStatus: saison.saisonStatus,
    isMember: storedMembership !== null,
    storedDisqualifikation: storedMembership?.disqualifikation ?? null,
    isDisqualified,
    isGruppeLocked: gruppeLocked,
    isGruppeChanged: isChanged("gruppe"),
  });

  // What the save asks about first (ADR-0070). Resolved, so a banner the rail is not showing cannot
  // be raised in a dialog the admin has no way to reconcile with the page behind it.
  const blockingBanners = resolveRailBanners(banners).filter((banner) => banner.severity !== "info");

  const leavePage = () => {
    // Blur first — see the match editor: react-aria's focus attribute survives a kept-alive tree.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    if (window.history.length > 1) router.back();
    else router.push("/admin/teams");
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
    setClubDraft({
      name: team.name,
      shorthand: team.shorthand,
      full_name: team.full_name,
      website_url: team.website_url,
      description: team.description,
      address: team.address,
    });
    setGruppe(storedMembership?.gruppe ?? null);
    setIsDisqualified(storedMembership?.disqualifikation != null);
    setGrund(storedMembership?.disqualifikation?.grund ?? "");
    setDatum(storedMembership?.disqualifikation?.datum ? parseDate(storedMembership.disqualifikation.datum) : null);

    setFieldErrors({});
    clubValidation.clearVerdicts();
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
      // Only what the admin cannot see from the form itself earns a sentence (decided 2026-08-07):
      // the fan-out only when the name or Kürzel moved, the disqualification only when the record
      // changed.
      const renameTouched = isChanged("name") || isChanged("shorthand");
      const disqualifikationTouched = isChanged("disqualifikation");
      const consequenceNotes: string[] = [];
      const savedParts: string[] = [];
      const failedNotes: string[] = [];

      // Club half first: it cannot depend on the season half, and its fan-out note belongs first in
      // the toast.
      if (clubDirty) {
        const res = await patchTeamAction(buildClubPayload());
        if (res.success) {
          savedParts.push("Stammdaten gespeichert.");
          if (renameTouched) consequenceNotes.push(describeFanOut(res.fanned_out_to_spiele ?? 0));
        } else {
          Object.assign(collectedErrors, res.fieldErrors ?? {});
          failedNotes.push(res.fieldErrors?.shorthand ?? res.error ?? "Die Teamdaten konnten nicht gespeichert werden.");
        }
      }

      if (saisonDirty) {
        const res = await patchSaisonTeamAction(buildSaisonPayload());
        if (res.success) {
          savedParts.push("Saison gespeichert.");
          if (disqualifikationTouched) {
            consequenceNotes.push(
              res.saison_team?.disqualifikation != null
                ? "Die Disqualifikation ist sofort überall sichtbar."
                : "Die Disqualifikation ist aufgehoben.",
            );
          }
        } else {
          Object.assign(collectedErrors, res.fieldErrors ?? {});
          failedNotes.push(res.error ?? "Die Saison-Zugehörigkeit konnte nicht gespeichert werden.");
        }
      }

      if (failedNotes.length > 0) {
        setFieldErrors(collectedErrors);
        // ALWAYS toasted, field errors or not (decided 2026-08-07, for the shorthand conflict): the
        // toast is what survives when a half that SUCCEEDED revalidates the route and remounts this
        // form. An inline message alone would be gone before it was read.
        appToast.danger(savedParts.length > 0 ? "Nur teilweise gespeichert" : "Speichern fehlgeschlagen", {
          description: [...savedParts, ...failedNotes].join(" "),
        });
        return;
      }

      setFieldErrors({});
      clubValidation.clearVerdicts();
      saisonValidation.clearVerdicts();
      setHasSaved(true);

      // The halves the save wrote, holding their pre-save values — `team` and `storedMembership`
      // are this render's props, so they still carry what was stored before the write. Built BEFORE
      // leaving, because the toast outlives the page (ADR-0041, ADR-0049).
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
              },
            }
          : {}),
        ...(saisonDirty && storedMembership !== null
          ? {
              saison: {
                team_id: team.id,
                saison_id: saison.saisonId,
                gruppe: storedMembership.gruppe,
                disqualifikation: storedMembership.disqualifikation,
              },
            }
          : {}),
      };
      // A lifted disqualification is the one thing this save can destroy that nothing else holds a
      // copy of (ADR-0047), so that grade is a warning; an ordinary save is a success that happens
      // to be reversible.
      const destroyedSomething = disqualifikationTouched && draftDisqualifikation === null && storedMembership?.disqualifikation != null;
      offerUndo(undoPayloads, consequenceNotes.join(" ") || undefined, destroyedSomething);

      // AFTER the undo payloads are built, which read the props rather than these atoms — see the
      // match editor: leaving with typed values still in state is what let a save-then-undo reopen
      // on values the club no longer holds.
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
   * One deliberate difference from the match editor: a dispatch failure here reports generic German
   * plus a console line, not the raw error text — ADR-0043 reviewed and kept the raw detail for
   * exactly one call site, and this is not it.
   */
  const offerUndo = (payloads: TeamUndoPayloads, message?: string, destroyedSomething = false) => {
    const raise = destroyedSomething ? appToast.warning : appToast.success;

    raise("Änderung gespeichert", {
      description: message ?? "Die Teamdaten wurden aktualisiert.",
      // A decision window, not a reading time — the one case where the text's length does not
      // govern the toast's duration.
      timeout: UNDO_TIMEOUT_MS,
      actionProps: {
        children: "Rückgängig",
        onPress: () => {
          appToast.clear();
          const pendingKey = appToast.pending("Änderung wird zurückgenommen...");

          void postTeamUndo(payloads).then(
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
                description: "Die Änderung steht weiterhin. Prüfe die Verbindung und das Team.",
              });
            },
          );
        },
      },
    });
  };

  return (
    <TeamDraftStatusProvider status={status}>
      {/* The match editor's shell: the inner container scrolls the page and the action bar is its
          STATIC sibling below, where nothing can move it. */}
      <Form
        ref={formRef}
        validationErrors={fieldErrors}
        className="flex min-h-0 w-full flex-1 flex-col"
        action={() => requestSave()}>
        <div className="min-h-0 w-full flex-1 scrollbar-gutter-stable overflow-y-auto px-4 pt-6 pb-10 sm:px-8">
          <div className="max-w-page mx-auto flex w-full flex-col">
            {pageHeader}

            <div className="grid w-full grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:gap-8">
              <div className="w-full xl:sticky xl:top-6 xl:col-start-2 xl:row-start-1 xl:self-start">
                <TeamRail banners={banners} />
              </div>

              <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 xl:col-start-1 xl:row-start-1 xl:mx-0 xl:max-w-none">
                <FormVereinSection
                  draft={clubDraft}
                  onChange={setClubDraft}
                  onFieldLeft={validateClubFields}
                />

                <FormAdresseSection
                  address={clubDraft.address}
                  onChange={(nextAddress) => setClubDraft((current) => ({ ...current, address: nextAddress }))}
                  onFieldLeft={validateClubFields}
                />

                <FormSaisonSection
                  saison={{ saisonId: saison.saisonId, saisonStatus: saison.saisonStatus }}
                  gruppeOffer={gruppeOffer}
                  gruppeLock={{
                    locked: gruppeLocked,
                    // Names the operation AND routes to it: the swap control sits directly under this
                    // row, so "nur als Tausch" is an offer rather than a dead end (ADR-0071).
                    reason:
                      "Gesperrt: Die Saison läuft bereits und die Mannschaft hat angesetzte Spiele. Tausche die Gruppe unten mit einer zweiten Mannschaft.",
                    draftChangesGruppe: isChanged("gruppe"),
                  }}
                  isMember={storedMembership !== null}
                  gruppe={gruppe}
                  onGruppeChange={setGruppe}
                  onValidateSelection={validateGruppeSelection}
                  swap={swap}
                  teamId={team.id}
                  banners={banners}
                />

                {storedMembership !== null && (
                  <FormDisqualifikationSection
                    isDisqualified={isDisqualified}
                    onIsDisqualifiedChange={(next) => {
                      setIsDisqualified(next);
                      // Seeded with today — the common case for "took effect"; the lift stays a
                      // draft state until the save sends the explicit null (ADR-0047).
                      if (next && datum === null) setDatum(parseDate(today));
                    }}
                    banners={banners}
                    grund={grund}
                    onGrundChange={setGrund}
                    datum={datum}
                    onDatumChange={setDatum}
                    onValidateFields={validateSaisonFields}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        <TeamActionBar
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
    </TeamDraftStatusProvider>
  );
}
