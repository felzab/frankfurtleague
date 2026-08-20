"use client";

import { FieldError, Input, TextField } from "@heroui/react";

import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_ERROR, FIELD_INPUT } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";

/**
 * The name fans out: the patch rewrites the embedded `ort.name` on every Spiel at this venue, and
 * the derived `ort.maps_link` with it.
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
          <FieldLabel path="name">Name</FieldLabel>
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
