"use client";

import { FieldError, Input, TextField } from "@heroui/react";

import { FIELD_ERROR, FIELD_INPUT } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";

import { SpielortFieldLabel } from "./SpielortFieldLabel";

/**
 * What the venue is called — the one field on this page a visitor actually reads, on every match card
 * held here.
 *
 * **The name fans out.** `PATCH /spielorte/{id}` rewrites the embedded `ort.name` on every Spiel at
 * this venue, and the derived `ort.maps_link` with it. The rail says so whenever the field is dirty.
 */
export function FormSpielortSection({
  name,
  onNameChange,
  onFieldLeft,
}: {
  name: string;
  onNameChange: (next: string) => void;
  onFieldLeft: (paths: readonly string[]) => void;
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Spielort
          <InfoHint label="Hinweis zum Namen">
            <p>Der Name, unter dem der Ort auf jeder Spielkarte steht.</p>
            <ul>
              <li>
                Eine Korrektur gilt <strong>für jedes Spiel hier</strong>, auch für längst gespielte.
              </li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        <TextField
          isRequired
          name="name"
          value={name}
          onChange={onNameChange}
          onBlur={() => onFieldLeft(["name"])}>
          <SpielortFieldLabel path="name">Name</SpielortFieldLabel>
          <Input
            placeholder="z.B. Sportpark Nord"
            className={FIELD_INPUT}
          />
          <FieldError className={FIELD_ERROR} />
        </TextField>
      </div>
    </section>
  );
}
