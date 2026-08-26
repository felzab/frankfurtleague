"use client";

import { useState, useTransition } from "react";

import { Button, FieldError, Input, TextField, ToggleButton, ToggleButtonGroup } from "@heroui/react";

import { postSaisonSpielerAction } from "@/features/spieler/actions";
import { ClosedSetSelect } from "@/features/spieler/components/forms/ClosedSetSelect";
import { TeamSelect } from "@/features/spieler/components/forms/TeamSelect";
import { NUMMER_MAX_LENGTH, NUMMER_MUST_BE_DIGITS, POSITION_OPTIONS, ROLLE_OPTIONS } from "@/features/spieler/constants";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR, FIELD_INPUT, FIELD_PAIR, TOGGLE_GROUP_ALIGN } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { appToast } from "@/shared/utils/appToast";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

import type { FLSpielerPosition, FLSpielerRolle, FLSpielerStufe } from "@/features/spieler/schemas";
import type { SpielerSaisonContext, SpielerTeamOption } from "@/features/spieler/types";
import type { Key } from "@heroui/react";
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
  rolle,
  onRolleChange,
  heldRollen,
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
  rolle: FLSpielerRolle | null;
  onRolleChange: (next: FLSpielerRolle | null) => void;
  /** Who holds each role in the DRAFT's team, so a role the write path would refuse is not offered. */
  heldRollen: Partial<Record<FLSpielerRolle, string>>;
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
        rolle: null,
      });

      const teamError = res.fieldErrors?.team_id ?? null;
      setEntryTeamError(teamError);

      if (res.success) {
        appToast.success(res.message ?? "Spieler aufgenommen");
        return;
      }
      // Suppressed where the picker carries the message, so a refusal about the chosen team is not
      // also said in a toast that names no field.
      if (teamError === null) {
        appToast.danger("Aufnehmen fehlgeschlagen", { description: res.error || UNKNOWN_REFUSAL });
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
          <Hint
            mode="reveal"
            label="Hinweis zum Kadereintrag"
            body={{
              lead: "Diese Angaben gelten nur für die im Seitenmenü gewählte Saison.",
              points: [
                { term: "Ein Teamwechsel", text: "wird hier eingetragen." },
                { term: "Nummer, Position und Stufe", text: "dürfen leer bleiben." },
              ],
            }}
          />
        </h2>
      </div>

      <div className={panel.body()}>
        {isMember ? (
          <>
            <div className={FIELD_PAIR}>
              <div className="flex w-full flex-col gap-y-1">
                <FieldLabel path="team_id">Team</FieldLabel>
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
                <FieldLabel path="nummer">Nummer</FieldLabel>
                <Input
                  placeholder="z.B. 7"
                  className={`${FIELD_INPUT} font-extrabold tracking-wider`}
                />
                <FieldError className={FIELD_ERROR}>
                  {/* Only the format, which is OUR rule. Every other flag keeps the browser's own sentence in the
                      reader's language, as `SaisonFormControls.tsx :: SaisonDateField` sets out. */}
                  {({ validationDetails, validationErrors }) =>
                    validationDetails.patternMismatch ? NUMMER_MUST_BE_DIGITS : validationErrors.join(" ")
                  }
                </FieldError>
              </TextField>
            </div>

            {/* A group rather than a switch, unlike `is_nachgetragen`: three states, and pressing the
                held one again is how a role is given up. Empty selection is the ordinary state. */}
            <TextField
              name="rolle"
              // The proxy is what makes a refusal land: `ToggleButtonGroup` takes no `name`, so it
              // joins no field context and `form.reportValidity()` cannot see the group.
              value={rolle ?? ""}
              onChange={() => undefined}
              className="flex w-full flex-col gap-y-1">
              <FieldLabel path="rolle">Rolle</FieldLabel>
              <ToggleButtonGroup
                aria-label="Rolle im Kader"
                size="sm"
                isDetached
                selectionMode="single"
                selectedKeys={rolle === null ? [] : [rolle]}
                onSelectionChange={(keys: Set<Key>) => {
                  const [picked] = [...keys].map(String);
                  onRolleChange(picked === undefined ? null : (picked as FLSpielerRolle));
                }}
                className={`flex w-full flex-row flex-wrap gap-2 ${TOGGLE_GROUP_ALIGN}`}>
                {ROLLE_OPTIONS.map((option) => (
                  <ToggleButton
                    key={option.value}
                    id={option.value}
                    // Disabled only where SOMEBODY ELSE holds it: the current holder has to be able to
                    // press it again to give it up.
                    isDisabled={heldRollen[option.value] !== undefined && rolle !== option.value}
                    className="border-border bg-surface hover:bg-hover fluid-sm data-selected:bg-brand-solid data-selected:text-brand-solid-foreground rounded-lg border px-3 py-2 font-medium transition-colors data-disabled:opacity-50">
                    {option.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>

              <Input className="hidden" />
              <FieldError className={FIELD_ERROR} />

              <InlineBanners
                banners={banners}
                spot="kader-rolle"
              />
            </TextField>

            <div className={FIELD_PAIR}>
              <div className="flex w-full flex-col gap-y-1">
                <FieldLabel path="position">Position</FieldLabel>
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
                <FieldLabel path="stufe">Stufe</FieldLabel>
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
