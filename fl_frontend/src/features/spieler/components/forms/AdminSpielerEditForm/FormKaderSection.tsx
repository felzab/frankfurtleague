"use client";

import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { ToggleButton } from "@heroui/react/toggle-button";
import { ToggleButtonGroup } from "@heroui/react/toggle-button-group";

import { SaisonBadge } from "@/features/saisons/components/ui/SaisonBadge";
import { ClosedSetSelect } from "@/features/spieler/components/forms/ClosedSetSelect";
import { NummerField } from "@/features/spieler/components/forms/NummerField";
import { KADER_ABSCHNITT, POSITION_OPTIONS, ROLLE_OPTIONS } from "@/features/spieler/constants";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_ERROR_CLASSES, FIELD_PAIR_CLASSES, TOGGLE_GROUP_ALIGN_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { TextField } from "@/shared/components/ui/TextField";
import { focusSection } from "@/shared/utils/focusAfterWrite";

import type { FLSpielerPosition, FLSpielerRolle, FLSpielerStufe } from "@/core/generated/client/types";
import type { SpielerFieldPath } from "@/features/spieler/spielerDraftStatus";
import type { SpielerSaisonContext } from "@/features/spieler/types";
import type { Key } from "@heroui/react/rac";
import type { SpielerBanner } from "./banners";

/** Names the role chips for a screen reader, `ToggleButtonGroup` carrying its own role and no label element. */
const ROLLE_LABEL_ID = "kader-rolle";

/** The squad row's own fields, a `future` season not being required: squads fill in over time. */
export function FormKaderSection({
  saison,
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
  banners,
}: {
  saison: SpielerSaisonContext & { erlaubteStufen: readonly FLSpielerStufe[] };
  nummer: string;
  onNummerChange: (next: string) => void;
  position: FLSpielerPosition | null;
  onPositionChange: (next: FLSpielerPosition | null) => void;
  stufe: FLSpielerStufe | null;
  onStufeChange: (next: FLSpielerStufe | null) => void;
  rolle: FLSpielerRolle | null;
  onRolleChange: (next: FLSpielerRolle | null) => void;
  /** Who holds each role in the row's team, so a role the write path would refuse is not offered. */
  heldRollen: Partial<Record<FLSpielerRolle, string>>;
  onValidateFields: (paths: readonly string[]) => void;
  banners: readonly SpielerBanner[];
}) {
  const panel = formPanel();

  return (
    <section
      className={panel.root()}
      {...focusSection("kader")}>
      {/* `relative` + an absolutely placed badge, so the h2 keeps every other panel heading's flow. */}
      <div className={`${panel.header()} relative`}>
        <span className="absolute top-1/2 right-4 -translate-y-1/2 sm:right-5">
          <SaisonBadge status={saison.saisonStatus} />
        </span>
        <PanelHeading
          className={panel.heading()}
          title={`${KADER_ABSCHNITT} ${saison.saisonId}`}>
          <Hint
            mode="reveal"
            label="Hinweis zum Kadereintrag"
            body={{ lead: "Diese Angaben gelten nur für die im Seitenmenü gewählte Saison." }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        <NummerField
          label={<FieldLabel<SpielerFieldPath> path="nummer">Nummer</FieldLabel>}
          value={nummer}
          onChange={onNummerChange}
          onBlur={() => onValidateFields(["nummer"])}
        />

        {/* A group rather than a switch: three states, and pressing the held one again is how a
            role is given up. Empty selection is the ordinary state. */}
        <TextField
          name="rolle"
          // The proxy is what makes a refusal land: `ToggleButtonGroup` takes no `name`, so it
          // joins no field context, and `focusFirstRefusal` finds a control by its `name` alone.
          value={rolle ?? ""}
          onChange={() => undefined}
          className="flex w-full flex-col gap-y-1">
          {/* A `Label` and not a plain span: it names the enclosing `TextField`, which carries no
              `aria-label`, so `useLabel` would warn without it. The id sits on the text alone, keeping
              the changed-field marker out of the group's name. */}
          <FieldLabel<SpielerFieldPath> path="rolle">
            <span id={ROLLE_LABEL_ID}>Rolle</span>
          </FieldLabel>
          {/* Named from the heading rather than by a wrapper: react-aria already renders
              `role="radiogroup"` here, so a second grouping element around it would nest one group in
              another and leave the chips with two accessible names. */}
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
                // Disabled only where SOMEBODY ELSE holds it: the current holder has to be able to
                // press it again to give it up.
                isDisabled={heldRollen[option.value] !== undefined && rolle !== option.value}
                // The selected arm takes a hover of its own because the two plain arms tie at
                // (0,2,0): without it the white label lands on grey, and source order decides.
                className="rounded-lg border border-border bg-surface px-3 py-2 fluid-sm font-medium transition-colors data-disabled:opacity-50 data-hovered:bg-hover data-selected:bg-brand-solid data-selected:text-brand-solid-foreground data-selected:data-hovered:bg-brand-solid-hover">
                {option.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          <Input className="hidden" />
          <FieldError className={FIELD_ERROR_CLASSES} />

          <InlineBanners
            banners={banners}
            spot="kader-rolle"
          />
        </TextField>

        <div className={FIELD_PAIR_CLASSES}>
          <div className="flex w-full flex-col gap-y-1">
            <FieldLabel<SpielerFieldPath> path="position">Position</FieldLabel>
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
            <FieldLabel<SpielerFieldPath> path="stufe">Stufe</FieldLabel>
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
      </div>
    </section>
  );
}
