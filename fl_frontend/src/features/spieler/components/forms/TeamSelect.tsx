"use client";

import { FieldError, Label, ListBox, Select } from "@heroui/react";

import { FIELD_ERROR, FIELD_LABEL, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { SpielerTeamOption } from "@/features/spieler/types";
import type { Key } from "@heroui/react";

/**
 * The team picker, shared by the create form and the squad editor.
 *
 * A picked control, judged on CHANGE (ADR-0040). It offers **the selected season's teams**, which is
 * what makes a transfer a two-click operation and what stops a player being put in a team that is not
 * in that season at all.
 *
 * **Nothing is disabled here, unlike `GruppeSelect`.** A squad has no capacity: a season's rules bound
 * how many teams a group holds, not how many players a team fields, so there is no full state to show
 * and no refusal for the trigger to anticipate.
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
  /** The message for a caller without a `<Form>` context — the same split as `GruppeSelect`. */
  error?: string;
  /** Off for the caller whose label is a marker-carrying `SpielerFieldLabel` rendered outside. */
  withOwnLabel?: boolean;
  /**
   * Refuse an empty pick, and let the BROWSER say so.
   *
   * react-aria runs native constraint validation on submit, so the message is the user agent's own
   * and arrives in the user's language — where letting the value reach the action instead surfaced
   * Zod's English "expected string, received null" (decided 2026-08-07). It also renders the required
   * asterisk, which `globals.css` then shows only inside a create form.
   */
  isRequired?: boolean;
}) {
  const handleChange = (key: Key | null) => {
    if (!key) return;
    onChange(key.toString());
  };

  // The id resolved to what the admin picked. A team the season does not offer still renders as
  // itself rather than as the placeholder — it is a real state, and an empty trigger would read as
  // "no team" instead.
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
              {/* The TeamCard's chip, so a Kürzel wears one tint across every surface that shows one. */}
              <span className="bg-brand/50 text-foreground fluid-xs inline-flex w-10 shrink-0 items-center justify-center rounded-md py-1 font-extrabold tracking-wide">
                {team.shorthand}
              </span>
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
