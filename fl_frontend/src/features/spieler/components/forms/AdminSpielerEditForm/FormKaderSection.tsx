"use client";

import { useTransition } from "react";

import { Button, FieldError, Input, Switch, TextField } from "@heroui/react";

import { postSaisonSpielerAction } from "@/features/spieler/actions";
import { ClosedSetSelect } from "@/features/spieler/components/forms/ClosedSetSelect";
import { TeamSelect } from "@/features/spieler/components/forms/TeamSelect";
import { NUMMER_MAX_LENGTH, POSITION_OPTIONS, STUFE_OPTIONS } from "@/features/spieler/constants";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR, FIELD_INPUT } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import { SpielerFieldLabel } from "./SpielerFieldLabel";

import type { FLSpielerPosition, FLSpielerStufe } from "@/features/spieler/schemas";
import type { SpielerSaisonContext, SpielerTeamOption } from "@/features/spieler/types";

/** The season's own state, said in one badge beside its id. */
function SaisonBadge({ status }: { status: SpielerSaisonContext["saisonStatus"] }) {
  if (status === "active") return <span className={`${LABEL_BADGE} bg-success/15 text-success-strong`}>Laufend</span>;
  if (status === "future") return <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Geplant</span>;
  return <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Beendet</span>;
}

/**
 * The player's squad entry for the SELECTED season — the one in the sidemenu's season selector, not a
 * list of every season: the selector is the page's season context, so switching it switches what this
 * panel shows and writes. The club editor's Saison panel is the pattern.
 *
 * **Two differences from that panel, and both come from what a squad row is.**
 *
 * The team is editable with no lock. A player moving club mid-season is a normal event and the
 * junction row is where that fact lives — it is the whole reason the row exists apart from the
 * person. A club's group, by contrast, decides two tables and the seeding, which is why that one is
 * locked once a season is under way.
 *
 * A player may be entered into a `future` season AND into one already running (owner, 2026-08-07),
 * where a club may not. Squads are filled in over time, and `is_nachgetragen` is the field that
 * records a late arrival — so the entry control derives it from the season's status rather than
 * asking, and a running season is a normal thing to add a player to rather than a refusal.
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
  isNachgetragen,
  onIsNachgetragenChange,
  rowInactiveSince,
  onValidateFields,
  onValidateSelection,
  spielerId,
}: {
  saison: SpielerSaisonContext;
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
  isNachgetragen: boolean;
  onIsNachgetragenChange: (next: boolean) => void;
  /** The day the ROW was retired, or null — the person's own retirement is the page header's. */
  rowInactiveSince: string | null;
  onValidateFields: (paths: readonly string[]) => void;
  onValidateSelection: (paths: readonly string[], selected: { team_id: string }) => void;
  spielerId: string;
}) {
  const panel = formPanel();
  const [isEntering, startEntering] = useTransition();

  // A season that has already started means this player arrived late, which is exactly what the flag
  // records (owner, 2026-08-07). Derived rather than asked, so it cannot be forgotten.
  const entryIsNachgetragen = saison.saisonStatus !== "future";

  const handleEnterSaison = () => {
    startEntering(async () => {
      const res = await postSaisonSpielerAction({
        spieler_id: spielerId,
        saison_id: saison.saisonId,
        team_id: teamId,
        nummer,
        position,
        stufe,
        is_nachgetragen: entryIsNachgetragen,
      });
      if (res.success) appToast.success(res.message ?? "Spieler aufgenommen!");
      else appToast.danger("Aufnehmen fehlgeschlagen", { description: res.error || "Ein unerwarteter Fehler ist aufgetreten." });
    });
  };

  return (
    <section className={panel.root()}>
      {/* `relative` + an absolutely placed badge, so the h2 keeps the exact flow every other panel
          heading has — see the club editor's Saison panel. */}
      <div className={`${panel.header()} relative`}>
        <span className="absolute top-1/2 right-4 -translate-y-1/2 sm:right-5">
          <SaisonBadge status={saison.saisonStatus} />
        </span>
        <h2 className={panel.heading()}>
          Kader {saison.saisonId}
          <InfoHint label="Hinweis zum Kadereintrag">
            <p>Dieser Bereich zeigt und bearbeitet die im Seitenmenü gewählte Saison.</p>
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
            {rowInactiveSince !== null && (
              <Callout
                severity="info"
                title={`Ausgetragen seit ${formatSpielDatum(rowInactiveSince)}`}>
                Der Eintrag zählt in dieser Saison zu keinem Kader mehr. Nummer, Position und Stufe bleiben erhalten und kehren beim
                Reaktivieren zurück.
              </Callout>
            )}

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
                maxLength={NUMMER_MAX_LENGTH}>
                <SpielerFieldLabel path="nummer">Nummer</SpielerFieldLabel>
                <Input className={`${FIELD_INPUT} font-extrabold tracking-wider`} />
                <FieldError className={FIELD_ERROR} />
              </TextField>
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
                  options={STUFE_OPTIONS}
                  name="stufe"
                  label="Stufe"
                  placeholder="Keine Angabe"
                  withOwnLabel={false}
                />
              </div>
            </div>

            <div className="flex w-full flex-col gap-y-1">
              <SpielerFieldLabel path="is_nachgetragen">Nachgetragen</SpielerFieldLabel>
              <Switch
                name="is_nachgetragen"
                isSelected={isNachgetragen}
                onChange={onIsNachgetragenChange}
                className="fluid-sm text-foreground flex flex-row items-center gap-x-3 font-medium">
                Der Spieler kam erst nach dem Start der Saison dazu.
              </Switch>
            </div>
          </>
        ) : (
          <div className="flex w-full flex-col gap-y-4">
            <Callout
              severity="info"
              title={`Nicht im Kader der Saison ${saison.saisonId}`}>
              Ohne Kadereintrag erscheint der Spieler in dieser Saison auf keiner Seite. Wähle ein Team und nimm ihn auf; Nummer, Position und
              Stufe können danach jederzeit ergänzt werden.
            </Callout>

            <div className="grid w-full grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,18rem)_auto]">
              <TeamSelect
                value={teamId}
                onChange={onTeamIdChange}
                teams={teams}
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

            {entryIsNachgetragen && (
              <p className="fluid-xxs text-foreground-muted font-medium">
                Die Saison läuft bereits, der Eintrag wird deshalb als nachgetragen markiert.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
