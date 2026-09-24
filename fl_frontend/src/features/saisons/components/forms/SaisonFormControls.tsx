"use client";

import { FieldError } from "@heroui/react/field-error";
import { ListBox } from "@heroui/react/list-box";
import { NumberField } from "@heroui/react/number-field";
import { Select } from "@heroui/react/select";

import { TIEBREAK_LADDER_TAIL, TIEBREAK_ORDER_OPTIONS, tiebreakLabel, tiebreakLadder } from "@/features/saisons/constants";
import {
  FIELD_COUNT_INPUT_CLASSES,
  FIELD_ERROR_CLASSES,
  FIELD_GROUP_CLASSES,
  FIELD_MARKER_CLASSES,
  FIELD_TRIGGER_CLASSES,
} from "@/shared/components/ui/formFieldStyles";
import { overlayPanel, SELECT_POPOVER_CLASSES } from "@/shared/components/ui/overlayPanel";
import { listboxRow, pickIfOffered } from "@/shared/components/ui/refusableOption";
import { enteredNumber } from "@/shared/utils/numberField";

import type { FLSaisonTiebreakOrder } from "@/features/saisons/schemas";
import type { RefusableOption } from "@/shared/components/ui/refusableOption";
import type { Key } from "@heroui/react/rac";
import type { ReactNode } from "react";

/**
 * An emptied box records `null`, never the floor: substituting `minValue` silently answers a question nobody
 * answered, and one group is not the same fact as no number entered.
 */
export function SaisonRuleNumberField({
  name,
  label,
  value,
  onChange,
  onBlur,
  minValue,
  maxValue,
  isReadOnly,
}: {
  /** The field's path in the payload, so `Form`'s `validationErrors` reach it by name. */
  name: string;
  label: ReactNode;
  value: number | null;
  onChange: (next: number | null) => void;
  onBlur?: () => void;
  minValue: number;
  maxValue?: number;
  /**
   * READ-ONLY rather than disabled: a disabled `NumberField` is skipped by keyboard navigation and
   * announced as unavailable, and it keeps the field in the form so the payload still carries the value
   * the freeze compares (`REQ-RULES-005`).
   */
  isReadOnly?: boolean;
}) {
  return (
    <NumberField
      isRequired
      name={name}
      minValue={minValue}
      maxValue={maxValue}
      value={value ?? Number.NaN}
      // Its dimming is `globals.css`'s, keyed on `[data-readonly="true"]`, so every frozen number
      // field in the product dims by the same amount — an `opacity-*` added here would double it.
      isReadOnly={isReadOnly}
      onChange={(next) => onChange(enteredNumber(next))}
      onBlur={onBlur}>
      {label}
      <NumberField.Group className={FIELD_GROUP_CLASSES}>
        <NumberField.DecrementButton />
        <NumberField.Input className={FIELD_COUNT_INPUT_CLASSES} />
        <NumberField.IncrementButton />
      </NumberField.Group>
      <FieldError className={FIELD_ERROR_CLASSES} />
    </NumberField>
  );
}

/**
 * `number_of_groups` and `qualifiers_per_group`, whose legal values SKIP: a floor and a ceiling can
 * only describe a set that skips by admitting the values between, which is the offer
 * `.claude/rules/cross-surface.md`'s **saisons** clause bars.
 */
export function SaisonCountSelect({
  name,
  label,
  ariaLabel,
  value,
  options,
  onChange,
  isDisabled,
}: {
  /** The field's path in the payload, so `Form`'s `validationErrors` reach it by name. */
  name: string;
  label: ReactNode;
  /** Names the popover's list, which inherits nothing from a label bound to the trigger. */
  ariaLabel: string;
  value: number;
  /** `fl_frontend/src/features/saisons/shapeOffer.ts` builds them; a closed row keeps its reason. */
  options: readonly RefusableOption[];
  onChange: (next: number) => void;
  /**
   * DISABLED where `SaisonRuleNumberField` is read-only: react-aria's `Select` has no read-only
   * state, and the payload is built from the caller's draft rather than from the DOM, so the frozen
   * value still rides along for the freeze to compare.
   */
  isDisabled?: boolean;
}) {
  const item = listboxRow();

  return (
    <Select
      isRequired
      name={name}
      isDisabled={isDisabled}
      value={String(value)}
      onChange={(key: Key | null) => {
        // The disabled flag alone does not stop a pick: react-aria's hidden native mirror renders a
        // refused row as a plain option, which is why `pickIfOffered` re-reads the refusal.
        const offered = pickIfOffered(options, key?.toString() ?? null);
        if (offered !== null) onChange(Number(offered));
      }}
      className="w-full">
      {label}
      <Select.Trigger className={`${FIELD_TRIGGER_CLASSES} w-full justify-between`}>
        {/* From the prop, not `Select.Value` — the collection can lag a render behind and would then
            show HeroUI's English placeholder. Same reasoning as `SaisonTiebreakSelect`'s trigger. */}
        <span>{String(value)}</span>
        <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
      </Select.Trigger>
      {/* Not `RefusableSelect`, which carries neither a `name` nor this: a shape refusal names a
          payload path, and the box holding it is where the message has to land. */}
      <FieldError className={FIELD_ERROR_CLASSES} />
      {/* `RefusableSelect`'s popover rather than `SELECT_POPOVER_CLASSES`, which pins the list to the trigger:
          in a third-width cell a note beside a one-character number would have nowhere to stand. */}
      <Select.Popover className={`${overlayPanel()} mt-2 max-h-72 overflow-y-auto p-1.5`}>
        <ListBox aria-label={ariaLabel}>
          {options.map((option) => (
            <ListBox.Item
              key={option.id}
              id={option.id}
              textValue={option.name}
              isDisabled={option.refusal !== null}
              className={item.row()}>
              <span className="min-w-0 truncate">{option.name}</span>
              {/* Visible and closed rather than dropped: a count legal beside another number is one the
                  reader may have just come from, and the note says which neighbour shut it. */}
              {option.refusal !== null && <span className={item.note()}>{option.refusal}</span>}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

/**
 * `rules.tiebreak_order`. **Nothing validates it as it is picked**: the closed set holds no value the
 * schema can refuse, so the only message it could ever carry is a server refusal, which `name` is what
 * delivers.
 */
export function SaisonTiebreakSelect({
  name,
  label,
  value,
  onChange,
  isDisabled,
}: {
  name: string;
  label: ReactNode;
  value: FLSaisonTiebreakOrder;
  onChange: (next: FLSaisonTiebreakOrder) => void;
  /**
   * DISABLED where `SaisonRuleNumberField` is read-only: react-aria's `Select` has no read-only
   * state, and the payload is built from the caller's draft rather than from the DOM, so the frozen
   * value still rides along for `REQ-RULES-005` to compare.
   */
  isDisabled?: boolean;
}) {
  const item = listboxRow({ layout: "plain" });

  return (
    <Select
      isRequired
      name={name}
      isDisabled={isDisabled}
      value={value}
      onChange={(key: Key | null) => {
        if (!key) return;
        onChange(key.toString() as FLSaisonTiebreakOrder);
      }}
      className="w-full">
      {label}
      <Select.Trigger className={`${FIELD_TRIGGER_CLASSES} w-full justify-between`}>
        {/* From the prop, not `Select.Value` — the collection can lag a render behind and would then
            show HeroUI's English placeholder. Same reasoning as `ClosedSetSelect`'s trigger. */}
        <span>{tiebreakLabel(value)}</span>
        <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
      </Select.Trigger>
      <FieldError className={FIELD_ERROR_CLASSES} />
      {/* Standing under the closed picker rather than in a hint: which figure leads is the whole of
          what this field decides, and the trigger shows only the criterion's name. */}
      <ol className="flex w-full flex-col gap-y-1">
        {/* The WHOLE chain, because the two options are the same three rungs in a different order, so
            a sentence naming only the leader leaves a reader comparing one word against one word. */}
        {tiebreakLadder(value).map((rung, index) => (
          // Keyed on the criterion, which appears once per chain.
          <li
            key={rung.label}
            className="flex w-full flex-row items-start gap-x-2">
            <span className={`${FIELD_MARKER_CLASSES} bg-muted text-foreground-muted fluid-xxs font-extrabold`}>{index + 1}</span>
            <span className="flex flex-col gap-y-0.5 pt-0.5">
              <span className="fluid-xxs text-foreground font-bold">{rung.label}</span>
              {rung.caveat !== null && <span className="fluid-xxs text-foreground-muted font-medium">{rung.caveat}</span>}
            </span>
          </li>
        ))}
      </ol>
      {/* Outside the list: the chain ENDS, and a fourth numbered rung would read as a fourth criterion. */}
      <p className="fluid-xxs text-foreground-muted font-medium">{TIEBREAK_LADDER_TAIL}</p>
      <Select.Popover className={SELECT_POPOVER_CLASSES}>
        <ListBox aria-label="Tiebreak auswählen">
          {TIEBREAK_ORDER_OPTIONS.map((option) => (
            // No description beside the label: the two names say exactly what differs between them,
            // and the chain each one produces stands under the trigger.
            <ListBox.Item
              key={option.value}
              id={option.value}
              textValue={option.label}
              className={item.row()}>
              {option.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
