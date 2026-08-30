"use client";

import { FieldError, Input, TextField } from "@heroui/react";

import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_ERROR, FIELD_INPUT, FIELD_PAIR } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

import type { FLKontakt } from "@/shared/schemas";

/**
 * Each field submits `null` when emptied. `FLKontaktSchema` accepts a blank string too, so this is
 * a choice: two spellings of "nothing recorded" would make the change list report an edit nobody
 * made.
 */
export function FormKontaktSection({
  kontakt,
  onChange,
  onFieldLeft,
}: {
  kontakt: FLKontakt;
  onChange: (next: FLKontakt) => void;
  onFieldLeft: (paths: readonly string[]) => void;
}) {
  const panel = formPanel();

  const emptyAsNull = (value: string): string | null => (value.trim() === "" ? null : value);

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Kontakt">
          {/* That both fields are optional is said by the missing required marker. */}
          <Hint
            mode="reveal"
            label="Hinweis zum Kontakt"
            body={{
              lead: "Wie Du den Schiedsrichter erreichst.",
              points: [{ term: "E-Mail und Telefon", text: "stehen auf keiner öffentlichen Seite." }],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        <div className={FIELD_PAIR}>
          <TextField
            type="email"
            name="kontakt.email"
            value={kontakt.email ?? ""}
            onChange={(next) => onChange({ ...kontakt, email: emptyAsNull(next) })}
            onBlur={() => onFieldLeft(["kontakt.email"])}>
            <FieldLabel path="kontakt.email">E-Mail</FieldLabel>
            <Input
              placeholder="z.B. ref@beispiel.de"
              className={FIELD_INPUT}
            />
            <FieldError className={FIELD_ERROR} />
          </TextField>

          <TextField
            type="tel"
            name="kontakt.telefon"
            value={kontakt.telefon ?? ""}
            onChange={(next) => onChange({ ...kontakt, telefon: emptyAsNull(next) })}
            onBlur={() => onFieldLeft(["kontakt.telefon"])}>
            <FieldLabel path="kontakt.telefon">Telefon</FieldLabel>
            <Input
              placeholder="z.B. 0151 12345678"
              className={FIELD_INPUT}
            />
            <FieldError className={FIELD_ERROR} />
          </TextField>
        </div>
      </div>
    </section>
  );
}
