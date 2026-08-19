"use client";

import { useState, useTransition } from "react";

import { Button, FieldError, Input, Switch, TextField } from "@heroui/react";

import { postSaisonSpielerAction } from "@/features/spieler/actions";
import { ClosedSetSelect } from "@/features/spieler/components/forms/ClosedSetSelect";
import { TeamSelect } from "@/features/spieler/components/forms/TeamSelect";
import { NUMMER_MAX_LENGTH, POSITION_OPTIONS } from "@/features/spieler/constants";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR, FIELD_INPUT } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { appToast } from "@/shared/utils/appToast";

import { SpielerFieldLabel } from "./SpielerFieldLabel";

import type { FLSpielerPosition, FLSpielerStufe } from "@/features/spieler/schemas";
import type { SpielerSaisonContext, SpielerTeamOption } from "@/features/spieler/types";
import type { SpielerBanner } from "./banners";

/** The app's one wording and one palette for a season's state. */
function SaisonBadge({ status }: { status: SpielerSaisonContext["saisonStatus"] }) {
  if (status === "active") return <span className={`${LABEL_BADGE} bg-success/15 text-success-strong`}>Laufend</span>;
  if (status === "future") return <span className={`${LABEL_BADGE} bg-info/15 text-info-strong`}>Geplant</span>;
  return <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Abgeschlossen</span>;
}

/**
 * The team is editable with no lock and a `future` season is not required, unlike the club editor's
 * panel: squads fill in over time, and moving club mid-season is why the junction row exists.
 */
export function FormKaderSection({
  saison,
  teams,
  isMember,
  teamId,
  onTeamIdChange,
  nummer,
  onNummerChange,
  position,
  onPositionChange,
  stufe,
  onStufeChange,
  isCaptain,
  onIsCaptainChange,
  onValidateFields,
  onValidateSelection,
  spielerId,
  banners,
}: {
  saison: SpielerSaisonContext & { erlaubteStufen: readonly FLSpielerStufe[] };
  /** The selected season's teams — what the picker may offer. */
  teams: readonly SpielerTeamOption[];
  isMember: boolean;
  teamId: string | null;
  onTeamIdChange: (next: string) => void;
  nummer: string;
  onNummerChange: (next: string) => void;
  position: FLSpielerPosition | null;
  onPositionChange: (next: FLSpielerPosition | null) => void;
  stufe: FLSpielerStufe | null;
  onStufeChange: (next: FLSpielerStufe | null) => void;
  isCaptain: boolean;
  onIsCaptainChange: (next: boolean) => void;
  onValidateFields: (paths: readonly string[]) => void;
  onValidateSelection: (paths: readonly string[], selected: { team_id: string }) => void;
  spielerId: string;
  banners: readonly SpielerBanner[];
}) {
  const panel = formPanel();
  const [isEntering, startEntering] = useTransition();

  /**
   * Held here, not in the editor's `useDraftFieldErrors`: its refusal in that map would reach the
   * unsaved-error badge and a `reportValidity()` that moves focus to a form half this branch does
   * not render.
   */
  const [entryTeamError, setEntryTeamError] = useState<string | null>(null);

  // Derived rather than asked, so it cannot be forgotten: a started season means a late arrival.
  const entryIsNachgetragen = saison.saisonStatus !== "future";

  const handleEnterSaison = () => {
    startEntering(async () => {
      const res = await postSaisonSpielerAction({
        spieler_id: spielerId,
        saison_id: saison.saisonId,
        team_id: teamId,
        // Emptied means absent — this branch renders no `nummer` input, so a refusal on it would have
        // nowhere to land.
        nummer: nummer.trim() === "" ? null : nummer.trim(),
        position,
        stufe,
        is_nachgetragen: entryIsNachgetragen,
        is_captain: false,
      });

      const teamError = res.fieldErrors?.team_id ?? null;
      setEntryTeamError(teamError);

      if (res.success) {
        appToast.success(res.message ?? "Spieler aufgenommen!");
        return;
      }
      // Suppressed where the picker carries the message, so a refusal about the chosen team is not
      // also said in a toast that names no field.
      if (teamError === null) {
        appToast.danger("Aufnehmen fehlgeschlagen", { description: res.error || "Ein unerwarteter Fehler ist aufgetreten." });
      }
    });
  };

  return (
    <section className={panel.root()}>
      {/* `relative` + an absolutely placed badge, so the h2 keeps every other panel heading's flow. */}
      <div className={`${panel.header()} relative`}>
        <span className="absolute top-1/2 right-4 -translate-y-1/2 sm:right-5">
          <SaisonBadge status={saison.saisonStatus} />
        </span>
        <h2 className={panel.heading()}>
          Kader {saison.saisonId}
          <InfoHint label="Hinweis zum Kadereintrag">
            <p>Dieser Bereich gilt für die Saison, die im Seitenmenü ausgewählt ist.</p>
            <ul>
              <li>Um eine andere Saison zu bearbeiten, wähle sie im Seitenmenü aus.</li>
              <li>
                Ein <strong>Teamwechsel</strong> wird hier eingetragen. Der Spieler bleibt dieselbe Person.
              </li>
              <li>
                <strong>Nummer, Position und Stufe</strong> gelten nur für diese Saison und dürfen leer bleiben.
              </li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        {isMember ? (
          <>
            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex w-full flex-col gap-y-1">
                <SpielerFieldLabel path="team_id">Team</SpielerFieldLabel>
                <TeamSelect
                  value={teamId}
                  onChange={(next) => {
                    onTeamIdChange(next);
                    onValidateSelection(["team_id"], { team_id: next });
                  }}
                  teams={teams}
                  withOwnLabel={false}
                />
              </div>

              <TextField
                name="nummer"
                value={nummer}
                onChange={onNummerChange}
                onBlur={() => onValidateFields(["nummer"])}
                maxLength={NUMMER_MAX_LENGTH}
                inputMode="numeric"
                pattern="[0-9]*">
                <SpielerFieldLabel path="nummer">Nummer</SpielerFieldLabel>
                <Input className={`${FIELD_INPUT} font-extrabold tracking-wider`} />
                <FieldError className={FIELD_ERROR} />
              </TextField>
            </div>

            {/* A switch rather than a note, unlike `is_nachgetragen`: a decision somebody makes and
                changes, and a role within THIS season's squad. */}
            <div className="flex w-full flex-col gap-y-1">
              <SpielerFieldLabel path="is_captain">Kapitän</SpielerFieldLabel>
              <Switch
                name="is_captain"
                isSelected={isCaptain}
                onChange={onIsCaptainChange}
                className="border-border bg-surface hover:bg-hover w-full rounded-lg border px-3 py-2.5 transition-colors">
                <Switch.Content className="fluid-sm text-foreground flex w-full flex-row items-center justify-between gap-x-3 font-medium">
                  <span>Führt das Team in der Saison {saison.saisonId} als Kapitän an.</span>
                  <Switch.Control className={isCaptain ? "bg-brand-solid" : ""}>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch.Content>
              </Switch>
            </div>

            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex w-full flex-col gap-y-1">
                <SpielerFieldLabel path="position">Position</SpielerFieldLabel>
                <ClosedSetSelect
                  value={position}
                  onChange={onPositionChange}
                  options={POSITION_OPTIONS}
                  name="position"
                  label="Position"
                  placeholder="Keine Angabe"
                  withOwnLabel={false}
                />
              </div>

              <div className="flex w-full flex-col gap-y-1">
                <SpielerFieldLabel path="stufe">Stufe</SpielerFieldLabel>
                <ClosedSetSelect
                  value={stufe}
                  onChange={onStufeChange}
                  options={saison.erlaubteStufen}
                  name="stufe"
                  label="Stufe"
                  placeholder="Keine Angabe"
                  withOwnLabel={false}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="flex w-full flex-col gap-y-4">
            <InlineBanners
              banners={banners}
              spot="kader-eintritt"
            />

            <div className="grid w-full grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,18rem)_auto]">
              <TeamSelect
                value={teamId}
                onChange={(next) => {
                  // Retracted on the pick, not on the next attempt: the message is about the team
                  // that was refused, and stops describing the picker the moment that one moves.
                  setEntryTeamError(null);
                  onTeamIdChange(next);
                }}
                teams={teams}
                error={entryTeamError ?? undefined}
              />
              <Button
                type="button"
                variant="primary"
                isDisabled={isEntering}
                onPress={handleEnterSaison}
                className={formButton({ intent: "submit" })}>
                {isEntering ? "Speichert..." : `In Kader ${saison.saisonId} aufnehmen`}
              </Button>
            </div>

            {/* Coloured rather than muted: it announces a value the form chooses on the admin's
                behalf, which must not read as fine print. */}
            <InlineBanners
              banners={banners}
              spot="kader-nachgetragen"
            />
          </div>
        )}
      </div>
    </section>
  );
}
