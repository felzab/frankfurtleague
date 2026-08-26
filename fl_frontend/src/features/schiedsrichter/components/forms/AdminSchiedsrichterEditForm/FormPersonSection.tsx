"use client";

import { FieldError, Input, TextField } from "@heroui/react";

import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_ERROR, FIELD_INPUT, FIELD_PAIR } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";

/**
 * The name fans out and the school does not: the patch rewrites the embedded `schiedsrichter.name`
 * on every Spiel naming this referee. `schule` submits `null` when emptied — an empty string would
 * be a school nobody attends.
 */
export function FormPersonSection({
  name,
  onNameChange,
  schule,
  onSchuleChange,
  onFieldLeft,
}: {
  name: string;
  onNameChange: (next: string) => void;
  schule: string | null;
  onSchuleChange: (next: string | null) => void;
  onFieldLeft: (paths: readonly string[]) => void;
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Person
          {/* The rename's consequence is the rail banner's, which fires the moment the name is edited. */}
          <Hint
            mode="reveal"
            label="Hinweis zu den Personendaten"
            body={{
              lead: "Wer der Schiedsrichter ist.",
              points: [{ term: "Der Name", text: "steht in jedem Spiel, für das er eingeteilt ist." }],
            }}
          />
        </h2>
      </div>

      <div className={panel.body()}>
        <div className={FIELD_PAIR}>
          <TextField
            isRequired
            name="name"
            value={name}
            onChange={onNameChange}
            onBlur={() => onFieldLeft(["name"])}>
            <FieldLabel path="name">Name</FieldLabel>
            <Input
              placeholder="z.B. Pierluigi Collina"
              className={FIELD_INPUT}
            />
            <FieldError className={FIELD_ERROR} />
          </TextField>

          <TextField
            name="schule"
            value={schule ?? ""}
            // Emptied means absent, not an empty school — the boundary where `""` becomes `null`.
            onChange={(next) => onSchuleChange(next.trim() === "" ? null : next)}
            onBlur={() => onFieldLeft(["schule"])}>
            <FieldLabel path="schule">Schule / Verein</FieldLabel>
            <Input
              placeholder="z.B. Goethe-Gymnasium"
              className={FIELD_INPUT}
            />
            <FieldError className={FIELD_ERROR} />
          </TextField>
        </div>
      </div>
    </section>
  );
}
