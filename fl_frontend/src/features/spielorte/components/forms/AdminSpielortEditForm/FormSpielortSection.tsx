"use client";

import { FieldError, Input, TextField } from "@heroui/react";

import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_ERROR, FIELD_INPUT } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

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
        <PanelHeading
          className={panel.heading()}
          title="Spielort">
          <Hint
            mode="reveal"
            label="Hinweis zum Namen"
            body={{ lead: "So heißt der Ort bei jedem Spiel." }}
          />
        </PanelHeading>
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
