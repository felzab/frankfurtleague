"use client";

import { PencilToLine } from "@gravity-ui/icons";

import { Label } from "@heroui/react";

import { FIELD_LABEL } from "@/shared/components/ui/formFieldStyles";
import { InfoHint } from "@/shared/components/ui/InfoHint";

import { useSchiedsrichterFieldStatus } from "./SchiedsrichterDraftStatusContext";

import type { ReactNode } from "react";

/** The match editor's marker disc, so every editor's markers read as one family. */
const MARKER = "inline-flex size-5 shrink-0 items-center justify-center rounded-full";

/**
 * A field's label plus what the page knows about that field — `SpielerFieldLabel` over a referee's
 * draft, with the same single marker: a referee has no action-required categories, so the only thing
 * to mark is **Geändert**, with the previous value one hover away rather than as a line that shifts
 * the layout when it appears. The wrapper carries the same `feld-` anchor id and scroll margin.
 */
export function SchiedsrichterFieldLabel({ path, children }: { path: string; children: ReactNode }) {
  const status = useSchiedsrichterFieldStatus(path);

  return (
    <div
      id={`feld-${path}`}
      className="flex w-full scroll-mt-28 flex-col gap-y-1">
      {/* `min-h-5` reserves the marker's height so its arrival never grows the row — see FieldLabel. */}
      <div className="flex min-h-5 flex-row flex-wrap items-center gap-x-2 gap-y-1">
        <Label className={FIELD_LABEL}>{children}</Label>

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
