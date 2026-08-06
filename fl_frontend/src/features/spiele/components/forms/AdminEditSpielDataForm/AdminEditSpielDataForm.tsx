"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { parseDate, parseTime } from "@internationalized/date";

import { Form, toast } from "@heroui/react";

import { ConfirmDiscardModal } from "@/shared/components/ui/ConfirmDiscardModal";
import { useDraftValidation } from "@/shared/hooks/useDraftValidation";
import { hasFieldErrors, useServerFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";

import { patchAdminSpielDataAction } from "../../../actions";
import { applyDraftToSpiel, deriveSpielDraftStatus } from "../../../draftStatus";
import { FLPatchSpielDataPayloadSchema } from "../../../schemas";
import { listDependentSpiele } from "../../../utils";
import { DraftRail } from "./DraftRail";
import { DraftStatusProvider } from "./DraftStatusContext";
import { FormAnsetzungSection } from "./FormAnsetzungSection";
import { FormCancelSection } from "./FormCancelSection";
import { FormErgebnisSection } from "./FormErgebnisSection";
import { FormMatchupSection } from "./FormMatchupSection";
import { StickyActionBar } from "./StickyActionBar";

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
} from "@/features/spiele/schemas";
import type { ActionRequiredCategory } from "@/features/spiele/types";
import type { FLSpielort } from "@/features/spielorte/schemas";
import type { FLGruppenNames, FLTeam } from "@/features/teams/schemas";
import type { CalendarDate, Time } from "@internationalized/date";

/**
 * The match editor's form: four panels, a sticky summary rail, and one derivation behind both.
 *
 * The lookup lists arrive as props rather than from `useAdmin()`. They are only ever available on
 * admin routes, but reading the context here would make `spiele` depend on `admin` — the exact
 * direction the write path was moved out of `admin` to avoid (ADR-0005). The aggregator supplies them
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
}: {
  spielData: FLSpiel;
  teams: FLTeam[];
  spielorte: FLSpielort[];
  schiedsrichter: FLSchiedsrichter[];
  saisonSpiele: FLSpiel[];
  today: string;
  /**
   * Which action-required categories a fixture falls into, supplied by the aggregator view.
   *
   * **A function rather than a computed set, because the answer has to be live.** The admin toggles
   * Absage and the four "fehlt" categories stop applying at once — `categorizeActionRequired` reports a
   * cancelled fixture as cancelled and nothing else — so "Offene Angaben" has to be recomputed from the
   * draft rather than frozen at load. The rule itself stays in `admin`, which is what keeps `spiele`
   * from importing the aggregator to ask a question about a Spiel.
   */
  categorize: (spiel: FLSpiel) => ReadonlySet<ActionRequiredCategory>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [spielIsCanceled, setSpielIsCanceled] = useState<boolean>(spielData.is_canceled);
  const [ortPayload, setOrtPayload] = useState<FLSpielOrtFieldDraft | null>(spielData.ort);
  const [schiedsrichterPayload, setSchiedsrichterPayload] = useState<FLSpielSchiedsrichterFieldDraft | null>(spielData.schiedsrichter);

  // Held as the calendar types the pickers speak, converted at the payload boundary below. The stored
  // strings are already exactly what `parseDate` / `parseTime` accept, and a `null` is a fixture whose
  // date or kick-off has not been set — which is a legitimate state, not an empty field to nag about.
  const [datum, setDatum] = useState<CalendarDate | null>(spielData.datum ? parseDate(spielData.datum) : null);
  const [uhrzeit, setUhrzeit] = useState<Time | null>(spielData.uhrzeit ? parseTime(spielData.uhrzeit) : null);

  const [team1Payload, setTeam1Payload] = useState<FLSpielTeamField | null>(spielData.team1);
  const [team2Payload, setTeam2Payload] = useState<FLSpielTeamField | null>(spielData.team2);

  // Held beside the team rather than inside it: provenance survives the slot being filled, so the two
  // move independently (ADR-0041).
  const [team1Quelle, setTeam1Quelle] = useState<FLSpielQuelle | null>(spielData.team1_quelle);
  const [team2Quelle, setTeam2Quelle] = useState<FLSpielQuelle | null>(spielData.team2_quelle);

  // A draft, so an emptied count is `null` rather than `0` — a side genuinely can miss every kick, so
  // the two must not be the same value (ADR-0044).
  const [elfmeterschiessen, setElfmeterschiessen] = useState<FLSpielElfmeterschiessenDraft | null>(spielData.elfmeterschiessen);

  // Open on a fixture that already has a result, closed on one that does not. Correcting a recorded
  // result is the commonest reason anybody is here, and it used to start behind a switch over greyed-out
  // fields; a fixture with no result still needs the deliberate flip, so a stray keystroke cannot invent
  // a 0:0.
  const [ergebnisCanBeEdited, setErgebnisCanBeEdited] = useState<boolean>(spielData.ergebnis !== null);

  // Latched on a successful save so the guard below does not challenge the navigation the save itself
  // performs — at that moment the draft still differs from the `spielData` this render was given.
  const [hasSaved, setHasSaved] = useState(false);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);

  // See the note in `EntityForm`: catches a rejection on a payload path that has no input.
  const {
    fieldErrors: serverFieldErrors,
    setFieldErrors,
    formRef,
  } = useServerFieldErrors(() =>
    toast.danger("Bei der Aktualisierung der Spieldaten ist ein unerwarteter Fehler aufgetreten", { timeout: 6000 }),
  );

  // The same schema `patchAdminSpielDataAction` parses, so a message shown here is the message the
  // server would have produced (ADR-0050).
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
  };

  // An empty picker is a legitimate answer, and it is how a bracket slot the group phase has not
  // filled yet is recorded (ADR-0041) — so both sides submit as they stand, `null` included.
  const buildPayload = (): FLPatchSpielDataPayload => ({ ...draft, spiel_id: spielData.id }) as FLPatchSpielDataPayload;

  // The fixture as it will stand once saved. Built once and read three times — the preview renders it,
  // the categorisation asks it what is still outstanding, and the knockout-cancellation warning asks
  // whether the admin is about to call off a bracket fixture.
  const previewSpiel = applyDraftToSpiel(spielData, draft);

  const fieldErrors = mergedWith(serverFieldErrors);
  const status = deriveSpielDraftStatus({ stored: spielData, draft, expectedCategories: categorize(previewSpiel), fieldErrors });
  const isDirty = status.isDirty && !hasSaved;

  useUnsavedChangesWarning(isDirty);

  // The fixtures whose occupants this one's result decides (ADR-0048). Read off the STORED sides: what
  // is already wired is what a save resolves, and a group is a property of the clubs in the fixture
  // rather than of the fixture document (ADR-0028).
  const dependentSpiele = useMemo(() => {
    const gruppen = [spielData.team1, spielData.team2]
      .map((side) => teams.find((team) => team.id === side?.team_id)?.gruppe)
      .filter((gruppe): gruppe is FLGruppenNames => gruppe !== undefined);

    return listDependentSpiele(saisonSpiele, spielData, gruppen);
  }, [saisonSpiele, spielData, teams]);

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

  /** Leave, but ask first if there is anything to lose. The one route out that this page controls. */
  const requestLeave = () => {
    if (isDirty) {
      setIsConfirmingDiscard(true);
      return;
    }
    router.back();
  };

  /**
   * Puts every field back to what is stored, then leaves.
   *
   * **Navigating away is not enough, and assuming it was is what made the worst bug on this page.** The
   * App Router keeps a page's React tree alive for back and forward navigation, so an admin who
   * confirmed "Verwerfen" and then returned to the same fixture found the discarded draft still sitting
   * in the fields — the dialog had promised the work was gone and it was not. Resetting explicitly means
   * the promise holds whether the tree is rebuilt or restored.
   *
   * Every atom is listed rather than looped, and the list is the same one the `useState` calls above
   * declare: a field added there and forgotten here would silently survive a discard, which is exactly
   * the failure being fixed. `deriveSpielDraftStatus` is what would catch it — after this runs, nothing
   * may remain in `status.changed`.
   */
  const discardAndLeave = () => {
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
    setErgebnisCanBeEdited(spielData.ergebnis !== null);

    setFieldErrors({});
    clearVerdicts();
    setIsConfirmingDiscard(false);
    router.back();
  };

  const handleFormSubmit = () => {
    startTransition(async () => {
      const res = await patchAdminSpielDataAction(buildPayload(), spielData.saison_id);

      if (!res.success) {
        setFieldErrors(res.fieldErrors ?? {});

        // Only for failures no single field owns.
        if (!hasFieldErrors(res.fieldErrors)) {
          toast.danger(res.error || res.message || "Bei der Aktualisierung der Spieldaten ist ein unerwarteter Fehler aufgetreten", {
            timeout: 6000,
          });
        }
        return;
      }

      setFieldErrors({});
      clearVerdicts();
      setHasSaved(true);
      toast.success(res.message || "Die Spieldaten wurden erfolgreich aktualisiert.", { timeout: 6000 });
      router.back();
    });
  };

  return (
    <DraftStatusProvider status={status}>
      <Form
        ref={formRef}
        validationErrors={fieldErrors}
        className="flex w-full flex-col gap-6"
        action={() => handleFormSubmit()}>
        <div className="grid w-full grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:gap-8">
          {/* Explicit grid placement rather than `order-*`: the DOM order is the mobile reading order,
              and on a phone the rail's warnings and preview belong above the fields rather than below
              four panels of them. */}
          <div className="w-full xl:sticky xl:top-6 xl:col-start-2 xl:row-start-1 xl:self-start">
            <DraftRail
              previewSpiel={previewSpiel}
              today={today}
              dependentSpiele={dependentSpiele}
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
              team1Payload={team1Payload}
              onTeam1Change={setTeam1Payload}
              team2Payload={team2Payload}
              onTeam2Change={setTeam2Payload}
              team1Quelle={team1Quelle}
              onTeam1QuelleChange={setTeam1Quelle}
              team2Quelle={team2Quelle}
              onTeam2QuelleChange={setTeam2Quelle}
              onValidateSelection={validateSelection}
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

            <FormCancelSection
              spielData={spielData}
              spielIsCanceled={spielIsCanceled}
              onSpielIsCanceledChange={setSpielIsCanceled}
            />
          </div>
        </div>

        <StickyActionBar
          isPending={isPending}
          onCancel={requestLeave}
        />
      </Form>

      <ConfirmDiscardModal
        isOpen={isConfirmingDiscard}
        onClose={() => setIsConfirmingDiscard(false)}
        onDiscard={discardAndLeave}
        changeCount={status.changed.length}
      />
    </DraftStatusProvider>
  );
}
