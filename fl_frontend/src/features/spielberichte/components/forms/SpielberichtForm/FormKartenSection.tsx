"use client";

import { useId } from "react";

import { card } from "@/shared/components/ui/card";
import { FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

import { CARD_COLOUR_LABELS, CARD_REASON_LABELS } from "../../../constants";
import { gruendeErlassen } from "../../../schemas";
import { AuswahlSelect } from "./AuswahlSelect";
import { EntfernenButton, HinzufuegenButton, MinuteField, ohneKader, personHinweis, personOptionen, seitenOptionen } from "./eintragFelder";

import type { FLCardColour, FLCardReason, FLSpielSide } from "@/core/generated/client/types";
import type { FieldErrors } from "@/shared/utils/validation";
import type { KartenSchluessel } from "../../../schemas";
import type { KarteDraft, SpielberichtKontext } from "./spielberichtDraft";

const FARBE_OPTIONEN = (Object.keys(CARD_COLOUR_LABELS) as FLCardColour[]).map((farbe) => ({ id: farbe, label: CARD_COLOUR_LABELS[farbe] }));
const KEIN_GRUND = "kein_grund";
const GRUND_OPTIONEN = (Object.keys(CARD_REASON_LABELS) as FLCardReason[]).map((grund) => ({ id: grund, label: CARD_REASON_LABELS[grund] }));

/** One entry per card, each with its reason from the closed list: a reason is chosen here and never retyped in the remarks. */
export function FormKartenSection({
  kontext,
  eintraege,
  onChange,
  onAdd,
  fieldErrors,
  onValidateFields,
  geleert,
  bestand,
}: {
  kontext: SpielberichtKontext;
  eintraege: readonly KarteDraft[];
  onChange: (next: readonly KarteDraft[]) => void;
  onAdd: () => void;
  fieldErrors: FieldErrors;
  onValidateFields: (paths: readonly string[]) => void;
  /** The entries whose person the form took out on opening (`eroeffnungOf`). */
  geleert: ReadonlySet<number>;
  /** The stored report's cards, whose stripped cautions owe no reason again. */
  bestand: readonly KartenSchluessel[];
}) {
  const panel = formPanel();
  const titelId = useId();
  const erlassen = gruendeErlassen(
    bestand,
    eintraege.map((karte) => ({ ...karte, spieler_id: karte.spieler })),
  );

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
                <li key={karte.key}>
                  {/* Each entry repeats „Team“, „Minute“ and the rest: a group named by its title qualifies them (W3C ARIA17). */}
                  <div
                    role="group"
                    aria-labelledby={`${titelId}-${String(karte.key)}`}
                    className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
                    <div className="flex w-full flex-row items-center justify-between gap-3">
                      <span
                        id={`${titelId}-${String(karte.key)}`}
                        className="fluid-xs font-bold text-foreground">
                        {wofuer}
                      </span>
                      <EntfernenButton
                        wofuer={wofuer}
                        onPress={() => onChange(eintraege.filter((other) => other.key !== karte.key))}
                      />
                    </div>

                    <div className={FIELD_PAIR_CLASSES}>
                      <AuswahlSelect<FLSpielSide>
                        name={`${pfad}.side`}
                        label="Team"
                        placeholder="Team wählen"
                        value={karte.side}
                        options={seitenOptionen(kontext)}
                        // Another side's squad names other pupils, so the person picked for the first does not survive the switch.
                        onChange={(seite) => update(karte.key, seite === karte.side ? {} : { side: seite, spieler: "" })}
                        error={fieldErrors[`${pfad}.side`]}
                      />
                      <AuswahlSelect<string>
                        name={`${pfad}.spieler_id`}
                        label="Spielerin oder Spieler"
                        placeholder={karte.side === null ? "Zuerst das Team wählen" : "Person wählen"}
                        value={karte.spieler === "" ? null : karte.spieler}
                        options={personOptionen(kontext, karte.side, karte.spieler)}
                        onChange={(spieler) => update(karte.key, { spieler })}
                        error={fieldErrors[`${pfad}.spieler_id`]}
                        hint={personHinweis({
                          geleert: geleert.has(karte.key) && karte.spieler === "",
                          ohneKaderSatz: ohneKader(kontext, karte.side)
                            ? "Für dieses Team ist kein Kader hinterlegt. Beschreib die Karte dann in den Bemerkungen mit der Rückennummer."
                            : null,
                        })}
                      />
                    </div>

                    <div className={FIELD_PAIR_CLASSES}>
                      <MinuteField
                        name={`${pfad}.minute`}
                        value={karte.minute}
                        onChange={(minute) => update(karte.key, { minute })}
                        onBlur={() => onValidateFields([`${pfad}.minute`])}
                      />
                      <AuswahlSelect<FLCardColour>
                        name={`${pfad}.colour`}
                        label="Farbe"
                        placeholder="Farbe wählen"
                        value={karte.colour}
                        options={FARBE_OPTIONEN}
                        onChange={(farbe) => update(karte.key, { colour: farbe })}
                        error={fieldErrors[`${pfad}.colour`]}
                      />
                    </div>

                    <AuswahlSelect<FLCardReason | typeof KEIN_GRUND>
                      name={`${pfad}.reason`}
                      label="Grund"
                      placeholder="Grund wählen"
                      value={karte.reason ?? (karte.colour === "rot" ? KEIN_GRUND : null)}
                      // Red alone may stand without a reason, so only it offers the way back to none.
                      options={karte.colour === "rot" ? [{ id: KEIN_GRUND, label: "Kein Grund" }, ...GRUND_OPTIONEN] : GRUND_OPTIONEN}
                      onChange={(grund) => update(karte.key, { reason: grund === KEIN_GRUND ? null : grund })}
                      error={fieldErrors[`${pfad}.reason`]}
                      // Marked by hand: a caution's reason is refused empty over the whole list
                      // (`fl_frontend/src/features/spielberichte/schemas.ts :: spielberichtFormSchema`), the leaf taking `null`
                      // for a red and for a caution a stripped card of the stored report excuses.
                      isRequired={(karte.colour === "gelb" || karte.colour === "gelb_rot") && !erlassen[index]}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <HinzufuegenButton
          label="Karte hinzufügen"
          count={eintraege.length}
          onPress={onAdd}
        />
      </div>
    </section>
  );
}
