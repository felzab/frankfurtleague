"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { parseDate } from "@internationalized/date";

import { Form } from "@heroui/react";

import { patchSaisonTeamAction, patchTeamAction } from "@/features/teams/actions";
import { FLPatchSaisonTeamPayloadSchema, FLPatchTeamPayloadSchema } from "@/features/teams/schemas";
import { deriveTeamDraftStatus } from "@/features/teams/teamDraftStatus";
import { ConfirmDiscardModal } from "@/shared/components/ui/ConfirmDiscardModal";
import { useDraftValidation } from "@/shared/hooks/useDraftValidation";
import { useServerFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import { FormAdresseSection } from "./FormAdresseSection";
import { FormDisqualifikationSection } from "./FormDisqualifikationSection";
import { FormSaisonSection } from "./FormSaisonSection";
import { FormVereinSection } from "./FormVereinSection";
import { TeamActionBar } from "./TeamActionBar";
import { TeamDraftStatusProvider } from "./TeamDraftStatusContext";
import { TeamRail } from "./TeamRail";

import type { FLGruppenNames, FLPostTeamPayload, FLTeam } from "@/features/teams/schemas";
import type { FLTeamDraftFields } from "@/features/teams/teamDraftStatus";
import type { TeamSaisonMembership } from "@/features/teams/types";
import type { FieldErrors } from "@/shared/utils/validation";
import type { CalendarDate } from "@internationalized/date";
import type { ReactNode } from "react";
import type { TeamRailBanner } from "./TeamRail";

/** The save toast's fan-out line — the half of `PATCH /teams/{team_id}` that fails silently. */
function describeFanOut(count: number): string {
  if (count === 0) return "Kein Spiel trägt eine Kopie von Name und Kürzel — nichts nachzuziehen.";
  if (count === 1) return "Name und Kürzel wurden in 1 Spiel nachgezogen.";
  return `Name und Kürzel wurden in ${count} Spielen nachgezogen.`;
}

/**
 * The club editor's form: four panels, a sticky summary rail, and one derivation behind both — the
 * match editor's shape (ADR-0050) over a club (owner, 2026-08-07: "a more minimal version of the
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
  registerRequestLeave,
  pageHeader,
}: {
  team: FLTeam;
  /** The selected season's context and membership — the sidemenu selector's season, resolved by the page. */
  saison: TeamSaisonMembership;
  today: string;
  /** The page's answer to "may the group move": season not `future` and fixtures exist (owner's rule). */
  gruppeLocked: boolean;
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
  const [hasLeftViaDiscard, setHasLeftViaDiscard] = useState(false);

  const {
    fieldErrors: serverFieldErrors,
    setFieldErrors,
    formRef,
  } = useServerFieldErrors(() =>
    appToast.danger("Speichern fehlgeschlagen", {
      description: "Der Server hat eine Angabe beanstandet, die dieses Formular nicht anzeigt. Bitte lade die Seite neu.",
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
    canSubmitRef.current = !isPending && !isConfirmingDiscard && isDirty;
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

  /** The rail's mirror of every warning shown inline somewhere on the page. */
  const banners: TeamRailBanner[] = [];

  if (team.inactive_since !== null) {
    banners.push({
      severity: "info",
      title: "Dieser Verein ist stillgelegt",
      body: "Er erscheint in keiner Auswahlliste; sein Kürzel bleibt reserviert. Reaktivieren über den Kopf der Seite.",
    });
  }
  if (storedMembership === null) {
    banners.push({
      severity: "info",
      title: `Nicht in Saison ${saison.saisonId}`,
      body: "Ohne Aufnahme erscheint die Mannschaft in dieser Saison auf keiner Seite.",
    });
  }
  if (isDisqualified && storedMembership?.disqualifikation == null) {
    banners.push({
      severity: "danger",
      title: "Der Grund wird veröffentlicht",
      body: "Er erscheint als eingegebener Text auf der Teamseite und an jedem Spiel der Mannschaft — sobald Du speicherst.",
    });
  }
  if (!isDisqualified && storedMembership?.disqualifikation != null) {
    banners.push({
      severity: "warning",
      title: "Aufheben entfernt den Eintrag ersatzlos",
      body: "Der gespeicherte Grund und das Datum sind danach nicht wiederherstellbar.",
    });
  }
  if (isDisqualified && storedMembership?.disqualifikation != null) {
    banners.push({
      severity: "info",
      title: `Disqualifiziert seit ${formatSpielDatum(storedMembership.disqualifikation.datum)}`,
      body: storedMembership.disqualifikation.grund,
    });
  }
  if (!gruppeLocked && isChanged("gruppe")) {
    banners.push({
      severity: "warning",
      title: "Gruppenwechsel wirkt weit",
      body: "Die Gruppe entscheidet, in welcher Tabelle die Mannschaft steht und welche Setzung sie speist.",
    });
  }

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

  const handleFormSubmit = () => {
    startTransition(async () => {
      const collectedErrors: FieldErrors = {};
      const savedNotes: string[] = [];
      const failedNotes: string[] = [];

      // Club half first: it cannot depend on the season half, and its fan-out note belongs first in
      // the toast.
      if (clubDirty) {
        const res = await patchTeamAction(buildClubPayload());
        if (res.success) {
          savedNotes.push(`Stammdaten gespeichert. ${describeFanOut(res.fanned_out_to_spiele ?? 0)}`);
        } else {
          Object.assign(collectedErrors, res.fieldErrors ?? {});
          failedNotes.push(res.fieldErrors?.shorthand ?? res.error ?? "Die Vereinsdaten konnten nicht gespeichert werden.");
        }
      }

      if (saisonDirty) {
        const res = await patchSaisonTeamAction(buildSaisonPayload());
        if (res.success) {
          savedNotes.push(
            res.saison_team?.disqualifikation != null
              ? "Saison gespeichert. Die Disqualifikation ist sofort überall sichtbar."
              : "Saison gespeichert.",
          );
        } else {
          Object.assign(collectedErrors, res.fieldErrors ?? {});
          failedNotes.push(res.error ?? "Die Saison-Zugehörigkeit konnte nicht gespeichert werden.");
        }
      }

      if (failedNotes.length > 0) {
        setFieldErrors(collectedErrors);
        // ALWAYS toasted, field errors or not (owner, 2026-08-07, for the shorthand conflict): the
        // toast is what survives when a half that SUCCEEDED revalidates the route and remounts this
        // form — an inline message alone would be gone before it was read.
        appToast.danger(savedNotes.length > 0 ? "Nur teilweise gespeichert" : "Speichern fehlgeschlagen", {
          description: [...savedNotes, ...failedNotes].join(" "),
        });
        return;
      }

      setFieldErrors({});
      clubValidation.clearVerdicts();
      saisonValidation.clearVerdicts();
      setHasSaved(true);

      appToast.success("Verein gespeichert", { description: savedNotes.join(" ") });
      resetDraftToStored();
      leavePage();
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
        action={() => handleFormSubmit()}>
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
                  gruppeLock={{
                    locked: gruppeLocked,
                    reason:
                      "Gesperrt: Die Saison läuft bereits und die Mannschaft hat angesetzte Spiele. Ein Gruppenwechsel wäre nur als Tausch zweier Mannschaften vertretbar.",
                    draftChangesGruppe: isChanged("gruppe"),
                  }}
                  isMember={storedMembership !== null}
                  gruppe={gruppe}
                  onGruppeChange={setGruppe}
                  onValidateSelection={validateGruppeSelection}
                  teamId={team.id}
                />

                {storedMembership !== null && (
                  <FormDisqualifikationSection
                    isDisqualified={isDisqualified}
                    onIsDisqualifiedChange={(next) => {
                      setIsDisqualified(next);
                      // Seeded with today — the common case for "took effect"; the lift stays a
                      // draft state until the save sends the explicit null (ADR-0059).
                      if (next && datum === null) setDatum(parseDate(today));
                    }}
                    storedRecord={storedMembership.disqualifikation}
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
    </TeamDraftStatusProvider>
  );
}
