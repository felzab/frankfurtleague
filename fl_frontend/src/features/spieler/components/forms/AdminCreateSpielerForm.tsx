"use client";

import { FieldError, Input, Label, ListBox, Select, TextField } from "@heroui/react";

import { postSpielerAction } from "@/features/spieler/actions";
import { ClosedSetSelect } from "@/features/spieler/components/forms/ClosedSetSelect";
import { TeamSelect } from "@/features/spieler/components/forms/TeamSelect";
import { NUMMER_MAX_LENGTH, POSITION_OPTIONS } from "@/features/spieler/constants";
import { isSquadNummerTaken } from "@/features/spieler/utils";
import { EntityForm } from "@/shared/components/ui/EntityForm";
import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { SpielerCreateDraft, SpielerCreateSaisonOption } from "@/features/spieler/types";
import type { Key } from "@heroui/react";

const EMPTY_DRAFT_BASE = {
  vorname: "",
  nachname: null,
  team_id: null,
  nummer: null,
  position: null,
  stufe: null,
  // A new entry is never the captain: that is a decision about an existing squad, made on the
  // player's own page once they are in one.
  is_captain: false,
} as const;

/**
 * Creates the player AND puts them in a squad, in one submit.
 *
 * One form on purpose: every squad read is season-scoped with a strict junction join (I11), so a
 * player created without a junction row would be invisible to the very list this form sits on.
 *
 * **Running and planned seasons are both offered** (owner, 2026-08-07), which is where this differs
 * from the club create. A squad is filled in over time — a player joining mid-season is the normal
 * case rather than an exception — and `is_nachgetragen` is the field that records it. So the flag is
 * DERIVED from the chosen season's status rather than asked: picking a season already under way
 * marks the entry nachgetragen, and the form says so where the admin can see it.
 *
 * Only `vorname` is required. A surname, number, position and stufe may all arrive later, which is
 * what makes entering a whole team sheet quickly possible.
 */
export function AdminCreateSpielerForm({
  saisonOptions,
  defaultSaisonId,
  onClose,
}: {
  saisonOptions: SpielerCreateSaisonOption[];
  defaultSaisonId: string;
  onClose: () => void;
}) {
  return (
    <EntityForm<SpielerCreateDraft>
      initialDraft={{
        ...EMPTY_DRAFT_BASE,
        saison_id: defaultSaisonId,
        is_nachgetragen: saisonOptions.find((option) => option.saisonId === defaultSaisonId)?.isNachgetragen ?? false,
      }}
      renderFields={(draft, setDraft) => {
        const selectedOption = saisonOptions.find((option) => option.saisonId === draft.saison_id) ?? saisonOptions[0];
        const teams = selectedOption?.teams ?? [];

        // `stored` is null: this player has no squad row yet, so every number the form offers is one the
        // write would introduce (`REQ-SQUAD-002`). It re-answers when the season or the team changes,
        // because the same shirt is free in one squad and taken in another.
        const nummerIsTaken = isSquadNummerTaken({
          proposed: draft.nummer,
          stored: null,
          taken: teams.find((team) => team.teamId === draft.team_id)?.takenNummern ?? [],
        });

        return (
          <>
            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                isRequired
                name="vorname"
                value={draft.vorname}
                onChange={(next) => setDraft((current) => ({ ...current, vorname: next }))}>
                <Label className={FIELD_LABEL}>Vorname</Label>
                <Input className={FIELD_INPUT} />
                <FieldError className={FIELD_ERROR} />
              </TextField>

              {/* Required on the CREATE only (owner, 2026-08-07). The column stays nullable and the
                  patch payload still accepts null, because squads imported before this form existed
                  have surnameless rows — but a player entered here always has one. */}
              <TextField
                isRequired
                name="nachname"
                value={draft.nachname ?? ""}
                // Emptied means absent, not an empty surname — the boundary where `""` becomes null.
                onChange={(next) => setDraft((current) => ({ ...current, nachname: next.trim() === "" ? null : next }))}>
                <Label className={FIELD_LABEL}>Nachname</Label>
                <Input className={FIELD_INPUT} />
                <FieldError className={FIELD_ERROR} />
              </TextField>
            </div>

            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                isRequired
                name="saison_id"
                aria-label="Saison"
                value={draft.saison_id}
                onChange={(key: Key | null) => {
                  if (!key) return;
                  const nextSaisonId = key.toString();
                  const nextOption = saisonOptions.find((option) => option.saisonId === nextSaisonId);
                  setDraft((current) => ({
                    ...current,
                    saison_id: nextSaisonId,
                    // The flag follows the season, never the previous choice: it is that season's
                    // answer to "did this player arrive late", not a preference the admin carries.
                    is_nachgetragen: nextOption?.isNachgetragen ?? false,
                    // A team from another season must not ride along silently — the picker returns
                    // to "wählen" instead.
                    team_id:
                      current.team_id !== null && (nextOption?.teams ?? []).some((team) => team.teamId === current.team_id)
                        ? current.team_id
                        : null,
                    // Same rule for the level: a season that does not offer it must not carry it
                    // along silently, or the form would submit a value its own picker never showed.
                    stufe: current.stufe !== null && (nextOption?.erlaubteStufen ?? []).includes(current.stufe) ? current.stufe : null,
                  }));
                }}
                className="w-full">
                <Label className={FIELD_LABEL}>Saison</Label>
                <Select.Trigger className={`${FIELD_TRIGGER} w-full justify-between`}>
                  <span>Saison {draft.saison_id}</span>
                  <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
                </Select.Trigger>
                <FieldError className={FIELD_ERROR} />
                <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
                  <ListBox aria-label="Verfügbare Saisons">
                    {saisonOptions.map((option) => (
                      <ListBox.Item
                        key={option.saisonId}
                        id={option.saisonId}
                        textValue={`Saison ${option.saisonId}`}
                        className="text-foreground-muted hover:bg-muted hover:text-brand fluid-sm rounded-lg px-3 py-2.5 font-bold transition-colors duration-200">
                        Saison {option.saisonId}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>

              <TeamSelect
                isRequired
                value={draft.team_id}
                onChange={(teamId) => setDraft((current) => ({ ...current, team_id: teamId }))}
                teams={teams}
              />
            </div>

            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
              <TextField
                name="nummer"
                value={draft.nummer ?? ""}
                // Emptied means absent, not a number nobody wears — the same boundary rule as `nachname`.
                onChange={(next) => setDraft((current) => ({ ...current, nummer: next.trim() === "" ? null : next }))}
                maxLength={NUMMER_MAX_LENGTH}
                inputMode="numeric"
                pattern="[0-9]*">
                <Label className={FIELD_LABEL}>Nummer</Label>
                <Input className={`${FIELD_INPUT} font-extrabold tracking-wider`} />
                <FieldError className={FIELD_ERROR} />
                {/* One sentence about the value, which is the FIELD message shape — the remedy is this
                    input, and the endpoint's own refusal says the same words. */}
                {nummerIsTaken && <p className={FIELD_ERROR}>Diese Nummer trägt in diesem Kader schon jemand anderes.</p>}
              </TextField>

              <ClosedSetSelect
                value={draft.position}
                onChange={(position) => setDraft((current) => ({ ...current, position }))}
                options={POSITION_OPTIONS}
                name="position"
                label="Position"
                placeholder="Keine Angabe"
              />

              <ClosedSetSelect
                value={draft.stufe}
                onChange={(stufe) => setDraft((current) => ({ ...current, stufe }))}
                options={selectedOption?.erlaubteStufen ?? []}
                name="stufe"
                label="Stufe"
                placeholder="Keine Angabe"
              />
            </div>

            {draft.is_nachgetragen && (
              <p className="fluid-xxs text-foreground-muted font-medium">
                Die Saison {draft.saison_id} läuft bereits, der Eintrag wird deshalb als nachgetragen markiert.
              </p>
            )}
          </>
        );
      }}
      onSubmit={async (draft) => {
        // Submitted with `team_id` possibly still null: the action's schema refuses that with a
        // field message, so an untouched picker is a field error rather than a silently chosen team.
        const res = await postSpielerAction(draft);
        // A create only counts if the backend echoed the new id back.
        return { ...res, success: res.success && !!res.spieler_id };
      }}
      marksRequired
      successMessage="Spieler erfolgreich angelegt"
      onClose={onClose}
    />
  );
}
