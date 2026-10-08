"use client";

import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { ToggleButton } from "@heroui/react/toggle-button";
import { ToggleButtonGroup } from "@heroui/react/toggle-button-group";

import { ClosedSetSelect } from "@/features/spieler/components/forms/ClosedSetSelect";
import { NummerField } from "@/features/spieler/components/forms/NummerField";
import { POSITION_OPTIONS, ROLLE_OPTIONS } from "@/features/spieler/constants";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_ERROR_CLASSES, FIELD_PAIR_CLASSES, TOGGLE_GROUP_ALIGN_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { TextField } from "@/shared/components/ui/TextField";

import type { FLSpielerPosition, FLSpielerRolle, FLSpielerStufe } from "@/features/spieler/schemas";
import type { Key } from "@heroui/react/rac";
import type { KaderZeileFieldPath } from "./kaderZeileDraftStatus";

/** Names the role chips for a screen reader, `ToggleButtonGroup` carrying its own role and no label element. */
const ROLLE_LABEL_ID = "kaderzeile-rolle";

/** The four fields a seat holder edits; the club is the address, so no picker offers another. */
export function FormKaderZeileSection({
  nummer,
  onNummerChange,
  position,
  onPositionChange,
  stufe,
  onStufeChange,
  stufeOptions,
  rolle,
  onRolleChange,
  heldRollen,
  onValidateFields,
}: {
  nummer: string;
  onNummerChange: (next: string) => void;
  position: FLSpielerPosition | null;
  onPositionChange: (next: FLSpielerPosition | null) => void;
  stufe: FLSpielerStufe | null;
  onStufeChange: (next: FLSpielerStufe | null) => void;
  /** What the season admits, plus the row's stored level where the season was narrowed after it: the write takes both. */
  stufeOptions: readonly FLSpielerStufe[];
  rolle: FLSpielerRolle | null;
  onRolleChange: (next: FLSpielerRolle | null) => void;
  /** Who else in the squad holds each role, so a role the write path would refuse is not offered. */
  heldRollen: Partial<Record<FLSpielerRolle, string>>;
  onValidateFields: (paths: readonly string[]) => void;
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Kadereintrag"
        />
      </div>

      <div className={panel.body()}>
        <NummerField
          label={<FieldLabel<KaderZeileFieldPath> path="nummer">Nummer</FieldLabel>}
          value={nummer}
          onChange={onNummerChange}
          onBlur={() => onValidateFields(["nummer"])}
        />

        {/* The proxy is what a refusal lands on: `ToggleButtonGroup` takes no `name`, and
            `focusFirstRefusal` finds a control by its `name` alone. */}
        <TextField
          name="rolle"
          value={rolle ?? ""}
          onChange={() => undefined}
          className="flex w-full flex-col gap-y-1">
          <FieldLabel<KaderZeileFieldPath> path="rolle">
            <span id={ROLLE_LABEL_ID}>Rolle</span>
          </FieldLabel>
          {/* A group rather than a switch: three states, and pressing the held one again gives a role up. */}
          <ToggleButtonGroup
            aria-labelledby={ROLLE_LABEL_ID}
            size="sm"
            isDetached
            selectionMode="single"
            selectedKeys={rolle === null ? [] : [rolle]}
            onSelectionChange={(keys: Set<Key>) => {
              const [picked] = [...keys].map(String);
              onRolleChange(picked === undefined ? null : (picked as FLSpielerRolle));
            }}
            className={`flex w-full flex-row flex-wrap gap-2 ${TOGGLE_GROUP_ALIGN_CLASSES}`}>
            {ROLLE_OPTIONS.map((option) => (
              <ToggleButton
                key={option.value}
                id={option.value}
                // Disabled only where somebody else holds it: the holder presses it again to give it up.
                isDisabled={heldRollen[option.value] !== undefined && rolle !== option.value}
                // The admin editor's chip, for the reason its own class string gives.
                className="rounded-lg border border-border bg-surface px-3 py-2 fluid-sm font-medium transition-colors data-disabled:opacity-50 data-hovered:bg-hover data-selected:bg-brand-solid data-selected:text-brand-solid-foreground data-selected:data-hovered:bg-brand-solid-hover">
                {option.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          <Input className="hidden" />
          <FieldError className={FIELD_ERROR_CLASSES} />
        </TextField>

        <div className={FIELD_PAIR_CLASSES}>
          <div className="flex w-full flex-col gap-y-1">
            <FieldLabel<KaderZeileFieldPath> path="position">Position</FieldLabel>
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
            <FieldLabel<KaderZeileFieldPath> path="stufe">Stufe</FieldLabel>
            <ClosedSetSelect
              value={stufe}
              onChange={onStufeChange}
              options={stufeOptions}
              name="stufe"
              label="Stufe"
              placeholder="Keine Angabe"
              withOwnLabel={false}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
