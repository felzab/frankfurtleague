"use client";

import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";

import { AdresswechselHinweis } from "@/features/adresswechsel/components/ui/AdresswechselHinweis";
import { Angabe } from "@/shared/components/ui/Angabe";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES, FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { TextField } from "@/shared/components/ui/TextField";

import type { FLKontakt } from "@/core/generated/client/types";
import type { EinsehbarVerwehrt } from "@/features/adresswechsel/einsehbar";
import type { SchiedsrichterFieldPath } from "@/features/schiedsrichter/schiedsrichterDraftStatus";

/**
 * A confirmed referee's address, which the save refuses to move (`REQ-SCHIEDSRICHTER-011`): shown, with the
 * change pending at it, and changed nowhere on this page, as the pupil editor shows its own.
 */
export type BestaetigteAdresse = { email: string; adresswechselId: string | null; adresswechselVerwehrt: EinsehbarVerwehrt | null };

/**
 * Each field submits `null` when emptied. `FLKontakt` admits a blank string too, so this is
 * a choice: two spellings of "nothing recorded" would make the change list report an edit nobody
 * made.
 */
export function FormKontaktSection({
  kontakt,
  bestaetigt,
  onChange,
  onFieldLeft,
}: {
  kontakt: FLKontakt;
  /** Set for a confirmed referee, whose address the save does not carry. */
  bestaetigt: BestaetigteAdresse | null;
  onChange: (next: FLKontakt) => void;
  onFieldLeft: (paths: readonly string[]) => void;
}) {
  const panel = formPanel();

  const emptyAsNull = (value: string): string | null => (value.trim() === "" ? null : value);

  const telefon = (
    <TextField
      type="tel"
      name="kontakt.telefon"
      value={kontakt.telefon ?? ""}
      onChange={(next) => onChange({ ...kontakt, telefon: emptyAsNull(next) })}
      onBlur={() => onFieldLeft(["kontakt.telefon"])}>
      <FieldLabel<SchiedsrichterFieldPath> path="kontakt.telefon">Telefon</FieldLabel>
      <Input
        placeholder="z.B. 0151 12345678"
        className={FIELD_INPUT_CLASSES}
      />
      <FieldError className={FIELD_ERROR_CLASSES} />
    </TextField>
  );

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Kontakt">
          <Hint
            mode="reveal"
            label="Hinweis zum Kontakt"
            body={{
              lead: "Wie Du den Schiedsrichter erreichst.",
              points: [
                { term: "E-Mail und Telefon", text: "stehen auf keiner öffentlichen Seite." },
                // The one reason the address is required and the telephone is not, which no marker says.
                { term: "Über die E-Mail", text: "erfährt die Person, dass sie eingetragen ist." },
              ],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {bestaetigt === null ? (
          <div className={FIELD_PAIR_CLASSES}>
            <TextField
              type="email"
              name="kontakt.email"
              value={kontakt.email ?? ""}
              onChange={(next) => onChange({ ...kontakt, email: emptyAsNull(next) })}
              onBlur={() => onFieldLeft(["kontakt.email"])}>
              <FieldLabel<SchiedsrichterFieldPath> path="kontakt.email">E-Mail</FieldLabel>
              <Input
                placeholder="z.B. ref@beispiel.de"
                className={FIELD_INPUT_CLASSES}
              />
              <FieldError className={FIELD_ERROR_CLASSES} />
            </TextField>
            {telefon}
          </div>
        ) : (
          // The pupil editor's readout row and full-width hint (`FormAdresseSection.tsx`), the telephone on a row of its own.
          <>
            <dl className={FIELD_PAIR_CLASSES}>
              <Angabe label="Hinterlegte Adresse">{bestaetigt.email}</Angabe>
            </dl>
            <AdresswechselHinweis
              adresswechselId={bestaetigt.adresswechselId}
              verwehrt={bestaetigt.adresswechselVerwehrt}
            />
            <div className={FIELD_PAIR_CLASSES}>{telefon}</div>
          </>
        )}
      </div>
    </section>
  );
}
