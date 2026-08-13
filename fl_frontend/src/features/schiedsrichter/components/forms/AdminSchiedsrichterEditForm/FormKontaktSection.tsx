"use client";

import { FieldError, Input, TextField } from "@heroui/react";

import { FIELD_ERROR, FIELD_INPUT } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";

import { SchiedsrichterFieldLabel } from "./SchiedsrichterFieldLabel";

import type { FLKontakt } from "@/shared/schemas";
import type { SchiedsrichterBanner } from "./banners";

/**
 * How to reach the referee. Both fields are optional and neither is public — the admin surface is the
 * only place either one is read.
 *
 * Each submits `null` when emptied. `FLKontaktSchema` accepts a blank string too, so the boundary is a
 * choice rather than a requirement: `null` is the one absent value, and two spellings of "nothing
 * recorded" would make the change list report an edit where nobody made one.
 */
export function FormKontaktSection({
  kontakt,
  onChange,
  onFieldLeft,
  banners,
}: {
  kontakt: FLKontakt;
  onChange: (next: FLKontakt) => void;
  onFieldLeft: (paths: readonly string[]) => void;
  /** The editor's whole Hinweis list; the spot below takes its own entry out of it. */
  banners: readonly SchiedsrichterBanner[];
}) {
  const panel = formPanel();

  const emptyAsNull = (value: string): string | null => (value.trim() === "" ? null : value);

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Kontakt
          <InfoHint label="Hinweis zum Kontakt">
            <p>Wie Du den Schiedsrichter erreichst.</p>
            <ul>
              <li>
                Beides ist <strong>freiwillig</strong> und steht auf keiner öffentlichen Seite.
              </li>
              <li>Über die Schiedsrichter-Liste kopierst Du Name, E-Mail und Telefon in einem Zug.</li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        <InlineBanners
          banners={banners}
          spot="kontakt"
        />

        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            type="email"
            name="kontakt.email"
            value={kontakt.email ?? ""}
            onChange={(next) => onChange({ ...kontakt, email: emptyAsNull(next) })}
            onBlur={() => onFieldLeft(["kontakt.email"])}>
            <SchiedsrichterFieldLabel path="kontakt.email">E-Mail</SchiedsrichterFieldLabel>
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
            <SchiedsrichterFieldLabel path="kontakt.telefon">Telefon</SchiedsrichterFieldLabel>
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
