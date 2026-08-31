"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { parseDate, parseTime } from "@internationalized/date";

import { Form } from "@heroui/react";

import { ConfirmDiscardModal } from "@/shared/components/ui/ConfirmDiscardModal";
import { ConfirmSaveModal } from "@/shared/components/ui/ConfirmSaveModal";
import { DraftStatusProvider } from "@/shared/components/ui/DraftStatusContext";
import { EditFormLayout } from "@/shared/components/ui/EditFormLayout";
import { FormActionBar } from "@/shared/components/ui/FormActionBar";
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { resolveBlockingBanners } from "@/shared/components/ui/railBanner";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { hasFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";
import { appToast } from "@/shared/utils/appToast";
import { offerUndo } from "@/shared/utils/undoDispatch";

import { patchAdminSpielDataAction, readAdminSpielBookingsAction } from "../../../actions";
import { admitsShootOut, applyDraftToSpiel, deriveSpielDraftStatus } from "../../../draftStatus";
import { FLPatchSpielDataPayloadSchema } from "../../../schemas";
import {
  buildUndoPayloads,
  collectKnockoutTeamIds,
  collectSpieltagTeamOccupancy,
  formatUndoScopeWarning,
  isFirstKnockoutRound,
  listDependentSpiele,
  listMovedSpiele,
  toStoredSide,
} from "../../../utils";
import { buildSpielBanners, isSpielRefusalBannerId, isSpielRefusalCode } from "./banners";
import { FormAnsetzungSection } from "./FormAnsetzungSection";
import { FormErgebnisSection } from "./FormErgebnisSection";
import { FormMatchupSection } from "./FormMatchupSection";
import { FormNotizSection } from "./FormNotizSection";
import { FormSonderereignisSection } from "./FormSonderereignisSection";
import { SpielExpectedProvider } from "./SpielExpectedContext";
import { SpielRail } from "./SpielRail";
import { useVoidPreview } from "./useVoidPreview";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";
import type { FLSpielDraftFields } from "@/features/spiele/draftStatus";
import type {
  FLPatchSpielDataPayload,
  FLPatchSpielDataPayloadDraft,
  FLSonderereignis,
  FLSpiel,
  FLSpielAdmin,
  FLSpielElfmeterschiessenDraft,
  FLSpielOrtFieldDraft,
  FLSpielQuelle,
  FLSpielSchiedsrichterFieldDraft,
  FLSpielTeamField,
  FLSpielWithDraftFields,
} from "@/features/spiele/schemas";
import type { ActionRequiredCategory } from "@/features/spiele/types";
import type { FLSpielort } from "@/features/spielorte/schemas";
import type { FLGruppenNames, FLTeam } from "@/features/teams/schemas";
import type { EditPageHeaderContent } from "@/shared/components/ui/EditPageHeader";
import type { BlockingBanners } from "@/shared/components/ui/railBanner";
import type { FieldErrors } from "@/shared/utils/validation";
import type { CalendarDate, Time } from "@internationalized/date";
import type { SpielRefusalCode } from "./banners";

/**
 * Long enough to transcribe the only copy of a diagnosis, not merely to read it. Deliberately not `UNDO_TIMEOUT_MS`: this stands over a
 * restore that never dispatched, so it must not follow the undo window wherever that is taken.
 */
const DIAGNOSIS_TIMEOUT_MS = 15000;

/**
 * Lookup lists arrive as props: `useAdmin()` here would make `spiele` depend on `admin`.
 *
 * **Every field is controlled** — a React 19 form `action` resets uncontrolled inputs once it
 * resolves, blanking them on a page the admin stays on.
 */
export function AdminEditSpielDataForm({
  spielData,
  teams,
  spielorte,
  schiedsrichter,
  saisonSpiele,
  today,
  categorize,
  pageHeader,
}: {
  spielData: FLSpielAdmin;
  teams: FLTeam[];
  spielorte: FLSpielort[];
  schiedsrichter: FLSchiedsrichter[];
  saisonSpiele: FLSpiel[];
  today: string;
  /** Rendered inside the scroll container, so it scrolls while the action bar stays put. */
  pageHeader: EditPageHeaderContent;
  /**
   * **A function, not a computed set, because the answer has to be live**: choosing a Sonderereignis
   * stops the "fehlt" categories applying at once. The rule stays in `admin`, keeping `spiele` from
   * importing the aggregator.
   */
  categorize: (spiel: FLSpielWithDraftFields) => ReadonlySet<ActionRequiredCategory>;
}) {
  const router = useRouter();
  const saisonHref = useSaisonHref();
  const [isPending, startTransition] = useTransition();
  const [isLeaving, startLeaving] = useTransition();

  const [sonderereignis, setSonderereignis] = useState<FLSonderereignis | null>(spielData.sonderereignis);
  // Held, never derived from the value: a scalar has no empty-but-present form, so a derived
  // disclosure would have to seed a member the moment it opened.
  const [hasSonderereignis, setHasSonderereignis] = useState(spielData.sonderereignis !== null);
  const [ortPayload, setOrtPayload] = useState<FLSpielOrtFieldDraft | null>(spielData.ort);
  const [schiedsrichterPayload, setSchiedsrichterPayload] = useState<FLSpielSchiedsrichterFieldDraft | null>(spielData.schiedsrichter);

  // `null` is an unset date or kick-off: a legitimate state, not a field to nag about.
  const [datum, setDatum] = useState<CalendarDate | null>(spielData.datum ? parseDate(spielData.datum) : null);
  const [uhrzeit, setUhrzeit] = useState<Time | null>(spielData.uhrzeit ? parseTime(spielData.uhrzeit) : null);

  // Narrowed, not seeded whole: a read's side carries the season's `austritt`, and a draft holding
  // it writes that join back into the match document.
  const [team1Payload, setTeam1Payload] = useState<FLSpielTeamField | null>(toStoredSide(spielData.team1));
  const [team2Payload, setTeam2Payload] = useState<FLSpielTeamField | null>(toStoredSide(spielData.team2));

  // Beside the team, not inside it: provenance survives the slot being filled, so the two move
  // independently.
  const [team1Quelle, setTeam1Quelle] = useState<FLSpielQuelle | null>(spielData.team1_quelle);
  const [team2Quelle, setTeam2Quelle] = useState<FLSpielQuelle | null>(spielData.team2_quelle);

  // A draft, so an emptied count is `null` and not `0`: a side genuinely can miss every kick.
  const [elfmeterschiessen, setElfmeterschiessen] = useState<FLSpielElfmeterschiessenDraft | null>(spielData.elfmeterschiessen);

  const [notiz, setNotiz] = useState<string | null>(spielData.notiz);

  // ALWAYS closed on open, every fixture alike: the deliberate flip is the guard, so a stray
  // keystroke can neither invent a 0:0 nor silently rewrite a recorded result.
  const [ergebnisCanBeEdited, setErgebnisCanBeEdited] = useState(false);

  // Latched on a successful save, so the guard below does not challenge the save's own navigation —
  // at that moment the draft still differs from the `spielData` this render was given.
  const [hasSaved, setHasSaved] = useState(false);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [confirmingBanners, setConfirmingBanners] = useState<BlockingBanners | null>(null);

  // Stored with the draft it answers, `useVoidPreview`'s rule: the remedies retire the moment an
  // input the refusal was judged on moves, so a corrected draft never carries the previous ones.
  const [refusal, setRefusal] = useState<{ key: string; code: SpielRefusalCode } | null>(null);

  const [hasLeftViaDiscard, setHasLeftViaDiscard] = useState(false);

  // The same schema `patchAdminSpielDataAction` parses, so a message shown here is the one the
  // server would have produced.
  const { fieldErrors, setSubmitFieldErrors, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { spiel: FLPatchSpielDataPayloadSchema },
  });

  // Derived rather than handled: `admitsShootOut` names every fixture a record belongs to, so every
  // route out of one drops it here, where no later handler can forget to.
  const elfmeterschiessenInDraft = admitsShootOut(spielData.saison_phase, team1Payload, team2Payload, sonderereignis)
    ? elfmeterschiessen
    : null;

  const draft: FLSpielDraftFields = {
    datum: datum?.toString() ?? null,
    // `Time.toString()` is `HH:MM:SS`, which is what `CustomTimeStringSchema` requires.
    uhrzeit: uhrzeit?.toString() ?? null,
    ort: ortPayload,
    schiedsrichter: schiedsrichterPayload,
    team1: team1Payload,
    team2: team2Payload,
    team1_quelle: team1Quelle,
    team2_quelle: team2Quelle,
    elfmeterschiessen: elfmeterschiessenInDraft,
    sonderereignis,
    notiz,
  };

  // Both sides submit as they stand, `null` included: an empty picker is how a bracket slot the
  // group phase has not filled yet is recorded.
  const buildPayload = (): FLPatchSpielDataPayloadDraft => ({ ...draft, spiel_id: spielData.id });

  // The fixture as it will stand once saved, built once so the preview, the categorisation and the
  // knockout-cancellation warning cannot disagree.
  const previewSpiel = applyDraftToSpiel(spielData, draft);

  const status = deriveSpielDraftStatus({ stored: spielData, draft, expectedCategories: categorize(previewSpiel), fieldErrors });
  const isDirty = status.isDirty && !hasSaved;

  // Unlatched as soon as the props catch up: left latched, a later edit on a restored tree would
  // read as not-dirty and pass both guards.
  if (hasSaved && !status.isDirty) setHasSaved(false);

  useUnsavedChangesWarning(isDirty);

  // Ctrl+S submits, intercepted so the browser's save-page dialog cannot open over the form.
  // `requestSubmit` and the button's own `isDirty`: two routes to one submit must agree.
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

  // Read off the STORED sides: what is already wired is what a save resolves. The groups come from
  // the clubs, a fixture document carrying none.
  const dependentSpiele = useMemo(() => {
    const gruppen = [spielData.team1, spielData.team2]
      .map((side) => teams.find((team) => team.id === side?.team_id)?.gruppe)
      .filter((gruppe): gruppe is FLGruppenNames => gruppe !== undefined);

    return listDependentSpiele(saisonSpiele, spielData, gruppen);
  }, [saisonSpiele, spielData, teams]);

  const knockoutTeamIds = useMemo(() => collectKnockoutTeamIds(saisonSpiele, spielData.id), [saisonSpiele, spielData.id]);

  // Held here rather than in the matchup panel, because the save's refusal lands on the side this
  // map disables.
  const spieltagOccupancy = useMemo(
    () => collectSpieltagTeamOccupancy(saisonSpiele, { id: spielData.id, spieltag_id: spielData.spieltag_id }),
    [saisonSpiele, spielData.id, spielData.spieltag_id],
  );

  // Keyed on the fields that can move an occupant and nothing else: a venue voids no result, so
  // the whole draft would ask an unchanged question once per keystroke.
  const previewKey = JSON.stringify({
    team1: team1Payload,
    team2: team2Payload,
    team1_quelle: team1Quelle,
    team2_quelle: team2Quelle,
    elfmeterschiessen: elfmeterschiessenInDraft,
    sonderereignis,
  });
  const voidPreview = useVoidPreview({
    previewKey,
    buildPayload: () => buildPayload(),
    isEnabled: dependentSpiele.length > 0 || spieltagOccupancy.size > 0,
  });

  // `previewKey` plus the date, the one judged input it leaves out: `REQ-ELIGIBILITY-001` fires on a
  // re-dating with neither side touched.
  const refusalKey = `${previewKey}|${draft.datum ?? ""}`;

  const isKnockout = spielData.saison_phase !== "gruppenphase";

  const tore1 = team1Payload?.tore ?? null;
  const tore2 = team2Payload?.tore ?? null;

  // `REQ-STATE-002`'s own subject: the write path refuses on ANY goal count standing beside an event
  // that awards nothing, so a lone 0 in one box is already the refusal.
  const hasAnyTore = (tore1 !== null && !Number.isNaN(tore1)) || (tore2 !== null && !Number.isNaN(tore2));

  // An abandoned fixture with a decided score may legitimately keep it, or may be waiting for a
  // replay — the one combination on this page a rule cannot settle, hence the warning.
  const hasDecidedErgebnis = tore1 !== null && tore2 !== null && !Number.isNaN(tore1) && !Number.isNaN(tore2) && tore1 !== tore2;

  // Counts entered rather than a record merely switched on: an empty one is nothing to lose.
  const hasEnteredShootOut = elfmeterschiessen !== null && (elfmeterschiessen.team1 !== null || elfmeterschiessen.team2 !== null);

  // **The EVENT's doing, asked by giving the same condition no event**: an unlevelled score retracts
  // a record silently by design and the counts come back with the goals, so only this route — where
  // the save discards them — is worth announcing.
  const dropsShootOut =
    hasEnteredShootOut && elfmeterschiessenInDraft === null && admitsShootOut(spielData.saison_phase, team1Payload, team2Payload, null);

  // The void and release entries name fixtures the dry run actually voided, never possibilities —
  // so a `null` preview means "no answer yet" and contributes nothing, not "nothing would be lost".
  const banners = buildSpielBanners({
    isKnockout,
    // The same derivation `FormTeamPicker` closes the group choice on, so the closed row and the
    // banner explaining it cannot disagree.
    seedsFromTheGroups: isFirstKnockoutRound(saisonSpiele, spielData),
    sides: [
      // The stored pair rides along so the banners can tell a takeover made here from one inherited.
      {
        fieldName: "team1",
        label: "Team 1",
        quelle: team1Quelle,
        team: team1Payload,
        storedQuelle: spielData.team1_quelle,
        storedTeam: toStoredSide(spielData.team1),
      },
      {
        fieldName: "team2",
        label: "Team 2",
        quelle: team2Quelle,
        team: team2Payload,
        storedQuelle: spielData.team2_quelle,
        storedTeam: toStoredSide(spielData.team2),
      },
    ],
    knockoutTeamIds,
    // Any pick differing from the stored one, not only a first event: swapping Ausgefallen for
    // Annulliert changes what the fixture does as much as acquiring an event does, and the
    // announcement states what the CHOSEN member means.
    isNewlyChosen: sonderereignis !== spielData.sonderereignis,
    sonderereignis,
    dependentSpielNummern: dependentSpiele.map((spiel) => spiel.spiel_nr),
    hasAnyTore,
    hasDecidedErgebnis,
    dropsShootOut,
    voidedSpielNummern: voidPreview?.voided ?? [],
    releasedSpielNummern: voidPreview?.released ?? [],
    refusalCode: refusal?.key === refusalKey ? refusal.code : null,
  });

  /**
   * For a control the user TYPES into, on blur. Writes only the client-side verdicts: the submit's
   * map calls `reportValidity()`, which on a blur throws focus off the field being tabbed past.
   */
  // Forgiveness runs on every draft change and only ever RETRACTS: a corrected field clears without a blur.
  useForgiveFixed({ spiel: buildPayload() });

  const validateFields = (paths: readonly string[]) => validatePaths("spiel", buildPayload(), paths);

  /**
   * The same for a control the user PICKS from. `selected` is not a convenience: the handler
   * validates in the same tick as `onXChange(next)`, so `buildPayload()` alone still holds the
   * value the pick replaced.
   */
  const validateSelection = (paths: readonly string[], selected: Partial<FLPatchSpielDataPayload>) =>
    validatePaths("spiel", { ...buildPayload(), ...selected }, paths);

  /**
   * `router.back()` on a cold deep link is a silent no-op, which would leave every exit on this
   * page dead. `history.length` is the only signal the platform offers, and a fresh tab is 1.
   */
  const leavePage = () => {
    // Correctness, not tidiness: react-aria clears `data-focused` on blur, so leaving with a field
    // focused strands it set on a tree the router keeps.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    // Hover next, and the disabled flag is what ends it: `useHover` clears `data-hovered` when a
    // control turns disabled, and no `pointerleave` follows a click that leaves.
    startLeaving(() => {
      if (window.history.length > 1) router.back();
      else router.push(saisonHref("/admin"));
    });
  };

  /** Both routes out of this page — Abbrechen and the view's Zurück pill — come through here. */
  const requestLeave = () => {
    if (isDirty) {
      setHasLeftViaDiscard(false);
      setIsConfirmingDiscard(true);
      return;
    }
    leavePage();
  };

  /**
   * **Leaving the page is not enough**: the App Router keeps the tree alive, so a discard that only
   * navigated leaves the abandoned draft in the fields. `spielStateKey` puts a save-then-undo back
   * on the same key, so a save needs this too.
   */
  const resetDraftToStored = () => {
    // Every atom listed rather than looped: one added to the `useState` block above and forgotten
    // here leaves `status.changed` non-empty after both exits, silently.
    setSonderereignis(spielData.sonderereignis);
    setHasSonderereignis(spielData.sonderereignis !== null);
    setOrtPayload(spielData.ort);
    setSchiedsrichterPayload(spielData.schiedsrichter);
    setDatum(spielData.datum ? parseDate(spielData.datum) : null);
    setUhrzeit(spielData.uhrzeit ? parseTime(spielData.uhrzeit) : null);
    setTeam1Payload(toStoredSide(spielData.team1));
    setTeam2Payload(toStoredSide(spielData.team2));
    setTeam1Quelle(spielData.team1_quelle);
    setTeam2Quelle(spielData.team2_quelle);
    setElfmeterschiessen(spielData.elfmeterschiessen);
    setNotiz(spielData.notiz);
    setErgebnisCanBeEdited(false);

    setSubmitFieldErrors({}, {});
  };

  const discardAndLeave = () => {
    resetDraftToStored();
    setIsConfirmingDiscard(false);
    setHasLeftViaDiscard(true);
    leavePage();
  };

  const requestSave = () => {
    // Refusal banners are excluded: each names a save the endpoint refuses, where this gate confirms
    // what a save would cause. Left in, one turns the next Save into a dialog about a failure.
    const blocking = resolveBlockingBanners(banners.filter((banner) => !isSpielRefusalBannerId(banner.id)));
    if (blocking !== null) {
      // Snapshotted, not read live: a background revalidation would move the list under the dialog.
      setConfirmingBanners(blocking);
      return;
    }
    handleFormSubmit();
  };

  const handleFormSubmit = () => {
    // The one draft-to-wire conversion, reached by both submit routes: a still-empty field becomes
    // a message on its own path rather than a value cast onto a type forbidding it
    // (`docs/frontend/spec.md` I33).
    const payload = buildPayload();
    // The shared block, so this form refuses on the same terms as every other one. It records the DRAFT,
    // not the parsed value: a later blur hands `validatePaths` the draft, so the two compare path by path
    // with no parse standing between them.
    guardSubmit({ spiel: payload }, writeAfterBlock);
  };

  const writeAfterBlock = () => {
    const payload = buildPayload();
    // Never `safeParse` here — the block above has already proved it parses, and a second failure branch
    // would be one nothing can reach.
    const narrowed = FLPatchSpielDataPayloadSchema.parse(payload);

    startTransition(async () => {
      const res = await patchAdminSpielDataAction(narrowed, spielData.saison_id);

      if (!res.success) {
        // A field error rather than a toast, so the message lands on the control to change.
        const occupantErrors = res.errorCode === undefined ? {} : placeOccupantRefusal(res.errorCode, res.error);
        const fieldErrorsFromServer = { ...(res.fieldErrors ?? {}), ...occupantErrors };
        setSubmitFieldErrors(fieldErrorsFromServer, { spiel: payload });

        // The remedies the field's one sentence has no room for, keyed to the draft just judged.
        setRefusal(isSpielRefusalCode(res.errorCode) ? { key: refusalKey, code: res.errorCode } : null);

        // Only for failures no single field owns.
        if (!hasFieldErrors(fieldErrorsFromServer)) {
          appToast.danger("Speichern fehlgeschlagen", {
            description: res.error || res.message || "Versuche es erneut.",
          });
        }
        return;
      }

      setSubmitFieldErrors({}, {});
      setRefusal(null);
      setHasSaved(true);

      // Built BEFORE leaving: these are this render's props and the toast outlives the page.
      const affected = [...(res.voidedFixtures ?? []), ...(res.releasedFixtures ?? [])];
      const moved = listMovedSpiele(spielData, saisonSpiele, affected);

      // Only a save that moved something pays for this round trip: the season list is base-tier and
      // carries no money, so a moved fixture cannot be restored whole without reading its booking.
      const read = moved.length === 0 ? undefined : await readAdminSpielBookingsAction(moved.map((spiel) => spiel.id));
      const bookings = new Map((read?.bookings ?? []).map(({ id, ...booking }) => [id, booking]));

      // A read that FAILED leaves the same empty map a deleted fixture would, and the undo shrinks
      // to the edited fixture either way. Only the failure is worth saying out loud.
      const undoNote = read?.success === false ? formatUndoScopeWarning(moved) : "";
      const description = [res.message ?? "", undoNote].filter(Boolean).join(". ");

      offerUndo({
        endpoint: "/api/admin/spiele/undo",
        body: { payloads: buildUndoPayloads(spielData, moved, bookings), saison_id: spielData.saison_id },
        message: description || undefined,
        fallback: "Die Spieldaten wurden aktualisiert.",
        warn: affected.length > 0,
        router,
        // The raw error stays in the description, uniquely here: the dispatch failed in the browser,
        // so no server log holds the diagnosis. One that reached the server stays generic.
        reportRejection: (dispatchError) =>
          appToast.danger("Rücknahme konnte nicht gesendet werden", {
            description: dispatchError instanceof Error ? `${dispatchError.name}: ${dispatchError.message}` : String(dispatchError),
            timeout: DIAGNOSIS_TIMEOUT_MS,
          }),
      });

      // AFTER the undo payloads are built, which read `spielData` rather than these atoms.
      resetDraftToStored();
      leavePage();
    });
  };

  /**
   * The backend answers one code per RULE (`docs/logging/error-codes.md`), so the client works out
   * the side. A side it cannot identify produces no entry and the caller falls back to the toast,
   * so a refusal is never swallowed.
   */
  const placeOccupantRefusal = (errorCode: string, message?: string): FieldErrors => {
    const text = message ?? "Dieses Team kann hier nicht aufgestellt werden.";

    // Mirrors the skip in `fl_backend/app/api/spiele/services.py :: find_eligibility_refusal`: a side
    // is judged unless the payload leaves every input that rule reads as stored, so clearing the
    // carve-out is refused exactly as a re-dating is.
    const judgedInputMoved = draft.datum !== spielData.datum || draft.sonderereignis !== spielData.sonderereignis;

    const isAtFault = (side: FLSpielTeamField | null, stored: FLSpielTeamField | null): boolean => {
      if (side === null) return false;

      const stays = side.team_id === stored?.team_id;
      const team = teams.find((candidate) => candidate.id === side.team_id);

      // Each rule takes the write path's own trigger, never one shared "this side moved": two of the
      // three reach a side the admin never touched, and a shared guard marks nothing there — a
      // refusal with no field is a failed save with nothing to correct.
      switch (errorCode) {
        // ANY `austritt`, whichever way the club left: `pull_saison_membership` keys the refusal on
        // the record's `datum` alone, so a withdrawal refuses exactly as a disqualification does.
        case "REQ-ELIGIBILITY-001":
          return (!stays || judgedInputMoved) && team !== undefined && team.austritt !== null;
        // The one rule that IS about a newly fielded club alone: one already standing here without a
        // junction row is a fault corrected on this very fixture, and refusing every save would trap
        // that correction.
        case "REQ-ELIGIBILITY-002":
          return !stays && team === undefined;
        // Judged on whichever clubs the payload fields, moved or not: the bracket resolution can put
        // one club on two fixtures of a Spieltag with neither side touched here.
        case "REQ-SPIELTAG-001":
          return spieltagOccupancy.has(side.team_id) || side.team_id === (side === team1Payload ? team2Payload : team1Payload)?.team_id;
        default:
          return false;
      }
    };

    return {
      ...(isAtFault(team1Payload, spielData.team1) ? { "team1.team_id": text } : {}),
      ...(isAtFault(team2Payload, spielData.team2) ? { "team2.team_id": text } : {}),
    };
  };

  return (
    <DraftStatusProvider status={status}>
      {/* Only around the form: the markers and the open-items card are its readers, and neither
          dialog below asks what the fixture is still waiting on. */}
      <SpielExpectedProvider expected={status.expected}>
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
              <SpielRail
                previewSpiel={previewSpiel}
                today={today}
                banners={banners}
              />
            }>
            <FormAnsetzungSection
              datum={datum}
              onDatumChange={setDatum}
              uhrzeit={uhrzeit}
              onUhrzeitChange={setUhrzeit}
              spielorte={spielorte}
              ortPayload={ortPayload}
              onOrtChange={setOrtPayload}
              schiedsrichter={schiedsrichter}
              schiedsrichterPayload={schiedsrichterPayload}
              onSchiedsrichterChange={setSchiedsrichterPayload}
              onValidateFields={validateFields}
            />

            <FormMatchupSection
              spielData={spielData}
              saisonSpiele={saisonSpiele}
              teams={teams}
              knockoutTeamIds={knockoutTeamIds}
              spieltagOccupancy={spieltagOccupancy}
              team1Payload={team1Payload}
              onTeam1Change={setTeam1Payload}
              team2Payload={team2Payload}
              onTeam2Change={setTeam2Payload}
              team1Quelle={team1Quelle}
              onTeam1QuelleChange={setTeam1Quelle}
              team2Quelle={team2Quelle}
              onTeam2QuelleChange={setTeam2Quelle}
              onValidateSelection={validateSelection}
              banners={banners}
            />

            <FormErgebnisSection
              spielData={spielData}
              team1Payload={team1Payload}
              onTeam1Change={setTeam1Payload}
              team2Payload={team2Payload}
              onTeam2Change={setTeam2Payload}
              team1Quelle={team1Quelle}
              team2Quelle={team2Quelle}
              sonderereignis={sonderereignis}
              elfmeterschiessen={elfmeterschiessenInDraft}
              onElfmeterschiessenChange={setElfmeterschiessen}
              ergebnisCanBeEdited={ergebnisCanBeEdited}
              onErgebnisCanBeEditedChange={setErgebnisCanBeEdited}
              onValidateFields={validateFields}
            />

            <FormNotizSection
              notiz={notiz}
              onNotizChange={setNotiz}
              onValidateFields={validateFields}
            />

            <FormSonderereignisSection
              sonderereignis={sonderereignis}
              hasSonderereignis={hasSonderereignis}
              onHasSonderereignisChange={(next) => {
                setHasSonderereignis(next);
                // Closing it is the only way back to no event, so the value goes with it rather
                // than surviving out of sight and riding into the save.
                if (!next) setSonderereignis(null);
              }}
              // Read off the DRAFT, not the stored fixture: emptying a slot must close the two
              // no-show states in the same tick, or the form offers what the save then refuses.
              hasBothSides={team1Payload !== null && team2Payload !== null}
              onSonderereignisChange={setSonderereignis}
              banners={banners}
            />
          </EditFormLayout>

          <FormActionBar
            isPending={isPending}
            isLeaving={isLeaving}
            onCancel={requestLeave}
          />
        </Form>
      </SpielExpectedProvider>

      {/* Unmounted rather than closed once a discard has left: closing animates, and `router.back()`
          in the same tick freezes that exit on a tree the App Router keeps. */}
      {!hasLeftViaDiscard && (
        <ConfirmDiscardModal
          isOpen={isConfirmingDiscard}
          onClose={() => setIsConfirmingDiscard(false)}
          onDiscard={discardAndLeave}
          changeCount={status.changed.length}
        />
      )}

      {/* Closed rather than unmounted, unlike the discard dialog: the write is awaited before
          anything navigates, so the exit animation has run long before the tree is left. */}
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
