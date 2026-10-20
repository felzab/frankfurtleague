"use client";

import { card } from "@/shared/components/ui/card";
import { FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

import { KARTEN_FARBE_LABELS, KARTEN_GRUND_LABELS } from "../../../constants";
import { AuswahlSelect } from "./AuswahlSelect";
import { EntfernenButton, HinzufuegenButton, MinuteField, personOptionen, seitenOptionen } from "./eintragFelder";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLKartenFarbe, FLKartenGrund, FLSpielberichtSeite } from "../../../schemas";
import type { KarteDraft, SpielberichtKontext } from "./spielberichtDraft";

const FARBE_OPTIONEN = (Object.keys(KARTEN_FARBE_LABELS) as FLKartenFarbe[]).map((farbe) => ({ id: farbe, label: KARTEN_FARBE_LABELS[farbe] }));
const KEIN_GRUND = "kein_grund";
const GRUND_OPTIONEN = (Object.keys(KARTEN_GRUND_LABELS) as FLKartenGrund[]).map((grund) => ({ id: grund, label: KARTEN_GRUND_LABELS[grund] }));

/** One entry per card, each with its reason from the closed list: a reason is chosen here and never retyped in the remarks. */
export function FormKartenSection({
  kontext,
  eintraege,
  onChange,
  onAdd,
  fieldErrors,
  onValidateFields,
}: {
  kontext: SpielberichtKontext;
  eintraege: readonly KarteDraft[];
  onChange: (next: readonly KarteDraft[]) => void;
  onAdd: () => void;
  fieldErrors: FieldErrors;
  onValidateFields: (paths: readonly string[]) => void;
}) {
  const panel = formPanel();

  const update = (key: number, change: Partial<KarteDraft>) =>
    onChange(eintraege.map((karte) => (karte.key === key ? { ...karte, ...change } : karte)));

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Karten">
          <Hint
            mode="reveal"
            label="Hinweis zu den Karten"
            body={{ lead: "Bei Gelb und Gelb-Rot wählst Du einen Grund, bei Rot ist er freiwillig." }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {eintraege.length > 0 && (
          <ul
            aria-label="Karten"
            className="flex w-full flex-col gap-3">
            {eintraege.map((karte, index) => {
              const pfad = `bericht.karten.${String(index)}`;
              const wofuer = `Karte ${String(index + 1)}`;

              return (
                <li
                  key={karte.key}
                  className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
                  <div className="flex w-full flex-row items-center justify-between gap-3">
                    <span className="fluid-xs font-bold text-foreground">{wofuer}</span>
                    <EntfernenButton
                      wofuer={wofuer}
                      onPress={() => onChange(eintraege.filter((other) => other.key !== karte.key))}
                    />
                  </div>

                  <div className={FIELD_PAIR_CLASSES}>
                    <AuswahlSelect<FLSpielberichtSeite>
                      name={`${pfad}.seite`}
                      label="Team"
                      placeholder="Team wählen"
                      value={karte.seite}
                      options={seitenOptionen(kontext)}
                      // Another side's squad names other pupils, so the person picked for the first does not survive the switch.
                      onChange={(seite) => update(karte.key, seite === karte.seite ? {} : { seite, spieler: "" })}
                      error={fieldErrors[`${pfad}.seite`]}
                    />
                    <AuswahlSelect<string>
                      name={`${pfad}.spieler_id`}
                      label="Spielerin oder Spieler"
                      placeholder={karte.seite === null ? "Zuerst das Team wählen" : "Person wählen"}
                      value={karte.spieler === "" ? null : karte.spieler}
                      options={personOptionen(kontext, karte.seite, karte.spieler)}
                      onChange={(spieler) => update(karte.key, { spieler })}
                      error={fieldErrors[`${pfad}.spieler_id`]}
                    />
                  </div>

                  <div className={FIELD_PAIR_CLASSES}>
                    <MinuteField
                      name={`${pfad}.minute`}
                      value={karte.minute}
                      onChange={(minute) => update(karte.key, { minute })}
                      onBlur={() => onValidateFields([`${pfad}.minute`])}
                    />
                    <AuswahlSelect<FLKartenFarbe>
                      name={`${pfad}.farbe`}
                      label="Farbe"
                      placeholder="Farbe wählen"
                      value={karte.farbe}
                      options={FARBE_OPTIONEN}
                      onChange={(farbe) => update(karte.key, { farbe })}
                      error={fieldErrors[`${pfad}.farbe`]}
                    />
                  </div>

                  <AuswahlSelect<FLKartenGrund | typeof KEIN_GRUND>
                    name={`${pfad}.grund`}
                    label="Grund"
                    placeholder="Grund wählen"
                    value={karte.grund ?? (karte.farbe === "rot" ? KEIN_GRUND : null)}
                    // Red alone may stand without a reason, so only it offers the way back to none.
                    options={karte.farbe === "rot" ? [{ id: KEIN_GRUND, label: "Kein Grund" }, ...GRUND_OPTIONEN] : GRUND_OPTIONEN}
                    onChange={(grund) => update(karte.key, { grund: grund === KEIN_GRUND ? null : grund })}
                    error={fieldErrors[`${pfad}.grund`]}
                  />
                </li>
              );
            })}
          </ul>
        )}

        <HinzufuegenButton
          label="Karte hinzufügen"
          anzahl={eintraege.length}
          onPress={onAdd}
        />
      </div>
    </section>
  );
}
