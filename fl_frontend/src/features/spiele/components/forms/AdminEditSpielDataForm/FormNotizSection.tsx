import { FieldError, TextArea, TextField } from "@heroui/react";

import { FIELD_ERROR } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";

import { useFieldStatus } from "./DraftStatusContext";
import { FieldLabel } from "./FieldLabel";

/**
 * The fixture's optional free-text note (roadmap item FE-2, decided 2026-08-02).
 *
 * **Its own panel, between Ergebnis and Absage.** The note is about the played game — exciting
 * moments, anything worth a sentence — but it must not sit inside the Ergebnis panel, whose fields
 * arm behind the deliberate unlock flip: a note is prose, not a score, and locking it would make
 * "add a sentence about the final" a two-step operation guarding against nothing.
 *
 * The text is public: it renders in the match details dialog every visitor can open, which is the
 * same trust `teams.description` and a disqualification's `grund` already carry (ADR-0059).
 */
export function FormNotizSection({
  notiz,
  onNotizChange,
  onValidateFields,
}: {
  notiz: string | null;
  onNotizChange: (value: string | null) => void;
  /** Judged when the field is left, like every other field on this page (ADR-0050). */
  onValidateFields: (paths: readonly string[]) => void;
}) {
  const styles = formPanel();
  const status = useFieldStatus("notiz");

  return (
    <section className={styles.root()}>
      <div className={styles.header()}>
        <h2 className={styles.heading()}>
          Notiz
          <InfoHint label="Hinweis zur Notiz">
            <p>Eine optionale Anmerkung zum Spiel — besondere Momente, Besonderheiten der Partie.</p>
            <ul>
              <li>
                Sie ist <strong>öffentlich</strong> und erscheint in den Spieldetails.
              </li>
              <li>Ein geleertes Feld entfernt die Notiz beim Speichern.</li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={styles.body()}>
        <TextField
          name="notiz"
          value={notiz ?? ""}
          // "" is held as null the moment it is typed, so the draft compares equal to a stored
          // fixture without a note and the discard guard stays quiet.
          onChange={(next) => onNotizChange(next === "" ? null : next)}
          onBlur={() => onValidateFields(["notiz"])}
          isInvalid={status?.error ? true : undefined}>
          <FieldLabel path="notiz">Notiz zum Spiel</FieldLabel>
          <TextArea
            fullWidth
            placeholder="Öffentlich sichtbare Anmerkung zum Spiel"
            className="border-border bg-surface text-foreground fluid-sm min-h-24 rounded-lg border px-3 py-2 transition-colors outline-none"
          />
          <FieldError className={FIELD_ERROR}>{status?.error}</FieldError>
        </TextField>
      </div>
    </section>
  );
}
