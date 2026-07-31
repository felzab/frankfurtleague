"use client";

import { useState, useTransition } from "react";

import { Button, Description, Form, Separator, Switch, toast } from "@heroui/react";

import { formButton } from "@/shared/components/ui/formButtons";
import { hasFieldErrors, useServerFieldErrors } from "@/shared/hooks/useServerFieldErrors";

import { patchAdminSpielDataAction } from "../../../actions";
import FormDateTimeSection from "./FormDateTimeSection";
import FormMatchupSection from "./FormMatchupSection";
import FormSchiedsrichterSection from "./FormSchiedsrichterSection";
import FormSpielortSection from "./FormSpielortSection";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";
import type { FLSpiel, FLSpielOrtFieldDraft, FLSpielSchiedsrichterFieldDraft, FLSpielTeamField } from "@/features/spiele/schemas";
import type { FLSpielort } from "@/features/spielorte/schemas";
import type { FLTeam } from "@/features/teams/schemas";

/**
 * The lookup lists arrive as props rather than from `useAdmin()`. They are only ever available on
 * admin routes, but reading the context here would make `spiele` depend on `admin` — the exact
 * direction the write path was moved out of `admin` to avoid. The aggregator supplies them
 * instead, which is what an aggregator slice is for.
 */
export default function AdminEditSpielDataForm({
  spielData,
  teams,
  spielorte,
  schiedsrichter,
  onClose,
}: {
  spielData: FLSpiel;
  teams: FLTeam[];
  spielorte: FLSpielort[];
  schiedsrichter: FLSchiedsrichter[];
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  const [spielIsCanceled, setSpielIsCanceled] = useState<boolean>(spielData.is_canceled);
  const [ortPayload, setOrtPayload] = useState<FLSpielOrtFieldDraft | null>(spielData.ort);
  const [schiedsrichterPayload, setSchiedsrichterPayload] = useState<FLSpielSchiedsrichterFieldDraft | null>(spielData.schiedsrichter);

  const [team1Payload, setTeam1Payload] = useState<FLSpielTeamField | null>(spielData.team1);
  const [team2Payload, setTeam2Payload] = useState<FLSpielTeamField | null>(spielData.team2);

  // See the note in `EntityForm`: catches a rejection on a payload path that has no input.
  const { fieldErrors, setFieldErrors, formRef } = useServerFieldErrors(() =>
    toast.danger("Bei der Aktualisierung der Spieldaten ist ein unerwarteter Fehler aufgetreten", { timeout: 6000 }),
  );

  const handleFormSubmit = (formData: FormData) => {
    // Both teams are required by the payload schema, but the Autocomplete's clear button can empty
    // them. Reported on the two pickers rather than as a toast, so the message sits at the field it
    // is about — the same channel the server's own rejections use.
    if (!team1Payload || !team2Payload) {
      setFieldErrors({
        ...(team1Payload ? {} : { "team1.team_id": "Bitte wähle ein Team aus." }),
        ...(team2Payload ? {} : { "team2.team_id": "Bitte wähle ein Team aus." }),
      });
      return;
    }

    const payload = {
      spiel_id: spielData.id,
      is_canceled: spielIsCanceled,

      datum: formData.get("datum")?.toString() || null,
      uhrzeit: formData.get("uhrzeit")?.toString() || null,

      ort: ortPayload,
      schiedsrichter: schiedsrichterPayload,

      team1: team1Payload,
      team2: team2Payload,
    };

    startTransition(async () => {
      const res = await patchAdminSpielDataAction(payload);

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
      toast.success(res.message || "Die Spieldaten wurden erfolgreich aktualisiert.", { timeout: 6000 });
      onClose();
    });
  };

  return (
    <Form
      ref={formRef}
      validationErrors={fieldErrors}
      className="flex min-h-full flex-col gap-y-6 pt-2 pb-6"
      action={handleFormSubmit}>
      <Separator className="bg-border" />

      {/** Cancel Spiel */}
      {/* No `aria-label`: "Spiel absagen" below sits inside the switch's own <label>, so an
          aria-label would only override the visible text with a copy of itself (cf. R4 §3.2). */}
      <Switch
        size="md"
        isSelected={spielIsCanceled}
        onChange={() => setSpielIsCanceled(!spielIsCanceled)}>
        <Switch.Content className="text-fluid-sm text-danger flex h-fit w-full flex-row items-center justify-between font-bold">
          Spiel absagen
          <Switch.Control className={`${spielIsCanceled ? "bg-danger" : ""}`}>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
        <Description className="text-fluid-xxs text-foreground-muted px-0 leading-normal font-medium whitespace-normal">
          Wird dieser Schalter umgelegt, so wird das Spiel als abgesagt eingetragen. Dies kann zurückgesetzt werden, indem der Schalter zurück
          umgelegt wird.
        </Description>
      </Switch>

      <Separator className="bg-border" />

      {/** Datum/uhrzeit */}
      <FormDateTimeSection spielData={spielData} />

      {/** Spielort */}
      <FormSpielortSection
        spielorte={spielorte}
        ortPayload={ortPayload}
        onOrtChange={setOrtPayload}
      />

      {/** Schiedsrichter */}
      <FormSchiedsrichterSection
        schiedsrichter={schiedsrichter}
        schiedsrichterPayload={schiedsrichterPayload}
        onSchiedsrichterChange={setSchiedsrichterPayload}
      />

      <Separator className="bg-border" />

      {/** Team1 vs. Team2 */}
      <FormMatchupSection
        teams={teams}
        team1Payload={team1Payload}
        onTeam1Change={setTeam1Payload}
        team2Payload={team2Payload}
        onTeam2Change={setTeam2Payload}
        team1InitialData={spielData.team1}
        team2InitialData={spielData.team2}
      />

      <Separator className="bg-border" />

      {/* Buttons */}
      <div className="flex h-fit w-full flex-row items-center justify-evenly gap-3">
        <Button
          type="button"
          variant="secondary"
          onPress={onClose}
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
