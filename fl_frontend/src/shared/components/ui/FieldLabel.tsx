"use client";

import { PencilToLine } from "@gravity-ui/icons";

import { Label } from "@heroui/react";

import { useFieldStatus } from "@/shared/components/ui/DraftStatusContext";
import { FIELD_LABEL, FIELD_MARKER } from "@/shared/components/ui/formFieldStyles";
import { InfoHint } from "@/shared/components/ui/InfoHint";

import type { ReactNode } from "react";

/**
 * The Geändert marker is a hover hint, and **it is where the previous value lives**: as a line under
 * the label it arrived on the first keystroke, shifting the layout while somebody typed.
 */
export function FieldLabel({
  path,
  children,
  extraMarker,
}: {
  path: string;
  children: ReactNode;
  /** A marker only one editor has — the match editor's Fehlt/Offen disc, which needs a status the shared one does not carry. */
  extraMarker?: ReactNode;
}) {
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

        {extraMarker}

        {status?.isChanged && (
          <InfoHint
            label="Geändert"
            trigger={
              <span className={`${FIELD_MARKER} bg-brand/15 text-brand-solid`}>
                <PencilToLine className="size-3" />
              </span>
            }>
            {/* No bolded `Geändert.` in front of the previous value: the trigger's own `aria-label`
                is that word, so a screen reader announced it twice. `Neu eingetragen.` stays, being
                the one case that says something the label does not. */}
            <p>{status.storedText === null ? <strong>Neu eingetragen.</strong> : <>Vorher: {status.storedText}</>}</p>
          </InfoHint>
        )}
      </div>
    </div>
  );
}
