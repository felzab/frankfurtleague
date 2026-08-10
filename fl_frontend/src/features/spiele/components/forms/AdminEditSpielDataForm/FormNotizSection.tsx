import { useRef } from "react";

import { Xmark } from "@gravity-ui/icons";

import { Button, FieldError, TextArea, TextField } from "@heroui/react";

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
 * same trust `teams.description` and a disqualification's `grund` already carry (ADR-0047).
 */
export function FormNotizSection({
  notiz,
  onNotizChange,
  onValidateFields,
}: {
  notiz: string | null;
  onNotizChange: (value: string | null) => void;
  /** Judged when the field is left, like every other field on this page (ADR-0040). */
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
            ref={notizRef}
            fullWidth
            placeholder="Öffentlich sichtbare Anmerkung zum Spiel"
            className="border-border bg-surface text-foreground fluid-sm min-h-24 rounded-lg border px-3 py-2 transition-colors outline-none"
          />
          <FieldError className={FIELD_ERROR}>{status?.error}</FieldError>
        </TextField>

        {/* No confirmation, here or anywhere on this page: the fifteen-second undo after a save is the
            offer, and the two are alternatives (ADR-0041). Labelled rather than a bare X, which reads
            unambiguously only inside a field group. */}
        {hasNotiz && (
          <Button
            type="button"
            variant="ghost"
            onPress={() => {
              onNotizChange(null);
              // Before React unmounts this button with the value it just cleared, or focus falls to
              // <body> and the next Tab restarts at the top of the page.
              notizRef.current?.focus();
            }}
            className="border-border text-foreground-muted hover:border-danger/40 hover:text-danger-strong fluid-xxs flex h-7 shrink-0 cursor-pointer flex-row items-center gap-x-1.5 self-start rounded-lg border px-2.5 font-bold transition-colors">
            <Xmark
              aria-hidden="true"
              className="size-3.5 shrink-0"
            />
            Notiz entfernen
          </Button>
        )}
      </div>
    </section>
  );
}
