"use client";

import { ComboBox, FieldError, Input, Label, ListBox, NumberField, TextField } from "@heroui/react";

import {
  BEWERBUNG_KADER_GROESSE_MAX,
  BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH,
  BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH,
} from "@/features/bewerbungen/constants";
import { TrikotFarbeSelect } from "@/features/teams/components/forms/TrikotFarbeSelect";
import {
  FIELD_COUNT_INPUT,
  FIELD_ERROR,
  FIELD_GROUP,
  FIELD_INPUT,
  FIELD_LABEL,
  FIELD_PAIR,
  FIELD_TRIGGER,
  FORM_SECTION_HEADING,
} from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { enteredNumber } from "@/shared/utils/numberField";

import { strongPlayerCeiling } from "./kaderBounds.ts";

import type { BewerbungFormDraft } from "@/features/bewerbungen/types";
import type { FLTrikotFarbe } from "@/features/teams/schemas";

/** `FormSchuleSection`'s club row, so the two lists of the league's schools read alike on one page. */
const SCHULE_ITEM = "fluid-xs data-hovered:bg-hover cursor-pointer rounded-lg px-3 py-2";

/**
 * What the team brings and what it would like — the two blocks an acceptance reads but copies
 * nothing from.
 */
export function FormTeamSection({
  trikot,
  kader,
  wunschgegner,
  schulen,
  vergebeneFarben,
  onTrikotChange,
  onKaderChange,
  onWunschgegnerChange,
  onFieldLeft,
  onFarbePicked,
}: {
  trikot: BewerbungFormDraft["trikot"];
  kader: BewerbungFormDraft["kader"];
  /** The opponent typed so far. `""` is a box nobody filled in; the payload spells that `null`. */
  wunschgegner: BewerbungFormDraft["wunschgegner"];
  /**
   * The clubs the league already holds, as SUGGESTIONS. The league's whole roster and never the
   * season's accepted teams: a set that grew with each acceptance would hand a school applying in
   * week four a longer list than the one applying in week one.
   */
  schulen: readonly { id: string; name: string }[];
  /** The colours an administrator has ASSIGNED this season, which the wish picker then leaves out. */
  vergebeneFarben: readonly FLTrikotFarbe[];
  onTrikotChange: (next: BewerbungFormDraft["trikot"]) => void;
  onKaderChange: (next: BewerbungFormDraft["kader"]) => void;
  onWunschgegnerChange: (next: BewerbungFormDraft["wunschgegner"]) => void;
  onFieldLeft: (paths: readonly string[]) => void;
  /** Judged with the colour the event carried, because state has not committed yet. */
  onFarbePicked: (paths: readonly string[], trikot: BewerbungFormDraft["trikot"]) => void;
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Team">
          <Hint
            mode="reveal"
            label="Hinweis zum Team"
            body={{
              lead: "Womit Dein Team antritt.",
              points: [
                { term: "Die Kadergröße", text: "ist eine Schätzung und bindet Dich zu nichts." },
                { term: "Den Wunschgegner", text: "kannst Du frei eintragen, auch eine Schule, die sich gerade erst bewirbt." },
              ],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        <TextField
          name="trikot.vorhandener_satz"
          value={trikot.vorhandener_satz}
          onChange={(next) => onTrikotChange({ ...trikot, vorhandener_satz: next })}
          onBlur={() => onFieldLeft(["trikot.vorhandener_satz"])}
          maxLength={BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH}>
          <Label className={FIELD_LABEL}>Vorhandene Trikotsätze</Label>
          <Input
            placeholder="z.B. 15 rote Trikots aus dem Schulsport"
            className={FIELD_INPUT}
          />
          <FieldError className={FIELD_ERROR} />
        </TextField>

        <TrikotFarbeSelect
          isRequired
          label="Trikotfarbe-Wunsch"
          name="trikot.wunschfarbe"
          // Read off `saison_teams.trikot_farbe` — colours an administrator ASSIGNED — and never off
          // another application's wish, which would carry one school's submission into this form.
          vergeben={vergebeneFarben}
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
              maxValue={strongPlayerCeiling(kader.voraussichtliche_groesse)}
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

        <div className="border-border/60 flex w-full flex-col border-t pt-4">
          {/* A ComboBox and not the `Autocomplete` the school picker uses: that one submits a KEY, and
              a wish is free text. `allowsCustomValue` is what makes the list a set of suggestions
              rather than the answer — a school may name one that has not applied yet. */}
          <ComboBox
            fullWidth
            allowsCustomValue
            name="wunschgegner"
            inputValue={wunschgegner}
            onInputChange={onWunschgegnerChange}
            // A TYPED field, so it is judged when it is left: a verdict between two keystrokes would
            // describe a name nobody has finished writing. `useComboBox` swallows the blur that moves
            // focus into the popover, so opening the list is not leaving the field.
            onBlur={() => onFieldLeft(["wunschgegner"])}>
            <Label className={FIELD_LABEL}>Wunschgegner für den ersten Spieltag</Label>
            <ComboBox.InputGroup>
              {/* `FIELD_TRIGGER` rather than `FIELD_INPUT`: the chevron is absolutely positioned over
                  the input's trailing edge, and HeroUI's own reservation for it is a `@layer
                  components` rule that `FIELD_INPUT`'s utility padding outranks. */}
              <Input
                placeholder="z.B. Goethe-Gymnasium"
                maxLength={BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH}
                className={FIELD_TRIGGER}
              />
              <ComboBox.Trigger />
            </ComboBox.InputGroup>
            <FieldError className={FIELD_ERROR} />

            <ComboBox.Popover className={overlayPanel()}>
              <ListBox
                aria-label="Schulen"
                className="p-1">
                {schulen.map((eintrag) => (
                  /* Keyed by the club's id because two schools may share a name, while what the
                     selection writes into the box is `textValue`: nothing of the id is stored. */
                  <ListBox.Item
                    key={eintrag.id}
                    id={eintrag.id}
                    textValue={eintrag.name}
                    className={SCHULE_ITEM}>
                    {eintrag.name}
                  </ListBox.Item>
                ))}
              </ListBox>
            </ComboBox.Popover>
          </ComboBox>
        </div>
      </div>
    </section>
  );
}
