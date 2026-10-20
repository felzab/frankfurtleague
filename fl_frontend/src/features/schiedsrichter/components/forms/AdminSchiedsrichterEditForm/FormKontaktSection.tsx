"use client";

import { useState } from "react";

import Pencil from "@gravity-ui/icons/Pencil";

import { Button } from "@heroui/react/button";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";

import { ADRESSE_HINWEIS, AdresswechselBeantragen } from "@/features/konto/components/forms/AdresswechselBeantragen";
import { beantrageAdresswechselAction } from "@/features/schiedsrichter/actions";
import { FLSchiedsrichterAdresswechselPayloadSchema } from "@/features/schiedsrichter/schemas";
import { ADRESSE_AENDERN } from "@/features/spieler/constants";
import { Angabe } from "@/shared/components/ui/Angabe";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES, FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { TextField } from "@/shared/components/ui/TextField";
import { toFieldErrors } from "@/shared/utils/validation";

import type { AdresswechselFehler } from "@/features/konto/components/forms/AdresswechselBeantragen";
import type { SchiedsrichterFieldPath } from "@/features/schiedsrichter/schiedsrichterDraftStatus";
import type { FLKontakt } from "@/shared/schemas";

/**
 * A confirmed referee's address, which the save refuses to move (`REQ-SCHIEDSRICHTER-011`): shown, and
 * changed only through its own start, the pupil editor's shape.
 */
export type BestaetigteAdresse = {
  schiedsrichterId: string;
  email: string;
  /** The editor's unsaved draft, which the start re-keys the editor over. */
  isDirty: boolean;
  /** The box's typing, `null` while it is closed. */
  entwurf: string | null;
  onEntwurfChange: (next: string | null) => void;
};

/** The schema's own sentences for the box's two values, empty where it takes them. */
const urteil = (schiedsrichterId: string, email: string, grund: string | null): AdresswechselFehler => {
  const geprueft = FLSchiedsrichterAdresswechselPayloadSchema.safeParse({ id: schiedsrichterId, email: email, grund: grund });
  if (geprueft.success) return {};
  const fehler = toFieldErrors(geprueft.error);
  return { email: fehler.email, grund: fehler.grund };
};

/**
 * Each field submits `null` when emptied. `FLKontaktSchema` accepts a blank string too, so this is
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
  // Set by the press alone: a box the refresh remounts open takes no focus from wherever the reader is.
  const [perDruck, setPerDruck] = useState(false);

  const emptyAsNull = (value: string): string | null => (value.trim() === "" ? null : value);

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
        <div className={FIELD_PAIR_CLASSES}>
          {bestaetigt === null ? (
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
          ) : (
            <div className="flex flex-col gap-2">
              <dl>
                <Angabe label="Hinterlegte Adresse">{bestaetigt.email}</Angabe>
              </dl>
              <p className="muted-hint">{ADRESSE_HINWEIS}</p>
            </div>
          )}

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
        </div>

        {bestaetigt !== null && (
          <FocusSlot name="adresse-aendern">
            {bestaetigt.entwurf !== null ? (
              <AdresswechselBeantragen
                gespeicherteAdresse={bestaetigt.email}
                isDirty={bestaetigt.isDirty}
                entwurf={bestaetigt.entwurf}
                fokussieren={perDruck}
                schema={FLSchiedsrichterAdresswechselPayloadSchema}
                pruefe={(neu, grund) => urteil(bestaetigt.schiedsrichterId, neu, grund)}
                write={(neu, grund) => beantrageAdresswechselAction({ id: bestaetigt.schiedsrichterId, email: neu, grund: grund })}
                onEntwurfChange={bestaetigt.onEntwurfChange}
                onFertig={() => bestaetigt.onEntwurfChange(null)}
              />
            ) : (
              <div className="flex w-full flex-wrap items-start gap-2">
                <Button
                  type="button"
                  onPress={() => {
                    setPerDruck(true);
                    // Prefilled, because the commonest correction is one wrong character.
                    bestaetigt.onEntwurfChange(bestaetigt.email);
                  }}
                  className={`${formButton({ intent: "nav", size: "xs" })} gap-x-2`}>
                  <Pencil
                    className="size-3.5"
                    aria-hidden="true"
                  />
                  <span>{ADRESSE_AENDERN}</span>
                </Button>
              </div>
            )}
          </FocusSlot>
        )}
      </div>
    </section>
  );
}
