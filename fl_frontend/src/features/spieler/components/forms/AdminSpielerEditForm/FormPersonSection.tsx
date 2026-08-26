"use client";

import { FieldError, Input, TextField } from "@heroui/react";

import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_ERROR, FIELD_INPUT, FIELD_PAIR } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";

import type { SpielerPersonFields } from "@/features/spieler/types";

/**
 * The person, and only the person: the two names that stay the same whatever squad they are in.
 * Nothing here is season-scoped and nothing fans out — a correction reaches every surface at once,
 * which is the opposite of a club rename.
 */
export function FormPersonSection({
  draft,
  onChange,
  onFieldLeft,
}: {
  draft: SpielerPersonFields;
  onChange: (updated: SpielerPersonFields) => void;
  onFieldLeft: (paths: readonly string[]) => void;
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Person
          <Hint
            mode="reveal"
            label="Hinweis zur Person"
            body={{
              lead: "Der Name gilt über alle Saisons hinweg.",
              points: [{ term: "Eine Korrektur", text: "ist sofort überall zu sehen." }],
            }}
          />
        </h2>
      </div>

      <div className={panel.body()}>
        <div className={FIELD_PAIR}>
          <TextField
            isRequired
            name="vorname"
            value={draft.vorname}
            onChange={(next) => onChange({ ...draft, vorname: next })}
            onBlur={() => onFieldLeft(["vorname"])}>
            <FieldLabel path="vorname">Vorname</FieldLabel>
            <Input
              placeholder="z.B. Lena"
              className={FIELD_INPUT}
            />
            <FieldError className={FIELD_ERROR} />
          </TextField>

          <TextField
            name="nachname"
            value={draft.nachname ?? ""}
            // Emptied means absent, not an empty surname — the boundary where `""` becomes `null`.
            onChange={(next) => onChange({ ...draft, nachname: next.trim() === "" ? null : next })}
            onBlur={() => onFieldLeft(["nachname"])}>
            <FieldLabel path="nachname">Nachname</FieldLabel>
            <Input
              placeholder="z.B. Meier"
              className={FIELD_INPUT}
            />
            <FieldError className={FIELD_ERROR} />
          </TextField>
        </div>
      </div>
    </section>
  );
}
