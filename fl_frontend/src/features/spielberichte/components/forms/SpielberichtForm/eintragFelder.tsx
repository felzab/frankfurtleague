"use client";

import Plus from "@gravity-ui/icons/Plus";
import TrashBin from "@gravity-ui/icons/TrashBin";

import { Button } from "@heroui/react/button";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";

import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES, FIELD_LABEL_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { Hint } from "@/shared/components/ui/Hint";
import { TextField } from "@/shared/components/ui/TextField";
import { benannt } from "@/shared/utils/benannt";

import { SPIELBERICHT_EINTRAEGE_MAX } from "../../../constants";

import type { FLSpielberichtSeite } from "../../../schemas";
import type { Auswahl } from "./AuswahlSelect";
import type { KaderOption, SpielberichtKontext } from "./spielberichtDraft";

/** The two sides as a picker offers them, by the names the form's heading uses. */
export const seitenOptionen = (kontext: SpielberichtKontext): readonly Auswahl<FLSpielberichtSeite>[] => [
  { id: "team1", label: kontext.team1Name },
  { id: "team2", label: kontext.team2Name },
];

/**
 * The pupils one entry may name: that side's live squad, and the one it already names where the squad lacks them,
 * so a stored entry keeps its name rather than reading as unpicked.
 */
export function personOptionen(kontext: SpielberichtKontext, seite: FLSpielberichtSeite | null, gewaehlt: string): readonly KaderOption[] {
  if (seite === null) return [];

  const kader = kontext.kader[seite];
  if (gewaehlt === "" || kader.some((option) => option.id === gewaehlt)) return kader;

  const genannt = kontext.genannt.find((option) => option.id === gewaehlt);
  return genannt === undefined ? kader : [genannt, ...kader];
}

/** The chosen side fields no live squad, so its picker offers nobody new and the entry says why. */
export const ohneKader = (kontext: SpielberichtKontext, seite: FLSpielberichtSeite | null): boolean =>
  seite !== null && kontext.kader[seite].length === 0;

/**
 * The person picker's description, its notes joined, empty while none applies: one description slot per field, so two
 * notes are one text. `geleert` marks an entry whose stored person played for a club that has left the fixture.
 */
export function personHinweis({ geleert, ohneKaderSatz }: { geleert: boolean; ohneKaderSatz: string | null }): string {
  return [geleert ? "Die eingetragene Person spielt nicht für dieses Team. Wähle die Person neu." : null, ohneKaderSatz]
    .filter((satz): satz is string => satz !== null)
    .join(" ");
}

/** The minute box, its refusals arriving by `name` through the form's `validationErrors`. */
export function MinuteField({
  name,
  value,
  onChange,
  onBlur,
}: {
  name: string;
  value: string;
  onChange: (next: string) => void;
  onBlur: () => void;
}) {
  return (
    <TextField
      name={name}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      // No `inputMode`: `numeric` asks for digits alone, a keypad for PIN entry (WHATWG HTML, „input modalities“, read
      // 2026-10-20), and stoppage time needs its „+“, which only the full keyboard is certain to carry.
      className="flex w-full flex-col gap-y-1">
      <Label className={FIELD_LABEL_CLASSES}>Minute</Label>
      <Input
        placeholder="z.B. 23 oder 45+2"
        className={FIELD_INPUT_CLASSES}
      />
      <FieldError className={FIELD_ERROR_CLASSES} />
    </TextField>
  );
}

/** Removes one entry, named by its place in the list so a screen reader tells the presses apart. */
export function EntfernenButton({ wofuer, onPress }: { wofuer: string; onPress: () => void }) {
  return (
    <Button
      type="button"
      aria-label={benannt("Entfernen", wofuer)}
      onPress={onPress}
      className={`${formButton({ intent: "nav", size: "xs" })} shrink-0 gap-x-2`}>
      <TrashBin
        aria-hidden="true"
        className="size-3.5 shrink-0"
      />
      Entfernen
    </Button>
  );
}

/** Adds an entry until the list holds as many as the backend takes. */
export function HinzufuegenButton({ label, anzahl, onPress }: { label: string; anzahl: number; onPress: () => void }) {
  const voll = anzahl >= SPIELBERICHT_EINTRAEGE_MAX;

  return (
    <Hint
      mode="refusal"
      reason={voll ? `Mehr als ${String(SPIELBERICHT_EINTRAEGE_MAX)} Einträge nimmt ein Spielbericht nicht auf.` : null}
      label={label}>
      <Button
        type="button"
        variant="secondary"
        isDisabled={voll}
        onPress={onPress}
        className={`${formButton({ intent: "cancel", stacks: true })} gap-x-2`}>
        <Plus
          aria-hidden="true"
          className="size-4.5 shrink-0"
        />
        {label}
      </Button>
    </Hint>
  );
}
