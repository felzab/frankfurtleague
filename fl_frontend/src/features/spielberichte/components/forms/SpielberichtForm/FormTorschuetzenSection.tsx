"use client";

import { card } from "@/shared/components/ui/card";
import { useFieldStatus } from "@/shared/components/ui/DraftStatusContext";
import { FIELD_ERROR_CLASSES, FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { Switch } from "@/shared/components/ui/Switch";

import { TORSCHUETZE_UNBEKANNT_LABEL } from "../../../constants";
import { AuswahlSelect } from "./AuswahlSelect";
import { EntfernenButton, HinzufuegenButton, MinuteField, personOptionen, seitenOptionen } from "./eintragFelder";
import { UNBEKANNT } from "./spielberichtDraft";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLSpielberichtSeite } from "../../../schemas";
import type { SpielberichtFieldPath, SpielberichtKontext, TorschuetzeDraft } from "./spielberichtDraft";

/**
 * One entry per goal, „unbekannt“ at the head of every picker: the referee names a person or chooses not to, and
 * cannot leave the goal out. Entries are cards (`docs/frontend/spec.md :: I237`): a goal is a record.
 */
export function FormTorschuetzenSection({
  kontext,
  eintraege,
  onChange,
  onAdd,
  fieldErrors,
  onValidateFields,
}: {
  kontext: SpielberichtKontext;
  eintraege: readonly TorschuetzeDraft[];
  onChange: (next: readonly TorschuetzeDraft[]) => void;
  onAdd: () => void;
  fieldErrors: FieldErrors;
  onValidateFields: (paths: readonly string[]) => void;
}) {
  const panel = formPanel();
  const listStatus = useFieldStatus<SpielberichtFieldPath>("bericht.torschuetzen");

  const update = (key: number, change: Partial<TorschuetzeDraft>) =>
    onChange(eintraege.map((eintrag) => (eintrag.key === key ? { ...eintrag, ...change } : eintrag)));

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Torschützen">
          <Hint
            mode="reveal"
            label="Hinweis zu den Torschützen"
            body={{
              lead: "Für jedes Tor ein Eintrag.",
              points: [
                { term: "Unbekannt:", text: "weißt Du nicht, wer getroffen hat, wähle „unbekannt“." },
                { term: "Eigentor:", text: "trag das Team der Person ein, die getroffen hat. Das Tor zählt für das andere Team." },
              ],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {eintraege.length > 0 && (
          <ul
            aria-label="Torschützen"
            className="flex w-full flex-col gap-3">
            {eintraege.map((eintrag, index) => {
              const pfad = `bericht.torschuetzen.${String(index)}`;
              const wofuer = `Tor ${String(index + 1)}`;
              const optionen = personOptionen(kontext, eintrag.seite, eintrag.spieler === UNBEKANNT ? "" : eintrag.spieler);

              return (
                <li
                  key={eintrag.key}
                  className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
                  <div className="flex w-full flex-row items-center justify-between gap-3">
                    <span className="fluid-xs font-bold text-foreground">{wofuer}</span>
                    <EntfernenButton
                      wofuer={wofuer}
                      onPress={() => onChange(eintraege.filter((other) => other.key !== eintrag.key))}
                    />
                  </div>

                  <div className={FIELD_PAIR_CLASSES}>
                    <AuswahlSelect<FLSpielberichtSeite>
                      name={`${pfad}.seite`}
                      label="Team"
                      placeholder="Team wählen"
                      value={eintrag.seite}
                      options={seitenOptionen(kontext)}
                      // Another side's squad names other pupils, so a person picked for the first does not survive the switch.
                      onChange={(seite) =>
                        update(eintrag.key, seite === eintrag.seite ? {} : { seite, spieler: eintrag.spieler === UNBEKANNT ? UNBEKANNT : "" })
                      }
                      error={fieldErrors[`${pfad}.seite`]}
                    />
                    <AuswahlSelect<string>
                      name={`${pfad}.spieler_id`}
                      label="Spielerin oder Spieler"
                      placeholder={eintrag.seite === null ? "Zuerst das Team wählen" : "Person wählen"}
                      value={eintrag.spieler === "" ? null : eintrag.spieler}
                      options={[{ id: UNBEKANNT, label: TORSCHUETZE_UNBEKANNT_LABEL }, ...optionen]}
                      onChange={(spieler) => update(eintrag.key, { spieler })}
                      error={fieldErrors[`${pfad}.spieler_id`]}
                    />
                  </div>

                  <div className={FIELD_PAIR_CLASSES}>
                    <MinuteField
                      name={`${pfad}.minute`}
                      value={eintrag.minute}
                      onChange={(minute) => update(eintrag.key, { minute })}
                      onBlur={() => onValidateFields([`${pfad}.minute`])}
                    />
                    {/* The shared `Switch`: HeroUI's checkbox has no stylesheet in this tree and would render unstyled. */}
                    <div className="flex w-full flex-col justify-end">
                      <Switch
                        isSelected={eintrag.eigentor}
                        onChange={(eigentor) => update(eintrag.key, { eigentor })}>
                        <Switch.Content className={panel.switchContent()}>
                          Eigentor
                          <Switch.Control className={panel.switchControl()}>
                            <Switch.Thumb />
                          </Switch.Control>
                        </Switch.Content>
                      </Switch>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* The count rule's message: it is about the whole list, so it stands under the list rather than on an entry. */}
        {listStatus?.error !== undefined && listStatus.error !== null && <p className={FIELD_ERROR_CLASSES}>{listStatus.error}</p>}

        <HinzufuegenButton
          label="Tor hinzufügen"
          anzahl={eintraege.length}
          onPress={onAdd}
        />
      </div>
    </section>
  );
}
