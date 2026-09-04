"use client";

import { FieldError, Input, Label, TextField, ToggleButton, ToggleButtonGroup } from "@heroui/react";

import { TRAINER_ZUGLEICH_FRAGE, TRAINER_ZUGLEICH_OPTIONS } from "@/features/teams/constants";
import { FIELD_ERROR, FIELD_LABEL, TOGGLE_GROUP_ALIGN } from "@/shared/components/ui/formFieldStyles";
import { OPTION_CHIP } from "@/shared/components/ui/optionChip";

import type { FLTrainerZugleich } from "@/features/teams/schemas";
import type { Key } from "@heroui/react";
import type { ReactNode } from "react";

/**
 * One question with three answers rather than a tick per seat: one person cannot hold both, and a
 * control offering that asks for a block `FLSaisonTeamKontaktePayload` has no way to spell.
 */
export function TrainerZugleichPicker({
  value,
  onPick,
  labelSlot,
}: {
  /** `undefined` is a question nobody has answered yet; `null` is the answer „Eine andere Person“. */
  value: FLTrainerZugleich | null | undefined;
  onPick: (seat: FLTrainerZugleich | null) => void;
  /** The admin editor's marker-carrying `FieldLabel`; the public form takes the plain default. */
  labelSlot?: ReactNode;
}) {
  return (
    // `ToggleButtonGroup` takes no `name`, so this proxy field is what names it: it is the control a
    // refusal on the path reaches, and the hidden `Input` is what puts the name in `form.elements`.
    <TextField
      name="kontakte.trainer_ist_zugleich"
      value={value ?? ""}
      onChange={() => undefined}
      className="flex w-full flex-col gap-y-1">
      {/* A `Label` and not a plain span: it names the enclosing `TextField`, which carries no
          `aria-label`, so `useLabel` would warn without it. */}
      {labelSlot ?? <Label className={FIELD_LABEL}>{TRAINER_ZUGLEICH_FRAGE}</Label>}
      <ToggleButtonGroup
        // The question itself and never the label's id: the admin's `labelSlot` carries a
        // changed-field marker beside the text, which is no part of what this group is called.
        aria-label={TRAINER_ZUGLEICH_FRAGE}
        size="sm"
        isDetached
        selectionMode="single"
        // Never on a question still unanswered: the public form opens with no chip pressed, and a
        // group that refuses an empty selection would show one answer as though it had been given.
        disallowEmptySelection={value !== undefined}
        selectedKeys={value === undefined ? [] : [TRAINER_ZUGLEICH_OPTIONS.find((option) => option.value === value)?.key ?? "niemand"]}
        onSelectionChange={(keys: Set<Key>) => {
          const [picked] = [...keys].map(String);
          const option = TRAINER_ZUGLEICH_OPTIONS.find((candidate) => candidate.key === picked);
          if (option !== undefined) onPick(option.value);
        }}
        className={`flex w-full flex-row flex-wrap gap-2 ${TOGGLE_GROUP_ALIGN}`}>
        {TRAINER_ZUGLEICH_OPTIONS.map((option) => (
          <ToggleButton
            key={option.key}
            id={option.key}
            className={OPTION_CHIP}>
            {option.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Input className="hidden" />
      <FieldError className={FIELD_ERROR} />
    </TextField>
  );
}
