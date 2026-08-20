"use client";

import { FieldError, Label, ListBox, Select } from "@heroui/react";

import { SHORTHAND_CHIP } from "@/features/spieler/shorthandChip";
import { FIELD_ERROR, FIELD_LABEL, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { SpielerTeamOption } from "@/features/spieler/types";
import type { Key } from "@heroui/react";

/**
 * Offers **the selected season's teams**, which is what stops a player being put in a team that is
 * not in that season at all.
 *
 * Nothing is disabled, unlike `GruppeSelect`: a squad has no capacity to be full of.
 */
export function TeamSelect({
  value,
  onChange,
  teams,
  name = "team_id",
  error,
  withOwnLabel = true,
  isRequired = false,
}: {
  value: string | null;
  onChange: (teamId: string) => void;
  /** The selected season's teams — the caller names the season. */
  teams: readonly SpielerTeamOption[];
  /** The field's path in the enclosing payload, so `Form`'s `validationErrors` reach it by name. */
  name?: string;
  /**
   * A message this caller owns, shown over anything `Form`'s `validationErrors` hold for `name` — for
   * a caller with no `<Form>`, and for the entry control whose write is not the form's.
   */
  error?: string;
  /** Off for the caller whose label is a marker-carrying `FieldLabel` rendered outside. */
  withOwnLabel?: boolean;
  /**
   * Refuse an empty pick, and let the BROWSER say so — react-aria runs native constraint validation
   * on submit. Letting the value reach the action instead surfaced Zod's English
   * "expected string, received null".
   */
  isRequired?: boolean;
}) {
  const handleChange = (key: Key | null) => {
    if (!key) return;
    onChange(key.toString());
  };

  // A team the season does not offer still renders as itself — an empty trigger would read as
  // "no team", which is a different fact.
  const selected = teams.find((team) => team.teamId === value);

  return (
    <Select
      isRequired={isRequired}
      name={name}
      aria-label="Team"
      value={value ?? undefined}
      onChange={handleChange}
      isInvalid={error ? true : undefined}
      className="w-full">
      {withOwnLabel && <Label className={FIELD_LABEL}>Team</Label>}
      <Select.Trigger className={`${FIELD_TRIGGER} w-full justify-between`}>
        <span className={value ? "" : "text-foreground-muted"}>
          {value === null ? "Team wählen" : (selected?.name ?? "Team außerhalb dieser Saison")}
        </span>
        <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
      </Select.Trigger>
      <FieldError className={FIELD_ERROR}>{error}</FieldError>
      <Select.Popover className={`${overlayPanel()} mt-2 max-h-80 overflow-y-auto p-1.5`}>
        <ListBox aria-label="Teams dieser Saison">
          {teams.map((team) => (
            <ListBox.Item
              key={team.teamId}
              id={team.teamId}
              textValue={team.name}
              className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center justify-between gap-x-3 rounded-lg px-3 py-2.5 font-bold transition-colors duration-200">
              {team.name}
              {/* A declared fill, not an alpha: this row's hover is a ground an alpha would shift against. */}
              <span className={SHORTHAND_CHIP}>{team.shorthand}</span>
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
