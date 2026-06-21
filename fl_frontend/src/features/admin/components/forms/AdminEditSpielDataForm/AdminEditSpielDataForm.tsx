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
      className="flex min-h-full flex-col gap-y-6"
      action={handleFormSubmit}>
      <Separator className="bg-quinary-light dark:bg-quinary-dark" />

      {/** Cancel Spiel */}
      <Switch
        size="md"
        aria-label="Spiel absagen switch"
        autoFocus={false}
        isSelected={spielIsCanceled}
        onChange={() => setSpielIsCanceled(!spielIsCanceled)}>
        <Switch.Content className="text-fluid-sm flex h-fit w-full flex-row items-center justify-between text-red-500">
          Spiel absagen
          <Switch.Control className={`${spielIsCanceled ? "bg-red-500" : ""}`}>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
        <Description className="text-fluid-xxs px-0 leading-normal font-light whitespace-normal">
          Wird dieser Schalter umgelegt, so wird das Spiel als abgesagt eingetragen. Dies kann zurückgesetzt werden, indem der Schalter zurück
          umgelegt wird.
        </Description>
      </Switch>

      <Separator className="bg-quinary-light dark:bg-quinary-dark" />

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

      <Separator className="bg-quinary-light dark:bg-quinary-dark" />

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

      <Separator className="bg-quinary-light dark:bg-quinary-dark" />

      {/** Buttons */}
      <div className="flex h-fit w-full flex-row items-center justify-evenly">
        <Button
          className="text-fluid-base rounded-xl p-4 font-bold"
          variant="primary"
          type="submit"
          isPending={isPending}>
          Speichern
        </Button>
        <Button
          className="text-fluid-base rounded-xl p-4 font-bold"
          variant="secondary"
          type="button"
          onPress={onClose}
          isDisabled={isPending}>
          Abbrechen
        </Button>
      </div>
    </Form>
  );
}
