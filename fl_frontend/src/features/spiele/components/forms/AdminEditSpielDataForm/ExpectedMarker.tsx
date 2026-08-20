"use client";

import { CircleDashed } from "@gravity-ui/icons";

import { FIELD_MARKER } from "@/shared/components/ui/formFieldStyles";
import { InfoHint } from "@/shared/components/ui/InfoHint";

import { useSpielExpectedField } from "./SpielExpectedContext";

/**
 * The match editor's field marker, handed to `FieldLabel` as its `extraMarker`. **Which fields can
 * carry one is `FIELD_DESCRIPTORS`' answer alone** — every label passes this, and a path no
 * `expectedWhen` names renders nothing.
 */
export function ExpectedMarker({ path }: { path: string }) {
  const field = useSpielExpectedField(path);
  if (field === undefined) return null;

  const isRequired = field.expectedSeverity === "required";

  return (
    <InfoHint
      label={isRequired ? "Fehlt" : "Empfohlen"}
      trigger={
        <span className={`${FIELD_MARKER} cursor-help ${isRequired ? "bg-danger/15 text-danger-strong" : "bg-warning/15 text-warning-strong"}`}>
          <CircleDashed className="size-3" />
        </span>
      }>
      {/* No bolded `Fehlt.` in front: the trigger's own `aria-label` is that word, so a screen
          reader announced it twice, and under `Empfohlen` the second read as a contradiction. */}
      <p>{isRequired ? "Trage es ein, damit das Spiel stattfinden kann." : "Empfohlen, aber nicht zwingend."}</p>
    </InfoHint>
  );
}
