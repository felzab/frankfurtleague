"use client";

import { FieldError, Input, Label, NumberField, TextField } from "@heroui/react";

import { BEWERBUNG_KADER_GROESSE_MAX, BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH } from "@/features/bewerbungen/constants";
import { TrikotFarbeSelect } from "@/features/teams/components/forms/TrikotFarbeSelect";
import {
  FIELD_COUNT_INPUT,
  FIELD_ERROR,
  FIELD_GROUP,
  FIELD_INPUT,
  FIELD_LABEL,
  FIELD_PAIR,
  FORM_SECTION_HEADING,
} from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { enteredNumber } from "@/shared/utils/numberField";

import type { BewerbungFormDraft } from "@/features/bewerbungen/types";
import type { FLTrikotFarbe } from "@/features/teams/schemas";

/**
 * An emptied stepper reports `NaN`, so `null` carries an unanswered count. `isFinite` rather than
 * `!isNaN`: HeroUI types the handler `(value: number | undefined)`, and `Number.isNaN(undefined)`
 * is false, so `!isNaN` would store the gap as a number.
 */

/**
 * What the team brings and what it would like — the two blocks an acceptance reads but copies
 * nothing from. A wished colour is not an assignment, and a squad estimate binds nobody.
 */
export function FormTeamSection({
  trikot,
  kader,
  onTrikotChange,
  onKaderChange,
  onFieldLeft,
  onFarbePicked,
}: {
  trikot: BewerbungFormDraft["trikot"];
  kader: BewerbungFormDraft["kader"];
  onTrikotChange: (next: BewerbungFormDraft["trikot"]) => void;
  onKaderChange: (next: BewerbungFormDraft["kader"]) => void;
  onFieldLeft: (paths: readonly string[]) => void;
  /** Judged with the colour the event carried, because state has not committed yet. */
  onFarbePicked: (paths: readonly string[], trikot: BewerbungFormDraft["trikot"]) => void;
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Team
          <Hint
            mode="reveal"
            label="Hinweis zum Team"
            body={{
              lead: "Womit Dein Team antritt.",
              points: [{ term: "Die Kadergröße", text: "ist eine Schätzung und bindet Dich zu nichts." }],
            }}
          />
        </h2>
      </div>

      <div className={panel.body()}>
        <TextField
          name="trikot.vorhandener_satz"
          value={trikot.vorhandener_satz}
          onChange={(next) => onTrikotChange({ ...trikot, vorhandener_satz: next })}
          onBlur={() => onFieldLeft(["trikot.vorhandener_satz"])}>
          <Label className={FIELD_LABEL}>Vorhandene Trikotsätze</Label>
          <Input
            maxLength={BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH}
            placeholder="z.B. 15 rote Trikots aus dem Schulsport"
            className={FIELD_INPUT}
          />
          <FieldError className={FIELD_ERROR} />
        </TextField>

        <TrikotFarbeSelect
          isRequired
          label="Trikotfarbe-Wunsch"
          name="trikot.wunschfarbe"
          value={trikot.wunschfarbe}
          onChange={(wunschfarbe: FLTrikotFarbe | null) => {
            const next = { ...trikot, wunschfarbe };

            onTrikotChange(next);
            onFarbePicked(["trikot.wunschfarbe"], next);
          }}
        />

        <div className="border-border/60 flex w-full flex-col gap-y-4 border-t pt-4">
          <h3 className={FORM_SECTION_HEADING}>Kader</h3>

          <div className={FIELD_PAIR}>
            {/* `minValue` is the schema's own floor rather than a second judgement: a stepper offering
                a count the submit would send back is one that wasted the trip. */}
            <NumberField
              isRequired
              name="kader.voraussichtliche_groesse"
              minValue={1}
              maxValue={BEWERBUNG_KADER_GROESSE_MAX}
              value={kader.voraussichtliche_groesse ?? NaN}
              onChange={(next) => onKaderChange({ ...kader, voraussichtliche_groesse: enteredNumber(next) })}
              onBlur={() => onFieldLeft(["kader.voraussichtliche_groesse"])}>
              <Label className={FIELD_LABEL}>Voraussichtliche Kadergröße</Label>
              <NumberField.Group className={FIELD_GROUP}>
                <NumberField.DecrementButton />
                <NumberField.Input className={FIELD_COUNT_INPUT} />
                <NumberField.IncrementButton />
              </NumberField.Group>
              <FieldError className={FIELD_ERROR} />
            </NumberField>

            <NumberField
              isRequired
              name="kader.gute_spieler"
              minValue={0}
              // The squad above it, never past the league's own ceiling: `Math.min` COMPOSES the two, so an
              // untouched squad still caps at 200 and a squad of 500 is refused rather than offered.
              maxValue={Math.min(kader.voraussichtliche_groesse ?? BEWERBUNG_KADER_GROESSE_MAX, BEWERBUNG_KADER_GROESSE_MAX)}
              value={kader.gute_spieler ?? NaN}
              onChange={(next) => onKaderChange({ ...kader, gute_spieler: enteredNumber(next) })}
              onBlur={() => onFieldLeft(["kader.gute_spieler"])}>
              {/* The league plans the groups against this, so the bar it means is named in the label:
                  „im Verein“ alone was answered from breadth of membership rather than from level. */}
              <Label className={FIELD_LABEL}>Davon im Verein aktiv (mind. Verbandsliga)</Label>
              <NumberField.Group className={FIELD_GROUP}>
                <NumberField.DecrementButton />
                <NumberField.Input className={FIELD_COUNT_INPUT} />
                <NumberField.IncrementButton />
              </NumberField.Group>
              <FieldError className={FIELD_ERROR} />
            </NumberField>
          </div>
        </div>
      </div>
    </section>
  );
}
