"use client";

import { CircleDashed } from "@gravity-ui/icons";

import { FIELD_MARKER } from "@/shared/components/ui/formFieldStyles";
import { Hint } from "@/shared/components/ui/Hint";

import { useSpielExpectedField } from "./SpielExpectedContext";

/**
 * The match editor's field marker, handed to `FieldLabel` as its `extraMarker`. **Which fields can
 * carry one is `FIELD_DESCRIPTORS`' answer alone** — every label passes this, and a path no
 * `expectedWhen` names renders nothing.
 */
export function ExpectedMarker({ path }: { path: string }) {
  const field = useSpielExpectedField(path);
  if (field === undefined) return null;

  const blocksScoring = field.expectedSeverity === "scoring";

  const trigger = (
    <span className={`${FIELD_MARKER} ${blocksScoring ? "bg-danger/15 text-danger-strong" : "bg-warning/15 text-warning-strong"}`}>
      <CircleDashed className="size-3" />
    </span>
  );

  /* Two elements over one with a conditional lead: `hintCap.test.ts` counts a literal, and a
     ternary is a body it cannot measure. Neither line repeats the trigger's own `aria-label`,
     which a screen reader announces immediately before it. */
  return blocksScoring ? (
    <Hint
      mode="reveal"
      label="Fehlt"
      body={{ lead: "Ohne diese Angabe kann das Spiel nicht gewertet werden." }}
      trigger={trigger}
    />
  ) : (
    <Hint
      mode="reveal"
      label="Offen"
      body={{ lead: "Ohne diese Angabe kann das Spiel nicht stattfinden." }}
      trigger={trigger}
    />
  );
}
