"use client";

import { useActionState, useEffect, useState } from "react";

import { Button, Description, Form, Separator, Switch, toast } from "@heroui/react";

import { patchAdminSpielDataAction } from "../../../actions";
import { useAdmin } from "../../providers/AdminContextProvider";
import FormDateTimeSection from "./FormDateTimeSection";
import FormMatchupSection from "./FormMatchupSection";
import FormSchiedsrichterSection from "./FormSchiedsrichterSection";
import FormSpielortSection from "./FormSpielortSection";

import type { FLSpiel, FLSpielOrtField, FLSpielSchiedsrichterField, FLSpielTeamField } from "@/features/spiele/schemas";

export default function AdminEditSpielDataForm({ spielData, onClose }: { spielData: FLSpiel; onClose: () => void }) {
  const adminData = useAdmin();

  const [state, formAction, isPending] = useActionState(patchAdminSpielDataAction, null);

  const [spielIsCanceled, setSpielIsCanceled] = useState<boolean>(spielData.is_canceled);
  const [ortPayload, setOrtPayload] = useState<FLSpielOrtField | null>(spielData.ort);
  const [schiedsrichterPayload, setSchiedsrichterPayload] = useState<FLSpielSchiedsrichterField | null>(spielData.schiedsrichter);

  const [team1Payload, setTeam1Payload] = useState<FLSpielTeamField | null>(spielData.team1);
  const [team2Payload, setTeam2Payload] = useState<FLSpielTeamField | null>(spielData.team2);

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message || "Die Spieldaten wurden erfolgreich aktualisiert.", { timeout: 6000 });
      onClose();
    } else if (state?.error) {
      toast.danger(state.error || "Bei der Aktualisierung der Spieldaten ist ein unerwarteter Fehler aufgetreten", { timeout: 6000 });
    }
  }, [state, onClose]);

  const handleFormSubmit = (formData: FormData) => {
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

    formAction(payload);
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
          isDisabled={isPending}
          className="text-fluid-sm border-border text-foreground-muted hover:bg-surface-muted hover:text-foreground rounded-xl border bg-transparent px-6 py-3 font-bold transition-all active:scale-95">
          Abbrechen
        </Button>
        <Button
          type="submit"
          isDisabled={isPending}
          className="text-fluid-sm bg-brand text-foreground shadow-brand/25 rounded-xl px-6 py-3 font-bold tracking-wide shadow-lg transition-all duration-200 hover:opacity-90 active:scale-95">
          {isPending ? "Speichert..." : "Speichern"}
        </Button>
      </div>
    </Form>
  );
}
