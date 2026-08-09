"use client";

import { CircleDashed, PencilToLine } from "@gravity-ui/icons";

import { Label } from "@heroui/react";

import { FIELD_LABEL } from "@/shared/components/ui/formFieldStyles";
import { InfoHint } from "@/shared/components/ui/InfoHint";

import { useFieldStatus } from "./DraftStatusContext";

import type { ReactNode } from "react";

/** Both markers, so the two read as one family rather than as two ideas. */
const MARKER = "inline-flex size-5 shrink-0 items-center justify-center rounded-full";

/**
 * A field's label, plus what the page knows about that field.
 *
 * **Every label in the editor goes through this**, which is what makes a future field's markers free:
 * the field renders `<FieldLabel path="…">`, and the marker and the anchor follow from its descriptor
 * in `draftStatus.ts` without the field knowing they exist.
 *
 * Two markers, each a hover hint rather than a bare badge:
 *
 * - **Fehlt / Empfohlen** — the field is empty while an action-required category waits on it,
 *   coloured by severity (danger for required, warning for recommended). The hint says which.
 * - **Geändert** — the draft differs from what is stored, and **the hint is where the previous value
 *   lives**. It used to be a `vorher:` line under the label, and that line arrived exactly when the
 *   admin edited the field — a layout shift on every first keystroke, most visible where two goal
 *   fields share a row and one grew taller (seventh review). A hint occupies no flow space,
 *   so the answer is still one hover away and nothing moves.
 *
 * The wrapper carries `id={`feld-${path}`}` so the rail's open-items list can link straight to it, and
 * `scroll-mt-28` so the sticky page header does not land on top of the field it just jumped to. A dot in
 * an id is valid HTML5 and fragment matching is an exact string compare — it is never used as a CSS
 * selector, which is the only place the dot would need escaping.
 */
export function FieldLabel({ path, children }: { path: string; children: ReactNode }) {
  const status = useFieldStatus(path);

  return (
    <div
      id={`feld-${path}`}
      className="flex w-full scroll-mt-28 flex-col gap-y-1">
      {/* `min-h-5`: the marker discs are 20px and the label's own line can be 18px, so a marker's
          arrival grew the row by 2px — a shift, and a 2px mis-alignment between two fields sharing a
          grid row. Reserving the marker's height keeps every label row constant whether marked or
          not. */}
      <div className="flex min-h-5 flex-row flex-wrap items-center gap-x-2 gap-y-1">
        <Label className={FIELD_LABEL}>{children}</Label>

        {status?.isExpected && (
          <InfoHint
            label={status.expectedSeverity === "required" ? "Fehlt" : "Empfohlen"}
            trigger={
              <span
                className={`${MARKER} cursor-help ${
                  status.expectedSeverity === "required" ? "bg-danger/15 text-danger-strong" : "bg-warning/15 text-warning-strong"
                }`}>
                <CircleDashed className="size-3" />
              </span>
            }>
            <p>
              {status.expectedSeverity === "required" ? (
                <>
                  <strong>Fehlt.</strong> Nötig, damit das Spiel stattfinden kann.
                </>
              ) : (
                <>
                  <strong>Fehlt.</strong> Empfohlen, aber nicht zwingend.
                </>
              )}
            </p>
          </InfoHint>
        )}

        {status?.isChanged && (
          <InfoHint
            label="Geändert"
            trigger={
              <span className={`${MARKER} bg-brand/15 text-brand-solid cursor-help`}>
                <PencilToLine className="size-3" />
              </span>
            }>
            <p>
              <strong>{status.storedText === null ? "Neu eingetragen." : "Geändert."}</strong>
              {status.storedText !== null && <> Vorher: {status.storedText}</>}
            </p>
          </InfoHint>
        )}
      </div>
    </div>
  );
}
