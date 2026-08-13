"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { parseDate, parseTime } from "@internationalized/date";

import { Form } from "@heroui/react";

import { ConfirmDiscardModal } from "@/shared/components/ui/ConfirmDiscardModal";
import { ConfirmSaveModal } from "@/shared/components/ui/ConfirmSaveModal";
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { resolveBlockingBanners } from "@/shared/components/ui/railBanner";
import { useDraftValidation } from "@/shared/hooks/useDraftValidation";
import { hasFieldErrors, useServerFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";
import { appToast } from "@/shared/utils/appToast";

import { patchAdminSpielDataAction } from "../../../actions";
import { applyDraftToSpiel, deriveSpielDraftStatus } from "../../../draftStatus";
import { FLPatchSpielDataPayloadSchema } from "../../../schemas";
import { buildUndoPayloads, collectKnockoutTeamIds, collectSpieltagTeamOccupancy, listDependentSpiele } from "../../../utils";
import { buildSpielBanners } from "./banners";
import { DraftRail } from "./DraftRail";
import { DraftStatusProvider } from "./DraftStatusContext";
import { FormActionBar } from "./FormActionBar";
import { FormAnsetzungSection } from "./FormAnsetzungSection";
import { FormCancelSection } from "./FormCancelSection";
import { FormErgebnisSection } from "./FormErgebnisSection";
import { FormMatchupSection } from "./FormMatchupSection";
import { FormNotizSection } from "./FormNotizSection";
import { useVoidPreview } from "./useVoidPreview";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";
import type { FLSpielDraftFields } from "@/features/spiele/draftStatus";
import type {
  FLPatchSpielDataPayload,
  FLSpiel,
  FLSpielElfmeterschiessenDraft,
  FLSpielOrtFieldDraft,
  FLSpielQuelle,
  FLSpielSchiedsrichterFieldDraft,
  FLSpielTeamField,
  FLSpielWithStoredSides,
} from "@/features/spiele/schemas";
import type { ActionRequiredCategory } from "@/features/spiele/types";
import type { FLSpielort } from "@/features/spielorte/schemas";
import type { FLGruppenNames, FLTeam } from "@/features/teams/schemas";
import type { FieldErrors } from "@/shared/utils/validation";
import type { CalendarDate, Time } from "@internationalized/date";
import type { ReactNode } from "react";

/**
 * How long the undo offer stands after a save that destroyed something (ADR-0041).
 *
 * Long enough to read the sentence naming what went and decide; short enough that the offer is gone
 * before the page's copy of the season is stale enough for the replay to be refused.
 */
const UNDO_TIMEOUT_MS = 15000;

/**
 * Sends the undo, and it is a `fetch` rather than a server action for one reason (ADR-0049).
 *
 * By the time the offer is pressed this component is unmounted and the browser is on another route,
 * and a server action dispatched from there makes Next re-render the editor segment it still holds in
 * the router tree — which raises Next's E592 invariant mid-stream and truncates the response to two
 * bytes, so no result could be read and the write never happened. A route handler renders no page
 * tree, so the invariant has nothing to fire on. **Revert this to the server action once E592 is
 * fixed upstream**; the ADR names that as the condition.
 *
 * Nothing about the undo's design changes — same payloads, same order, same reported outcome. Only
 * the transport does, so the caller's two branches below are unchanged.
 */
async function postSpielUndo(
  payloads: FLPatchSpielDataPayload[],
  saisonId: string,
): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch("/api/admin/spiele/undo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The route answers 200 with the outcome in the body for every reportable case, so a non-2xx here
    // is a genuine transport or infrastructure failure and belongs in the rejection branch.
    body: JSON.stringify({ payloads, saison_id: saisonId }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}`);
  }

  return response.json() as Promise<{ success: boolean; message?: string; error?: string }>;
}

/**
 * The match editor's form: four panels, a sticky summary rail, and one derivation behind both.
 *
 * The lookup lists arrive as props rather than from `useAdmin()`. They are only ever available on
 * admin routes, but reading the context here would make `spiele` depend on `admin` — the exact
 * direction the write path was moved out of `admin` to avoid (ADR-0004). The aggregator supplies them
 * instead, which is what an aggregator slice is for.
 *
 * **Every field is controlled, date and time included.** The draft has to be complete between
 * keystrokes, because that is what the schema is asked about when a field is left and what the rail's
 * preview and change list read — and a React 19 form `action` resets uncontrolled inputs once it
 * resolves, which on a page the admin stays on would silently blank the two fields that used
 * `defaultValue`.
 *
 * **One column of panels, and a second track holding one sticky card.** That is how the ragged bottom
 * is fixed rather than balanced: a form of stacked panels and a column of unequal height can only end
 * level by accident, and a sticky element never reaches the bottom to be uneven against. `xl` rather
 * than `lg` because the admin sidemenu is 310px wide, so a 1024px viewport leaves about 650px of
 * content — which is exactly why the previous two-column split read as cramped.
 */
export function AdminEditSpielDataForm({
  spielData,
  teams,
  spielorte,
  schiedsrichter,
  saisonSpiele,
  today,
  categorize,
  registerRequestLeave,
  pageHeader,
}: {
  spielData: FLSpiel;
  teams: FLTeam[];
  spielorte: FLSpielort[];
  schiedsrichter: FLSchiedsrichter[];
  saisonSpiele: FLSpiel[];
  today: string;
  /**
   * Hands the caller the form's own "leave, asking first" routine, so an exit control rendered ABOVE
   * this form — the view's Zurück pill — routes through the discard guard exactly as Abbrechen does.
   * Without it the pill called `router.back()` directly, and the one control whose reason to exist is
   * being guarded (see the settled note on the header pill) was the one exit that skipped the guard.
   * A register-callback rather than a context, because exactly one caller exists and it sits one
   * level up; re-registered every render so the latest closure is always the one invoked.
   */
  registerRequestLeave?: (requestLeave: () => void) => void;
  /**
   * The view's back pill and page header, rendered INSIDE the form's scroll container so they
   * scroll with the content while the action bar below stays put — the shell needs the whole
   * scrollable page under one roof, and the header's content is still the view's business.
   */
  pageHeader?: ReactNode;
  /**
   * Which action-required categories a fixture falls into, supplied by the aggregator view.
   *
   * **A function rather than a computed set, because the answer has to be live.** The admin toggles
   * Absage and the four "fehlt" categories stop applying at once — `categorizeActionRequired` reports a
   * cancelled fixture as cancelled and nothing else — so "Offene Angaben" has to be recomputed from the
   * draft rather than frozen at load. The rule itself stays in `admin`, which is what keeps `spiele`
   * from importing the aggregator to ask a question about a Spiel.
   */
  categorize: (spiel: FLSpielWithStoredSides) => ReadonlySet<ActionRequiredCategory>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [spielIsCanceled, setSpielIsCanceled] = useState<boolean>(spielData.is_canceled);
  const [ortPayload, setOrtPayload] = useState<FLSpielOrtFieldDraft | null>(spielData.ort);
  const [schiedsrichterPayload, setSchiedsrichterPayload] = useState<FLSpielSchiedsrichterFieldDraft | null>(spielData.schiedsrichter);

  // Held as the calendar types the pickers speak, converted at the payload boundary below. A `null`
  // is a fixture whose date or kick-off is unset -- a legitimate state, not a field to nag about.
  const [datum, setDatum] = useState<CalendarDate | null>(spielData.datum ? parseDate(spielData.datum) : null);
  const [uhrzeit, setUhrzeit] = useState<Time | null>(spielData.uhrzeit ? parseTime(spielData.uhrzeit) : null);

  const [team1Payload, setTeam1Payload] = useState<FLSpielTeamField | null>(spielData.team1);
  const [team2Payload, setTeam2Payload] = useState<FLSpielTeamField | null>(spielData.team2);

  // Held beside the team rather than inside it: provenance survives the slot being filled, so the two
  // move independently (ADR-0034).
  const [team1Quelle, setTeam1Quelle] = useState<FLSpielQuelle | null>(spielData.team1_quelle);
  const [team2Quelle, setTeam2Quelle] = useState<FLSpielQuelle | null>(spielData.team2_quelle);

  // A draft, so an emptied count is `null` rather than `0` — a side genuinely can miss every kick, so
  // the two must not be the same value (ADR-0036).
  const [elfmeterschiessen, setElfmeterschiessen] = useState<FLSpielElfmeterschiessenDraft | null>(spielData.elfmeterschiessen);

  const [notiz, setNotiz] = useState<string | null>(spielData.notiz);

  // ALWAYS closed on open: the
  // deliberate flip is the guard, on every fixture alike, so a stray keystroke can neither invent a
  // 0:0 nor silently rewrite a recorded result.
  const [ergebnisCanBeEdited, setErgebnisCanBeEdited] = useState(false);

  // Latched on a successful save so the guard below does not challenge the navigation the save itself
  // performs — at that moment the draft still differs from the `spielData` this render was given.
  const [hasSaved, setHasSaved] = useState(false);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [isConfirmingSave, setIsConfirmingSave] = useState(false);

  // Latched by a confirmed discard, and it UNMOUNTS the dialog rather than closing it: closing
  // animates, and `router.back()` in the same tick freezes that exit on a tree the App Router keeps.
  const [hasLeftViaDiscard, setHasLeftViaDiscard] = useState(false);

  // See the note in `EntityForm`: catches a rejection on a payload path that has no input.
  const {
    fieldErrors: serverFieldErrors,
    setFieldErrors,
    formRef,
  } = useServerFieldErrors(() =>
    appToast.danger("Speichern fehlgeschlagen", {
      description: "Der Server hat eine Angabe beanstandet, die dieses Formular nicht anzeigt. Lade die Seite neu.",
    }),
  );

  // The same schema `patchAdminSpielDataAction` parses, so a message shown here is the message the
  // server would have produced (ADR-0040).
  const { validatePaths, clearVerdicts, mergedWith } = useDraftValidation(FLPatchSpielDataPayloadSchema);

  const draft: FLSpielDraftFields = {
    datum: datum?.toString() ?? null,
    // `Time.toString()` is `HH:MM:SS`, which is what `CustomTimeStringSchema` and the backend both
    // require — the field carries no seconds segment, so the third pair is always `00`.
    uhrzeit: uhrzeit?.toString() ?? null,
    ort: ortPayload,
    schiedsrichter: schiedsrichterPayload,
    team1: team1Payload,
    team2: team2Payload,
    team1_quelle: team1Quelle,
    team2_quelle: team2Quelle,
    elfmeterschiessen,
    is_canceled: spielIsCanceled,
    notiz,
  };

  // An empty picker is a legitimate answer, and it is how a bracket slot the group phase has not
  // filled yet is recorded (ADR-0034) — so both sides submit as they stand, `null` included.
  const buildPayload = (): FLPatchSpielDataPayload => ({ ...draft, spiel_id: spielData.id }) as FLPatchSpielDataPayload;

  // The fixture as it will stand once saved. Built once and read by the preview, the categorisation
  // and the knockout-cancellation warning, so the three cannot disagree.
  const previewSpiel = applyDraftToSpiel(spielData, draft);

  const fieldErrors = mergedWith(serverFieldErrors);
  const status = deriveSpielDraftStatus({ stored: spielData, draft, expectedCategories: categorize(previewSpiel), fieldErrors });
  const isDirty = status.isDirty && !hasSaved;

  // Keeps the guard quiet during the save's own navigation, where the draft still
  // differs from this render's props. Left latched, a later edit on a restored tree
  // reads as not-dirty and passes both guards.
  if (hasSaved && !status.isDirty) setHasSaved(false);

  useUnsavedChangesWarning(isDirty);

  // Ctrl+S submits, intercepted so the browser's save-page dialog cannot open over a form.
  // `requestSubmit` rather than a handler call, and `isDirty` as the Speichern button carries it:
  // two routes to one submit must not answer differently.
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

  // The fixtures whose occupants this one's result decides (ADR-0041). Read off the STORED sides: what
  // is already wired is what a save resolves, and a group is a property of the clubs in the fixture
  // rather than of the fixture document (ADR-0021).
  const dependentSpiele = useMemo(() => {
    const gruppen = [spielData.team1, spielData.team2]
      .map((side) => teams.find((team) => team.id === side?.team_id)?.gruppe)
      .filter((gruppe): gruppe is FLGruppenNames => gruppe !== undefined);

    return listDependentSpiele(saisonSpiele, spielData, gruppen);
  }, [saisonSpiele, spielData, teams]);

  // Every team the bracket already fields -- the client's proxy for "qualified for the knockout
  // stage" (see `collectKnockoutTeamIds`). One derivation, so its readers cannot disagree.
  const knockoutTeamIds = useMemo(() => collectKnockoutTeamIds(saisonSpiele, spielData.id), [saisonSpiele, spielData.id]);

  // Which fixture of the same Spieltag already fields each team (ADR-0042). Held here rather than in
  // the matchup panel, because the save's refusal lands on the side this map disables.
  const spieltagOccupancy = useMemo(
    () => collectSpieltagTeamOccupancy(saisonSpiele, { id: spielData.id, spieltag_id: spielData.spieltag_id }),
    [saisonSpiele, spielData.id, spielData.spieltag_id],
  );

  /**
   * What saving right now would destroy, asked live and answered by the write path itself (ADR-0041).
   *
   * Keyed on the fields that can move a bracket occupant and on nothing else: a venue or a kick-off
   * time cannot void a result anywhere, so keying on the whole draft would be a request per keystroke
   * answering a question that has not changed.
   *
   * Disabled where there is nothing to preview — a fixture that feeds no other. `listDependentSpiele`
   * is the cheap client-side answer to "could this matter at all", and it is used as a gate rather
   * than as the warning it used to be: it names what *can* lose a result, and the preview names what
   * *would*.
   */
  const previewKey = JSON.stringify({
    team1: team1Payload,
    team2: team2Payload,
    team1_quelle: team1Quelle,
    team2_quelle: team2Quelle,
    elfmeterschiessen,
    is_canceled: spielIsCanceled,
  });
  const voidPreview = useVoidPreview({
    previewKey,
    buildPayload: () => buildPayload(),
    isEnabled: dependentSpiele.length > 0 || spieltagOccupancy.size > 0,
  });

  const isKnockout = spielData.saison_phase !== "gruppenphase";

  // A cancelled fixture with a DECIDED score is legal -- a Wertung is entered exactly like this and
  // the table counts it (ADR-0019) -- but it is also the shape a mistaken cancellation takes.
  const tore1 = team1Payload?.tore ?? null;
  const tore2 = team2Payload?.tore ?? null;
  const hasDecidedErgebnis = tore1 !== null && tore2 !== null && !Number.isNaN(tore1) && !Number.isNaN(tore2) && tore1 !== tore2;

  /**
   * Every Hinweis this draft raises — the rail's list and the panels' inline callouts alike.
   *
   * **The void and release entries name fixtures rather than possibilities** (ADR-0041). The preview
   * ran the actual resolution against this draft, so every number in them is a fixture whose stored
   * result this save deletes, not one that could lose it under some other edit — which is why a
   * `null` preview, meaning "no answer yet", contributes nothing rather than "nothing would be lost".
   */
  const banners = buildSpielBanners({
    isKnockout,
    sides: [
      { fieldName: "team1", label: "Team 1", quelle: team1Quelle, team: team1Payload },
      { fieldName: "team2", label: "Team 2", quelle: team2Quelle, team: team2Payload },
    ],
    knockoutTeamIds,
    isBeingCalledOff: spielIsCanceled && !spielData.is_canceled,
    isCanceled: spielIsCanceled,
    dependentSpielNummern: dependentSpiele.map((spiel) => spiel.spiel_nr),
    hasDecidedErgebnis,
    voidedSpielNummern: voidPreview?.voided ?? [],
    releasedSpielNummern: voidPreview?.released ?? [],
  });

  // What the save asks about first (ADR-0070). Resolved, so a banner the rail is not showing cannot
  // be raised in a dialog the admin has no way to reconcile with the page behind it.
  const blockingBanners = resolveBlockingBanners(banners);

  /**
   * Judges the named paths against the draft as it now stands. **For a control the user TYPES into,
   * fired when the field is left** — by then the value has committed to state and the current draft
   * is the draft.
   *
   * Both of these write only to the client-side verdicts, never to the server's map, and that
   * separation is load-bearing: `useServerFieldErrors` calls `reportValidity()` whenever its map
   * changes, which moves focus to the first rejected field. That is correct after a submit and wrong
   * on a blur — clearing a corrected field there would have thrown focus onto the next unfixed one
   * while somebody was tabbing past it. `mergedWith` retracts the stale server message at render.
   */
  const validateFields = (paths: readonly string[]) => validatePaths(buildPayload(), paths);

  /**
   * The same judgement for a control the user PICKS from, where the value arrives with the event.
   *
   * `selected` is not a convenience. A picker's handler calls `onXChange(next)` and then asks for
   * validation in the same tick, and React has not re-rendered — so `buildPayload()` alone returns
   * the draft holding the value the selection just REPLACED. That is why picking a feeder match
   * reported "Bitte wähle ein Spiel aus." and only cleared when you picked a second time: the first
   * pick was judged against the `NaN` that switching the source type had left behind.
   */
  const validateSelection = (paths: readonly string[], selected: Partial<FLPatchSpielDataPayload>) =>
    validatePaths({ ...buildPayload(), ...selected }, paths);

  /**
   * Where "leave" goes: back where there is a back, and the admin start page where there is none.
   *
   * `router.back()` on a cold deep link — a bookmark, a pasted URL, a fresh tab — is a silent no-op,
   * which would leave every exit on this page dead. `history.length` is the only signal the platform
   * offers (Next exposes no history introspection); a fresh tab is 1, so `> 1` is exactly "there is
   * somewhere to go back to".
   */
  const leavePage = () => {
    // Blur first, and it is correctness rather than tidiness: react-aria clears `data-focused` on a
    // blur, and navigating away with a field focused leaves it set on a tree the router keeps.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    if (window.history.length > 1) router.back();
    else router.push("/admin");
  };

  /** Leave, but ask first if there is anything to lose. Both routes out of this page — Abbrechen and
   * the view's Zurück pill — come through here. */
  const requestLeave = () => {
    if (isDirty) {
      setHasLeftViaDiscard(false);
      setIsConfirmingDiscard(true);
      return;
    }
    leavePage();
  };

  // Unconditional, so the registered closure never goes stale — the same pattern the guard hooks use
  // for their refs.
  useEffect(() => {
    registerRequestLeave?.(requestLeave);
  });

  /**
   * Puts every field back to what is stored.
   *
   * **Leaving the page is not enough, and assuming it was is what made the worst bug on this page.**
   * The App Router keeps a page's React tree alive for back and forward navigation, so an admin who
   * confirmed "Verwerfen" and then returned to the same fixture found the discarded draft still sitting
   * in the fields — the dialog had promised the work was gone and it was not. Resetting explicitly
   * means the promise holds whether the tree is rebuilt or restored.
   *
   * **Both exits run it, and the save is the one that used to be missed.** A preserved tree is matched
   * by its `key`, and the editor's key is the fixture's stored state (`spielStateKey`) — so a save
   * followed by an undo lands on the key the tree was FIRST mounted with, because the undo restores the
   * very values the page opened on. React reuses that tree, and whatever is still in these atoms is
   * what the admin sees: the values they typed, on a fixture that no longer holds them. Resetting here
   * is what makes the reused tree agree with the key that selected it.
   *
   * Every atom is listed rather than looped, and the list is the same one the `useState` calls above
   * declare: a field added there and forgotten here would silently survive both exits, which is exactly
   * the failure being fixed. `deriveSpielDraftStatus` is what would catch it — after this runs, nothing
   * may remain in `status.changed`.
   */
  const resetDraftToStored = () => {
    setSpielIsCanceled(spielData.is_canceled);
    setOrtPayload(spielData.ort);
    setSchiedsrichterPayload(spielData.schiedsrichter);
    setDatum(spielData.datum ? parseDate(spielData.datum) : null);
    setUhrzeit(spielData.uhrzeit ? parseTime(spielData.uhrzeit) : null);
    setTeam1Payload(spielData.team1);
    setTeam2Payload(spielData.team2);
    setTeam1Quelle(spielData.team1_quelle);
    setTeam2Quelle(spielData.team2_quelle);
    setElfmeterschiessen(spielData.elfmeterschiessen);
    setNotiz(spielData.notiz);
    setErgebnisCanBeEdited(false);

    setFieldErrors({});
    clearVerdicts();
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
      const res = await patchAdminSpielDataAction(buildPayload(), spielData.saison_id);

      if (!res.success) {
        // An occupant refusal names a rule and the FORM knows which side broke it -- the code is the
        // only channel a failure body has (ADR-0042). A field error rather than a toast, so the
        // message lands on the control the admin has to change.
        const occupantErrors = res.errorCode === undefined ? {} : placeOccupantRefusal(res.errorCode, res.error);
        const fieldErrorsFromServer = { ...(res.fieldErrors ?? {}), ...occupantErrors };
        setFieldErrors(fieldErrorsFromServer);

        // Only for failures no single field owns.
        if (!hasFieldErrors(fieldErrorsFromServer)) {
          appToast.danger("Speichern fehlgeschlagen", {
            description: res.error || res.message || "Die Spieldaten konnten nicht aktualisiert werden.",
          });
        }
        return;
      }

      setFieldErrors({});
      clearVerdicts();
      setHasSaved(true);

      // The fixtures this save rewrote, put back from state only the client holds (ADR-0041). Built
      // BEFORE leaving: these are this render's props and the toast outlives the page. Offered on
      // EVERY save -- "I did not mean to save that" is the commoner mistake.
      const affected = [...(res.voidedFixtures ?? []), ...(res.releasedFixtures ?? [])];
      offerUndo(buildUndoPayloads(spielData, saisonSpiele, affected), res.message, affected.length > 0);

      // AFTER the undo payloads are built, which read `spielData` rather than these atoms. See
      // `resetDraftToStored`: leaving typed values in state reopens a save-then-undo on stale ones.
      resetDraftToStored();
      leavePage();
    });
  };

  /**
   * The undo toast: fifteen seconds to take a save back (ADR-0041), offered on every save.
   *
   * **The confirmation before a save is the carve-out, not the rule** (ADR-0070). A dialog on every
   * save would interrupt the case that is usually harmless, and the thirty-first is read without
   * being seen; undo costs nothing until it is wanted and is the only offer that helps the admin who
   * was not paying attention. What earns the dialog is a draft that has already raised a warning or
   * a danger, and it never replaces the undo. Discarding is a different question again and keeps its
   * own dialog (`ConfirmDiscardModal`), because nothing was written for an undo to take back.
   *
   * `destroyedSomething` picks the grade rather than whether to appear. An ordinary save is a success
   * that happens to be reversible; a save that deleted a scoreline elsewhere is a warning that
   * happens to be reversible, and the two must not look alike at a glance.
   *
   * Fifteen seconds is long enough to read the sentence naming what went and decide, and short enough
   * that the offer is gone before the page is stale enough for the replay to be refused.
   *
   * **The toast outlives this component, and that is what the two lines below are about.** `leavePage()`
   * runs immediately after the offer is raised, so by the time anyone presses the button this form is
   * unmounted and the handler is a detached closure. Two things follow that a handler on a live page
   * would get for free:
   *
   * - **`updateTag` inside the action expires the cache but nothing re-renders.** The router applies an
   *   action's revalidation when the action is dispatched from the tree it belongs to; dispatched from
   *   a closure whose tree is gone, the write lands and the screen does not move — which is
   *   indistinguishable from a button that does nothing. `router.refresh()` is the missing half, and
   *   the router instance is a stable singleton, so calling it from here is legal after unmount.
   * - **A rejected promise has nowhere to surface.** `runAdminMutation` converts an API failure into a
   *   returned result, but a rejection before that — the action dispatch itself failing — would skip
   *   `.then` entirely and leave the press with no feedback at all. `.catch` is what stops "nothing
   *   happened" from ever being the honest description of a press.
   */
  const offerUndo = (payloads: FLPatchSpielDataPayload[], message?: string, destroyedSomething = false) => {
    const raise = destroyedSomething ? appToast.warning : appToast.success;

    raise("Änderung gespeichert", {
      description: message || "Die Spieldaten wurden erfolgreich aktualisiert.",
      // Stated rather than derived: this duration is a decision window, not a reading time. It is the
      // one case where the length of the sentence is not what governs how long the toast stands.
      timeout: UNDO_TIMEOUT_MS,
      actionProps: {
        children: "Rückgängig",
        onPress: () => {
          appToast.clear();

          // Stands until the replay answers, which `appToast.pending`'s `timeout: 0` is what buys --
          // HeroUI's own default would retire the spinner mid-flight. Closed by its key, never
          // `clear()`, which takes other toasts down with it.
          const pendingKey = appToast.pending("Änderung wird zurückgenommen...");

          // The TWO-ARGUMENT form, not a style choice: a trailing `.catch` also catches what the
          // SUCCESS handler throws, so a committed restore reports itself as "could not be sent".
          // A rejection handler passed here runs for the request alone.
          void postSpielUndo(payloads, spielData.saison_id).then(
            (result) => {
              appToast.close(pendingKey);
              if (!result.success) {
                appToast.danger("Rücknahme fehlgeschlagen", { description: result.error || "Die Änderung steht weiterhin." });
                return;
              }

              // Reported BEFORE the refresh, because at this point the restore is committed and
              // nothing below can change that.
              appToast.success("Änderung zurückgenommen", { description: result.message });

              // Best-effort, and never allowed to fail the undo. This closure's component is
              // unmounted, so this is what re-renders the view -- but a refresh that cannot run
              // costs a stale screen until the next navigation, never the restore.
              try {
                router.refresh();
              } catch (refreshError) {
                console.warn("Undo committed, refresh failed", refreshError);
              }
            },
            (dispatchError) => {
              appToast.close(pendingKey);
              console.warn("Undo dispatch failed", dispatchError);

              // **The raw error stays in the description, and this is the one place that does it**
              // (ADR-0043). The dispatch failed in the browser, so no server log holds the
              // diagnosis. A failure that REACHED the server stays generic.
              appToast.danger("Rücknahme konnte nicht gesendet werden", {
                description: dispatchError instanceof Error ? `${dispatchError.name}: ${dispatchError.message}` : String(dispatchError),
                // Stated rather than derived, and for a reason no formula covers: this string is the
                // only copy of the diagnosis, so the window has to be long enough to transcribe it,
                // not merely to read it.
                timeout: 15000,
              });
            },
          );
        },
      },
    });
  };

  /**
   * Which field an occupant refusal belongs to, decided from the payload this form just submitted.
   *
   * The backend answers one code per RULE, because "team1 is disqualified" and "team2 is disqualified"
   * are one failure mode and the code table's own rule is one code per mode (`docs/logging/error-codes.md`). The
   * side is the client's to work out, and it can: the predicates below are exactly the ones
   * `FormTeamPicker` already evaluates to disable a team and put a chip on it, over the same data.
   *
   * A side it cannot identify produces no entry, and the caller falls back to the toast — so a refusal
   * is never swallowed, even when this disagrees with the server about which team is at fault.
   */
  const placeOccupantRefusal = (errorCode: string, message?: string): FieldErrors => {
    const text = message ?? "Diese Mannschaft kann hier nicht aufgestellt werden.";

    const isAtFault = (side: FLSpielTeamField | null, stored: FLSpielTeamField | null): boolean => {
      // Every occupant rule applies only to a team the payload NEWLY fields, exactly as the backend's
      // does — without this the message would land on a side the admin did not touch.
      if (side === null || side.team_id === stored?.team_id) return false;

      const team = teams.find((candidate) => candidate.id === side.team_id);
      switch (errorCode) {
        case "REQ-ELIGIBILITY-001":
          return team !== undefined && team.disqualifikation !== null;
        case "REQ-ELIGIBILITY-002":
          return team === undefined;
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
      {/* The shell: the inner container scrolls the page — header, panels,
          rail — and the action bar is its STATIC sibling below, outside the scroll content, where
          nothing (overscroll bounce, the mobile URL bar, page-end spacing) can move it. `main`
          never scrolls on this route, because this form fills it exactly. */}
      <Form
        ref={formRef}
        validationErrors={fieldErrors}
        className="flex min-h-0 w-full flex-1 flex-col"
        onSubmit={runOnSubmit(requestSave)}>
        <div className="min-h-0 w-full flex-1 scrollbar-gutter-stable overflow-y-auto px-4 pt-6 pb-10 sm:px-8">
          <div className="max-w-page mx-auto flex w-full flex-col">
            {pageHeader}

            <div className="grid w-full grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:gap-8">
              {/* Explicit grid placement rather than `order-*`: the DOM order is the mobile reading order,
              and on a phone the rail's warnings and preview belong above the fields rather than below
              four panels of them. */}
              <div className="w-full xl:sticky xl:top-6 xl:col-start-2 xl:row-start-1 xl:self-start">
                <DraftRail
                  previewSpiel={previewSpiel}
                  today={today}
                  banners={banners}
                />
              </div>

              <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 xl:col-start-1 xl:row-start-1 xl:mx-0 xl:max-w-none">
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
                  elfmeterschiessen={elfmeterschiessen}
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

                <FormCancelSection
                  spielIsCanceled={spielIsCanceled}
                  onSpielIsCanceledChange={setSpielIsCanceled}
                  banners={banners}
                />
              </div>
            </div>
          </div>
        </div>

        <FormActionBar
          isPending={isPending}
          onCancel={requestLeave}
        />
      </Form>

      {/* Unmounted — not merely closed — once a discard has left the page; see `hasLeftViaDiscard`.
          The "Weiter bearbeiten" path stays mounted so it keeps its exit animation. */}
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
    </DraftStatusProvider>
  );
}
