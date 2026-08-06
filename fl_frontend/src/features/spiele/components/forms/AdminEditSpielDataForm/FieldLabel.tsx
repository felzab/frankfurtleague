"use client";

import { CircleDashed, PencilToLine } from "@gravity-ui/icons";

import { Label } from "@heroui/react";

import { FIELD_LABEL } from "@/shared/components/ui/formFieldStyles";

import { useFieldStatus } from "./DraftStatusContext";

import type { ReactNode } from "react";

/**
 * Both markers, so the two read as one family rather than as two ideas.
 *
 * **An icon in a small tinted disc, not a worded chip.** The previous recipe — icon plus uppercase
 * word plus padding — outweighed the field label it sat beside, twice per line at its worst (owner,
 * third review). The meaning survives the diet because the two icons differ in SHAPE, not only in
 * colour: a dashed circle for "still empty", a pencil for "edited". The word still exists for every
 * non-visual reader (`sr-only`) and for anyone hovering (`title`).
 */
const MARKER = "inline-flex size-5 shrink-0 items-center justify-center rounded-full";

/**
 * A field's label, plus what the page knows about that field.
 *
 * **Every label in the editor goes through this**, which is what makes a future field's markers free:
 * the field renders `<FieldLabel path="…">`, and the marker, the anchor and the previous value all
 * follow from its descriptor in `draftStatus.ts` without the field knowing they exist.
 *
 * Three things it adds, each answering a question the owner asked:
 *
 * - **"Fehlt"** — a field that is empty while an action-required category waits on it. Its icon
 *   differs from the edited marker's in shape, not only in colour, so the two are distinct for every
 *   sighted reader; the word itself is `sr-only`. It disappears the moment the field is filled
 *   rather than waiting for a save.
 * - **"Geändert"** — the draft differs from what is stored.
 * - **`vorher: …`** — the stored value, struck through, under a changed field. This is the answer to
 *   glancing at the date and not knowing whether you are looking at the old one: the old one is
 *   labelled, struck through and muted, and the field itself always holds the new one.
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
      <div className="flex flex-row flex-wrap items-center gap-x-2 gap-y-1">
        <Label className={FIELD_LABEL}>{children}</Label>

        {status?.isExpected && (
          <span
            title="Fehlt"
            className={`${MARKER} bg-warning/15 text-warning-strong`}>
            <CircleDashed className="size-3" />
            <span className="sr-only">Fehlt</span>
          </span>
        )}

        {status?.isChanged && (
          <span
            title="Geändert"
            className={`${MARKER} bg-brand/15 text-brand-solid`}>
            <PencilToLine className="size-3" />
            <span className="sr-only">Geändert</span>
          </span>
        )}
      </div>

      {/* Only where there was something before. A field filled from empty has nothing to strike
          through, and "vorher: —" is noise on the one row that should read as progress. */}
      {status?.isChanged && status.storedText !== null && (
        <p className="fluid-xxs text-foreground-muted leading-normal font-medium">
          vorher: <span className="line-through">{status.storedText}</span>
        </p>
      )}
    </div>
  );
}
