"use client";

import { FieldError } from "@heroui/react/field-error";

import { SONDEREREIGNIS_LABELS } from "@/features/spiele/constants";
import { admitsShootOut } from "@/features/spiele/draftStatus";
import { useFieldStatus } from "@/shared/components/ui/DraftStatusContext";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import {
  FIELD_COUNT_INPUT_CLASSES,
  FIELD_ERROR_CLASSES,
  FIELD_GROUP_CLASSES,
  FIELD_PAIR_CLASSES,
} from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { NumberField } from "@/shared/components/ui/NumberField";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { Switch } from "@/shared/components/ui/Switch";

import { SPIELBERICHT_SONDEREREIGNIS_OPTIONS } from "../../../constants";
import { AuswahlSelect } from "./AuswahlSelect";

import type { FLSpielberichtSonderereignis } from "../../../schemas";
import type { SpielberichtDraft, SpielberichtFieldPath, SpielberichtKontext } from "./spielberichtDraft";

const TORE_PATHS = ["bericht.ergebnis_vorschlag.team1_tore", "bericht.ergebnis_vorschlag.team2_tore"] as const;
const ELFMETER_PATHS = ["bericht.ergebnis_vorschlag.elfmeterschiessen.team1", "bericht.ergebnis_vorschlag.elfmeterschiessen.team2"] as const;

/** „Keines“ as a picker row: no event is the ordinary match, offered beside the three rather than behind a switch. */
const KEINES = "keines";

/**
 * A side as `admitsShootOut` reads it, its count alone: the rule is the editor's, imported rather than restated, so
 * the form offers a shoot-out exactly where the administrator's save keeps one.
 */
const seiteMitToren = (tore: number | null) => ({ team_id: "", name: "", shorthand: "", tore });

export function FormVorschlagSection({
  kontext,
  draft,
  onChange,
  onValidateFields,
}: {
  kontext: SpielberichtKontext;
  draft: SpielberichtDraft;
  onChange: (next: Partial<SpielberichtDraft>) => void;
  onValidateFields: (paths: readonly string[]) => void;
}) {
  const panel = formPanel();
  const ereignisStatus = useFieldStatus<SpielberichtFieldPath>("bericht.ergebnis_vorschlag.sonderereignis");
  const elfmeterStatus = useFieldStatus<SpielberichtFieldPath>("bericht.ergebnis_vorschlag.elfmeterschiessen");

  const istNichtantreten = draft.sonderereignis === "nichtantreten_team1" || draft.sonderereignis === "nichtantreten_team2";
  const offersElfmeterschiessen = admitsShootOut(
    kontext.saisonPhase,
    seiteMitToren(draft.team1Tore),
    seiteMitToren(draft.team2Tore),
    draft.sonderereignis,
  );

  const setEreignis = (next: FLSpielberichtSonderereignis | typeof KEINES) => {
    const sonderereignis = next === KEINES ? null : next;
    // A no-show's result is the league's: the counts and the shoot-out go with the pick rather than riding into a
    // save that refuses them.
    const nichtantreten = sonderereignis === "nichtantreten_team1" || sonderereignis === "nichtantreten_team2";
    onChange(nichtantreten ? { sonderereignis, team1Tore: null, team2Tore: null, elfmeterschiessen: null } : { sonderereignis });
  };

  const setTore = (slot: "team1Tore" | "team2Tore") => (value: number | null) => {
    const next = { ...draft, [slot]: value };
    // Derived like the editor's: counts that stop being level drop the shoot-out they stop admitting.
    const admits = admitsShootOut(kontext.saisonPhase, seiteMitToren(next.team1Tore), seiteMitToren(next.team2Tore), next.sonderereignis);
    onChange(admits ? { [slot]: value } : { [slot]: value, elfmeterschiessen: null });
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Ergebnis">
          <Hint
            mode="reveal"
            label="Hinweis zum Ergebnis"
            body={{ lead: "Die Tore beider Teams, wie Du sie gezählt hast." }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        <AuswahlSelect<FLSpielberichtSonderereignis | typeof KEINES>
          name="bericht.ergebnis_vorschlag.sonderereignis"
          label="Besonderes Ereignis"
          placeholder="Keines"
          value={draft.sonderereignis ?? KEINES}
          options={[
            { id: KEINES, label: "Keines" },
            ...SPIELBERICHT_SONDEREREIGNIS_OPTIONS.map((ereignis) => ({ id: ereignis, label: SONDEREREIGNIS_LABELS[ereignis] })),
          ]}
          onChange={setEreignis}
          error={ereignisStatus?.error ?? undefined}
          ownLabel={<FieldLabel<SpielberichtFieldPath> path="bericht.ergebnis_vorschlag.sonderereignis">Besonderes Ereignis</FieldLabel>}
        />

        {istNichtantreten ? (
          <p className="muted-hint">Hat ein Team nicht angetreten, trägst Du keine Tore ein: das Ergebnis setzt die Liga.</p>
        ) : (
          <div className={FIELD_PAIR_CLASSES}>
            {(
              [
                { slot: "team1Tore", path: "bericht.ergebnis_vorschlag.team1_tore", name: kontext.team1Name, value: draft.team1Tore },
                { slot: "team2Tore", path: "bericht.ergebnis_vorschlag.team2_tore", name: kontext.team2Name, value: draft.team2Tore },
              ] as const
            ).map(({ slot, path, name, value }) => (
              <NumberField
                key={slot}
                minValue={0}
                name={path}
                value={value}
                onChange={setTore(slot)}
                onBlur={() => onValidateFields(TORE_PATHS)}>
                <FieldLabel<SpielberichtFieldPath> path={path}>Tore {name}</FieldLabel>
                <NumberField.Group className={FIELD_GROUP_CLASSES}>
                  <NumberField.DecrementButton />
                  <NumberField.Input className={FIELD_COUNT_INPUT_CLASSES} />
                  <NumberField.IncrementButton />
                </NumberField.Group>
                <FieldError className={FIELD_ERROR_CLASSES} />
              </NumberField>
            ))}
          </div>
        )}

        {offersElfmeterschiessen && (
          <div className="flex w-full flex-col gap-y-4">
            <Switch
              isSelected={draft.elfmeterschiessen !== null}
              onChange={(isSelected) => onChange({ elfmeterschiessen: isSelected ? { team1: null, team2: null } : null })}>
              <Switch.Content className={panel.switchContent()}>
                Im Elfmeterschießen entschieden
                <Switch.Control className={panel.switchControl()}>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>

            {draft.elfmeterschiessen !== null && (
              <div className={FIELD_PAIR_CLASSES}>
                {(
                  [
                    { slot: "team1", name: kontext.team1Name, value: draft.elfmeterschiessen.team1 },
                    { slot: "team2", name: kontext.team2Name, value: draft.elfmeterschiessen.team2 },
                  ] as const
                ).map(({ slot, name, value }) => (
                  <NumberField
                    key={slot}
                    minValue={0}
                    name={`bericht.ergebnis_vorschlag.elfmeterschiessen.${slot}`}
                    value={value}
                    onChange={(next) => onChange({ elfmeterschiessen: { team1: null, team2: null, ...draft.elfmeterschiessen, [slot]: next } })}
                    onBlur={() => onValidateFields(ELFMETER_PATHS)}>
                    <FieldLabel<SpielberichtFieldPath> path="bericht.ergebnis_vorschlag.elfmeterschiessen">{name}: Treffer</FieldLabel>
                    <NumberField.Group className={FIELD_GROUP_CLASSES}>
                      <NumberField.DecrementButton />
                      <NumberField.Input className={FIELD_COUNT_INPUT_CLASSES} />
                      <NumberField.IncrementButton />
                    </NumberField.Group>
                    <FieldError className={FIELD_ERROR_CLASSES} />
                  </NumberField>
                ))}
              </div>
            )}
            {elfmeterStatus?.error !== undefined && elfmeterStatus.error !== null && (
              <p className={FIELD_ERROR_CLASSES}>{elfmeterStatus.error}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
