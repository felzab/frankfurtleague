import { useRef } from "react";

import { Xmark } from "@gravity-ui/icons";

import { FieldError, TextArea, TextField } from "@heroui/react";

import { NOTIZ_MAX_LENGTH } from "@/features/spiele/constants";
import { useFieldStatus } from "@/shared/components/ui/DraftStatusContext";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_ERROR } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

import { ExpectedMarker } from "./ExpectedMarker";

/** The id the durability sentence publishes, carried by the note's own field in `aria-describedby`. */
const NOTIZ_HINT_ID = "notiz-dauerhaft-hinweis";

/**
 * **Its own panel, outside Ergebnis**, whose fields arm behind a deliberate unlock flip: a note is
 * prose rather than a score, and locking it would guard against nothing. The text is public — it
 * renders in the details dialog every visitor can open.
 */
export function FormNotizSection({
  notiz,
  onNotizChange,
  onValidateFields,
}: {
  notiz: string | null;
  onNotizChange: (value: string | null) => void;
  /** Judged when the field is left, as every other field on this page is. */
  onValidateFields: (paths: readonly string[]) => void;
}) {
  const styles = formPanel();
  const status = useFieldStatus("notiz");
  const notizRef = useRef<HTMLTextAreaElement>(null);

  // Whitespace is empty, as `fl_frontend/src/features/spiele/draftStatus.ts`'s `notiz` descriptor reads it, or the
  // button offers to remove a note the change list already reports as absent.
  const hasNotiz = notiz !== null && notiz.trim() !== "";

  return (
    <section className={styles.root()}>
      <div className={styles.header()}>
        <PanelHeading
          className={styles.heading()}
          title="Notiz">
          <Hint
            mode="reveal"
            label="Hinweis zur Notiz"
            body={{
              lead: "Eine Anmerkung zu diesem Spiel.",
              points: [{ term: "Öffentlich:", text: "die Notiz erscheint in den Spieldetails." }],
            }}
          />
        </PanelHeading>
      </div>

      <div className={styles.body()}>
        <TextField
          name="notiz"
          aria-describedby={NOTIZ_HINT_ID}
          value={notiz ?? ""}
          // "" is held as null at once, so the draft compares equal to a fixture without a note.
          onChange={(next) => onNotizChange(next === "" ? null : next)}
          onBlur={() => onValidateFields(["notiz"])}
          maxLength={NOTIZ_MAX_LENGTH}
          isInvalid={status?.error ? true : undefined}>
          <FieldLabel
            path="notiz"
            extraMarker={<ExpectedMarker path="notiz" />}>
            Notiz zum Spiel
          </FieldLabel>
          <TextArea
            ref={notizRef}
            fullWidth
            placeholder="z.B. Nachholspiel wegen Regen"
            className="border-border bg-surface text-foreground fluid-sm min-h-24 rounded-lg border px-3 py-2 transition-colors outline-none"
          />
          <FieldError className={FIELD_ERROR}>{status?.error}</FieldError>

          {/* Under the field rather than in the panel's hint, which opens on a press: the reader this
              sentence has to reach is the admin already typing a name into the box. */}
          <Hint
            mode="inline"
            describes={NOTIZ_HINT_ID}
            text="Ein Name hier bleibt öffentlich stehen, auch wenn die Person später vergessen werden möchte."
          />

          {/* The row is reserved whether the button is in it or not: a control arriving on the first
              character typed would push the panels below down the page — the same shift
              `FieldLabel.tsx :: FieldLabel` reserves against. */}
          <div className="flex min-h-7 w-full flex-row items-center">
            {/* No confirmation: nothing is written until Speichern, so this is an ordinary draft edit
                — the same call `FormDateTimeSection.tsx :: ClearFieldButton` makes, and a plain button
                for the same reason. Labelled: a bare X reads only inside a field group. */}
            {hasNotiz && (
              <button
                type="button"
                onClick={() => {
                  // Focus moves BEFORE the state change unmounts this button: focus left on a
                  // removed element falls to `<body>` and the next Tab restarts at the page top.
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
