import { useRef } from "react";

import { Xmark } from "@gravity-ui/icons";

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
 * same trust `teams.description` and a disqualification's `grund` already carry.
 */
export function FormNotizSection({
  notiz,
  onNotizChange,
  onValidateFields,
}: {
  notiz: string | null;
  onNotizChange: (value: string | null) => void;
  /** Judged when the field is left, like every other field on this page. */
  onValidateFields: (paths: readonly string[]) => void;
}) {
  const styles = formPanel();
  const status = useFieldStatus("notiz");
  const notizRef = useRef<HTMLTextAreaElement>(null);

  // Whitespace counts as empty, exactly as the `notiz` descriptor in
  // `fl_frontend/src/features/spiele/draftStatus.ts` reads it -- otherwise the button offers to remove
  // a note the change list already reports as absent.
  const hasNotiz = notiz !== null && notiz.trim() !== "";

  return (
    <section className={styles.root()}>
      <div className={styles.header()}>
        <h2 className={styles.heading()}>
          Notiz
          <InfoHint label="Hinweis zur Notiz">
            <p>Eine optionale Anmerkung zum Spiel, etwa besondere Momente oder Besonderheiten der Partie.</p>
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
            ref={notizRef}
            fullWidth
            placeholder="Öffentlich sichtbare Anmerkung zum Spiel"
            className="border-border bg-surface text-foreground fluid-sm min-h-24 rounded-lg border px-3 py-2 transition-colors outline-none"
          />
          <FieldError className={FIELD_ERROR}>{status?.error}</FieldError>

          {/* The row is reserved whether the button is in it or not: `hasNotiz` flips on the first
              character typed, and a control arriving then would push the panels below down the page
              — the shift `FieldLabel`'s own `min-h-5` reserve exists to stop. */}
          <div className="flex min-h-7 w-full flex-row items-center">
            {/* No confirmation: nothing is written until Speichern, so this is an ordinary draft edit
                — the same call `FormDateTimeSection.tsx :: ClearFieldButton` makes, and a plain button
                for the same reason. Labelled: a bare X reads only inside a field group. */}
            {hasNotiz && (
              <button
                type="button"
                onClick={() => {
                  // The focus move precedes the state change that unmounts this button: focus left on
                  // a removed element falls to <body>, and the next Tab restarts at the top of the page.
                  notizRef.current?.focus();
                  onNotizChange(null);
                }}
                className="border-border text-foreground-muted hover:border-danger/40 hover:text-danger-strong fluid-xxs flex h-7 shrink-0 cursor-pointer flex-row items-center gap-x-1.5 rounded-lg border px-2.5 font-bold transition-colors">
                <Xmark
                  aria-hidden="true"
                  className="size-3.5 shrink-0"
                />
                Notiz entfernen
              </button>
            )}
          </div>
        </TextField>
      </div>
    </section>
  );
}
