"use client";

import { useState, useTransition } from "react";

import { Button, Description, Form, Separator, Switch, toast } from "@heroui/react";

import { formButton } from "@/shared/components/ui/formButtons";

import { patchAdminSpielDataAction } from "../../../actions";
import { useAdmin } from "../../providers/AdminContextProvider";
import FormDateTimeSection from "./FormDateTimeSection";
import FormMatchupSection from "./FormMatchupSection";
import FormSchiedsrichterSection from "./FormSchiedsrichterSection";
import FormSpielortSection from "./FormSpielortSection";

import type { FLSpiel, FLSpielOrtField, FLSpielSchiedsrichterField, FLSpielTeamField } from "@/features/spiele/schemas";

export default function AdminEditSpielDataForm({ spielData, onClose }: { spielData: FLSpiel; onClose: () => void }) {
  const adminData = useAdmin();

  const [isPending, startTransition] = useTransition();

  const [spielIsCanceled, setSpielIsCanceled] = useState<boolean>(spielData.is_canceled);
  const [ortPayload, setOrtPayload] = useState<FLSpielOrtField | null>(spielData.ort);
  const [schiedsrichterPayload, setSchiedsrichterPayload] = useState<FLSpielSchiedsrichterField | null>(spielData.schiedsrichter);

  const [team1Payload, setTeam1Payload] = useState<FLSpielTeamField | null>(spielData.team1);
  const [team2Payload, setTeam2Payload] = useState<FLSpielTeamField | null>(spielData.team2);

  const handleFormSubmit = (formData: FormData) => {
    // Both teams are required by the payload schema, but the Autocomplete's clear button can empty
    // them. Without this the submit failed server-side with the generic "check your input" toast,
    // which named no field.
    if (!team1Payload || !team2Payload) {
      toast.danger("Bitte wähle beide Teams aus.", { timeout: 6000 });
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
        toast.danger(res.error || res.message || "Bei der Aktualisierung der Spieldaten ist ein unerwarteter Fehler aufgetreten", {
          timeout: 6000,
        });
        return;
      }

      toast.success(res.message || "Die Spieldaten wurden erfolgreich aktualisiert.", { timeout: 6000 });
      onClose();
    });
  };

  return (
    <Form
      className="flex min-h-full flex-col gap-y-6 pt-2 pb-6"
      action={handleFormSubmit}>
      <Separator className="bg-border" />

      {/** Cancel Spiel */}
      <Switch
        size="md"
        aria-label="Spiel absagen switch"
        autoFocus={false}
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
        spielorte={adminData.spielorte}
        ortPayload={ortPayload}
        onOrtChange={setOrtPayload}
      />

      {/** Schiedsrichter */}
      <FormSchiedsrichterSection
        schiedsrichter={adminData.schiedsrichter}
        schiedsrichterPayload={schiedsrichterPayload}
        onSchiedsrichterChange={setSchiedsrichterPayload}
      />

      <Separator className="bg-border" />

      {/** Team1 vs. Team2 */}
      <FormMatchupSection
        teams={adminData.teams}
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
