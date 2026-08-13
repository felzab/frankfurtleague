"use client";

import { FieldError, Input, TextField } from "@heroui/react";

import { FIELD_ERROR, FIELD_INPUT } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";

import { SchiedsrichterFieldLabel } from "./SchiedsrichterFieldLabel";

/**
 * Who the referee is: the name every match card shows, and the school or club they come from.
 *
 * **The name fans out and the school does not**, which is the one thing worth knowing about this
 * panel. `PATCH /schiedsrichter/{id}` rewrites the embedded `schiedsrichter.name` on every Spiel that
 * names this referee; nothing else on this page reaches another document. The Hinweis at the rail
 * says so whenever the field is dirty.
 *
 * `schule` submits `null` when emptied rather than `""` — the column is nullable, and an empty string
 * would be a school nobody attends.
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
          <InfoHint label="Hinweis zu den Personendaten">
            <p>Wer der Schiedsrichter ist.</p>
            <ul>
              <li>
                Eine Korrektur gilt <strong>für jedes Spiel</strong>, das ihn nennt, auch für längst gespielte.
              </li>
              <li>Schule oder Verein ist freiwillig und steht auf keiner öffentlichen Seite.</li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            isRequired
            name="name"
            value={name}
            onChange={onNameChange}
            onBlur={() => onFieldLeft(["name"])}>
            <SchiedsrichterFieldLabel path="name">Name</SchiedsrichterFieldLabel>
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
            <SchiedsrichterFieldLabel path="schule">Schule / Verein</SchiedsrichterFieldLabel>
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
