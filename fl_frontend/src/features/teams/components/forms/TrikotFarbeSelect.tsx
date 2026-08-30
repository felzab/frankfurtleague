"use client";

import { FieldError, Label, ListBox, Select } from "@heroui/react";

import { TRIKOT_FARBE_OPTIONS, trikotFarbeHex, trikotFarbeLabel } from "@/features/teams/constants";
import { FIELD_ERROR, FIELD_LABEL, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { FLTrikotFarbe } from "@/features/teams/schemas";
import type { Key } from "@heroui/react";

/** The picker's key for the answer the field spells as `null`, a listbox having no empty item. */
const KEINE_FARBE = "keine";

/**
 * A ring rather than a filled disc, so Weiß reads as a colour on a light page instead of as a gap.
 * The fill is the league's CI hex, which no theme token tracks.
 */
function Swatch({ farbe }: { farbe: FLTrikotFarbe }) {
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: trikotFarbeHex(farbe) }}
      className="border-border size-4 shrink-0 rounded-full border shadow-sm"
    />
  );
}

/**
 * The season's kit colour for one club. Judged on CHANGE rather than on blur — a selection is
 * complete the moment it is made. Sixteen colours, in the CI document's order.
 */
export function TrikotFarbeSelect({
  value,
  onChange,
  name = "trikot_farbe",
  label = "Trikotfarbe",
  isRequired = false,
  withOwnLabel = true,
}: {
  value: FLTrikotFarbe | null;
  onChange: (farbe: FLTrikotFarbe | null) => void;
  /** The field's path in the enclosing payload, so `Form`'s `validationErrors` reach it by name. */
  name?: string;
  /**
   * What the control is called, visibly AND in its accessible name. One string for both, so a caller
   * renaming the field cannot leave the two disagreeing (WCAG 2.5.3).
   */
  label?: string;
  /**
   * Whether an answer is owed. On for the applicant's wish, off for the administrator's assignment,
   * which a club may genuinely stand without.
   */
  isRequired?: boolean;
  /** Off for the caller whose label is a marker-carrying `FieldLabel` rendered outside. */
  withOwnLabel?: boolean;
}) {
  /**
   * **A required picker offers no empty row.** A „Keine Angabe“ row carries a key, so picking it is
   * an answer: the field would count as filled while meaning the opposite. Without the row, nothing
   * picked stays `null`, which the submit refuses.
   */
  const leerschluessel = isRequired ? null : KEINE_FARBE;
  const platzhalter = isRequired ? "Bitte auswählen" : "Keine Angabe";

  const handleChange = (key: Key | null) => {
    if (key === null) return;
    onChange(key.toString() === KEINE_FARBE ? null : (key.toString() as FLTrikotFarbe));
  };

  return (
    <Select
      isRequired={isRequired}
      name={name}
      aria-label={label}
      value={value ?? leerschluessel}
      onChange={handleChange}
      className="w-full">
      {withOwnLabel && <Label className={FIELD_LABEL}>{label}</Label>}
      <Select.Trigger className={`${FIELD_TRIGGER} w-full justify-between`}>
        {/* From the prop, not `Select.Value` — the collection can lag a render behind and would then
            show HeroUI's English placeholder. */}
        <span className="flex min-w-0 flex-row items-center gap-x-2">
          {value !== null && <Swatch farbe={value} />}
          <span className={value ? "truncate" : "text-foreground-muted truncate"}>{value ? trikotFarbeLabel(value) : platzhalter}</span>
        </span>
        <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
      </Select.Trigger>
      <FieldError className={FIELD_ERROR} />
      <Select.Popover className={`${overlayPanel()} mt-2 max-h-80 overflow-y-auto p-1.5`}>
        <ListBox aria-label="Trikotfarben">
          {!isRequired && (
            <ListBox.Item
              id={KEINE_FARBE}
              textValue="Keine Angabe"
              className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center rounded-lg px-3 py-2.5 font-bold transition-colors duration-200">
              Keine Angabe
            </ListBox.Item>
          )}
          {TRIKOT_FARBE_OPTIONS.map((option) => (
            <ListBox.Item
              key={option.value}
              id={option.value}
              textValue={option.label}
              className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center gap-x-3 rounded-lg px-3 py-2.5 font-bold transition-colors duration-200">
              <Swatch farbe={option.value} />
              {option.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
