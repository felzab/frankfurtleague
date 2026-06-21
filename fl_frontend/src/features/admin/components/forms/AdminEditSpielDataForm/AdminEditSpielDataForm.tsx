"use client";

import { Button, Description, Form, Separator, Switch, toast } from "@heroui/react";
import { useActionState, useEffect, useState } from "react";
import { patchAdminSpielDataAction } from "../../../actions";
import { useAdmin } from "../../providers/AdminContextProvider";
import FormDateTimeSection from "./FormDateTimeSection";
import FormSpielortSection from "./FormSpielortSection";
import FormSchiedsrichterSection from "./FormSchiedsrichterSection";
import type { FLSpiel, FLSpielOrtField, FLSpielSchiedsrichterField, FLSpielTeamField } from "@/features/spiele/schemas";
import FormMatchupSection from "./FormMatchupSection";

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
      className="flex flex-col gap-y-6 min-h-full"
      action={handleFormSubmit}>
      <Separator className="bg-quinary-light dark:bg-quinary-dark" />

      {/** Cancel Spiel */}
      <Switch
        size="md"
        aria-label="Spiel absagen switch"
        autoFocus={false}
        isSelected={spielIsCanceled}
        onChange={() => setSpielIsCanceled(!spielIsCanceled)}>
        <Switch.Content className="flex flex-row items-center justify-between w-full h-fit text-fluid-sm text-red-500">
          Spiel absagen
          <Switch.Control className={`${spielIsCanceled ? "bg-red-500" : ""}`}>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
        <Description className="px-0 text-fluid-xxs whitespace-normal leading-normal font-light">
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
      <div className="flex flex-row items-center justify-evenly w-full h-fit">
        <Button
          className="rounded-xl text-fluid-base font-bold p-4"
          variant="primary"
          type="submit"
          isPending={isPending}>
          Speichern
        </Button>
        <Button
          className="rounded-xl text-fluid-base font-bold p-4"
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
