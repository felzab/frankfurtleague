"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { parseDate, parseTime } from "@internationalized/date";

import { Button, Form, toast } from "@heroui/react";

import { formButton } from "@/shared/components/ui/formButtons";
import { FORM_SECTION_HEADING, FORM_SECTION_PANEL } from "@/shared/components/ui/formFieldStyles";
import { useDraftValidation } from "@/shared/hooks/useDraftValidation";
import { hasFieldErrors, useServerFieldErrors } from "@/shared/hooks/useServerFieldErrors";

import { patchAdminSpielDataAction } from "../../../actions";
import { FLPatchSpielDataPayloadSchema } from "../../../schemas";
import { FormCancelSection } from "./FormCancelSection";
import { FormDateTimeSection } from "./FormDateTimeSection";
import { FormMatchupSection } from "./FormMatchupSection";
import { FormSchiedsrichterSection } from "./FormSchiedsrichterSection";
import { FormSpielortSection } from "./FormSpielortSection";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";
import type {
  FLSpiel,
  FLSpielElfmeterschiessenDraft,
  FLSpielOrtFieldDraft,
  FLSpielQuelle,
  FLSpielSchiedsrichterFieldDraft,
  FLSpielTeamField,
} from "@/features/spiele/schemas";
import type { FLSpielort } from "@/features/spielorte/schemas";
import type { FLTeam } from "@/features/teams/schemas";
import type { CalendarDate, Time } from "@internationalized/date";

/**
 * The lookup lists arrive as props rather than from `useAdmin()`. They are only ever available on
 * admin routes, but reading the context here would make `spiele` depend on `admin` — the exact
 * direction the write path was moved out of `admin` to avoid (ADR-0005). The aggregator supplies them
 * instead, which is what an aggregator slice is for.
 *
 * **This form owns a page, not a dialog** (ADR-0050), and two things follow from that:
 *
 * - **Every field is controlled, date and time included.** The draft payload has to be complete between
 *   keystrokes, because that is what the schema is asked about when a field is left — and a React 19
 *   form `action` resets uncontrolled inputs once it resolves, which on a page the admin stays on would
 *   silently blank the two fields that used `defaultValue`.
 * - **A save leaves the page.** `router.back()` returns to whichever list the admin came from with its
 *   filters and scroll intact, which is the flow the action-required list and the Spielsuche both need.
 *   Opened as a bare link there is nothing to go back to, and the browser stays here — correct rather
 *   than merely tolerable, because this page shows one fixture and a save never changes *that* fixture
 *   behind the admin's back. What a resolution can clear is a result in a fixture further down the
 *   bracket (ADR-0048), and none of those is on this screen.
 */
export function AdminEditSpielDataForm({
  spielData,
  teams,
  spielorte,
  schiedsrichter,
  saisonSpiele,
}: {
  spielData: FLSpiel;
  teams: FLTeam[];
  spielorte: FLSpielort[];
  schiedsrichter: FLSchiedsrichter[];
  saisonSpiele: FLSpiel[];
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

  // See the note in `EntityForm`: catches a rejection on a payload path that has no input.
  const {
    fieldErrors: serverFieldErrors,
    setFieldErrors,
    formRef,
  } = useServerFieldErrors(() =>
    toast.danger("Bei der Aktualisierung der Spieldaten ist ein unerwarteter Fehler aufgetreten", { timeout: 6000 }),
  );

  // The same schema `patchAdminSpielDataAction` parses, so a message shown here is the message the server
  // would have produced (ADR-0050).
  const { validatePaths, clearVerdicts, mergedWith } = useDraftValidation(FLPatchSpielDataPayloadSchema);

  // An empty picker is a legitimate answer, and it is how a bracket slot the group phase has not
  // filled yet is recorded (ADR-0041) — so both sides submit as they stand, `null` included.
  const buildPayload = () => ({
    spiel_id: spielData.id,
    is_canceled: spielIsCanceled,

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
  });

  /**
   * Judges the named paths against the current draft. Fired when a typed field is left and when a
   * picker's selection changes — see `useDraftValidation` for why those two triggers differ.
   *
   * It writes only to the client-side verdicts, never to the server's map, and that separation is
   * load-bearing: `useServerFieldErrors` calls `reportValidity()` whenever its map changes, which moves
   * focus to the first rejected field. That is correct after a submit and wrong on a blur — clearing a
   * corrected field there would have thrown focus onto the next unfixed one while somebody was tabbing
   * past it. `mergedWith` retracts the stale server message at render instead.
   */
  const validateFields = (paths: readonly string[]) => validatePaths(buildPayload(), paths);

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
      toast.success(res.message || "Die Spieldaten wurden erfolgreich aktualisiert.", { timeout: 6000 });
      router.back();
    });
  };

  return (
    <Form
      ref={formRef}
      validationErrors={mergedWith(serverFieldErrors)}
      className="flex w-full flex-col gap-y-5"
      action={() => handleFormSubmit()}>
      {/* Two tracks from `lg` up, and the split is by what the admin came to do rather than by field
          count: the sides and the result carry the competition, the rest is administration. On a phone
          this collapses to the same reading order — begegnung first, absage last — because the DOM order
          IS the mobile order and no `order-*` utility reshuffles it. */}
      <div className="grid w-full grid-cols-1 gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
        <div className="flex w-full flex-col gap-y-5">
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
            elfmeterschiessen={elfmeterschiessen}
            onElfmeterschiessenChange={setElfmeterschiessen}
            onValidateFields={validateFields}
          />
        </div>

        <div className="flex w-full flex-col gap-y-5">
          <div className={FORM_SECTION_PANEL}>
            <h2 className={FORM_SECTION_HEADING}>Termin</h2>
            <FormDateTimeSection
              datum={datum}
              onDatumChange={setDatum}
              uhrzeit={uhrzeit}
              onUhrzeitChange={setUhrzeit}
              onValidateFields={validateFields}
            />
          </div>

          <div className={FORM_SECTION_PANEL}>
            <h2 className={FORM_SECTION_HEADING}>Ort und Schiedsrichter</h2>
            <FormSpielortSection
              spielorte={spielorte}
              ortPayload={ortPayload}
              onOrtChange={setOrtPayload}
              onValidateFields={validateFields}
            />
            <FormSchiedsrichterSection
              schiedsrichter={schiedsrichter}
              schiedsrichterPayload={schiedsrichterPayload}
              onSchiedsrichterChange={setSchiedsrichterPayload}
              onValidateFields={validateFields}
            />
          </div>

          <FormCancelSection
            spielIsCanceled={spielIsCanceled}
            onSpielIsCanceledChange={setSpielIsCanceled}
          />
        </div>
      </div>

      {/* Sticky, and the admin layout is what makes it work: `<main>` is the scroll container, so this
          bar stays on the glass while the form scrolls under it. On a phone the alternative is a submit
          button below eight sections of fields, which is the reach the owner called out. */}
      <div className="bg-background/85 border-border sticky bottom-0 -mx-4 flex flex-row items-center justify-end gap-3 border-t px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
        <Button
          type="button"
          variant="secondary"
          onPress={() => router.back()}
          isDisabled={isPending}
          className={formButton({ intent: "cancel" })}>
          Abbrechen
        </Button>
        <Button
          type="submit"
          variant="primary"
          isDisabled={isPending}
          className={formButton({ intent: "submit" })}>
          {isPending ? "Speichert..." : "Speichern"}
        </Button>
      </div>
    </Form>
  );
}
