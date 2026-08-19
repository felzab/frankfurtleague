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
 * The Geändert marker is a hover hint, and **it is where the previous value lives**: as a line
 * under the label it arrived on the first keystroke, shifting the layout while somebody typed.
 */
export function FieldLabel({ path, children }: { path: string; children: ReactNode }) {
  const status = useFieldStatus(path);

  return (
    <div
      // The rail links straight here. A dot in `path` is valid in an HTML5 id, and this is never
      // used as a CSS selector, the one place it would need escaping.
      id={`feld-${path}`}
      className="flex w-full scroll-mt-28 flex-col gap-y-1">
      {/* `min-h-5`: a marker disc out-measures the label's own line, so its arrival grew the row —
          a shift, and a mis-alignment between two fields sharing a grid row. Reserving the marker's
          height keeps every label row constant. */}
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
            {/* No bolded `Fehlt.` in front: the trigger's own `aria-label` is that word, so a
                screen reader announced it twice, and under `Empfohlen` the second read as a
                contradiction. */}
            <p>
              {status.expectedSeverity === "required" ? "Trage es ein, damit das Spiel stattfinden kann." : "Empfohlen, aber nicht zwingend."}
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
