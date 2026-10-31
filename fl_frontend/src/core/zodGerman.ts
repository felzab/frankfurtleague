import { z } from "zod";

import { COPY } from "./copy";

import type { Copy } from "./copy";

/** A field's example for „Format: {Beispiel}“, keyed by the field's path, its segments joined by dots. */
export type Beispiele = Readonly<Record<string, Copy>>;

/**
 * The one line a field shows under it for a Zod issue, in the fixed field patterns: what is expected, never the field's
 * name and never „ungültig“. An issue no pattern words, which no person's typing raises, falls to the one unexpected
 * line rather than to Zod's English. It reads the raw issue an error map is handed, whose input and schema a parse's
 * finished issues no longer carry.
 */
export function fieldMessage(issue: z.core.$ZodRawIssue, beispiele: Beispiele = {}): Copy {
  const { feld, fehler } = COPY.shared;

  // Every check meeting an empty box asks for a value, whichever check it was.
  if (issue.input === undefined || issue.input === null || issue.input === "") return feld.pflichtfeld;

  if (issue.code === "too_small" || issue.code === "too_big") {
    if (issue.origin === "string") {
      return issue.code === "too_small" ? feld.mindestensZeichen(Number(issue.minimum)) : feld.hoechstensZeichen(Number(issue.maximum));
    }
    // A number's issue names the one bound it passed; the line names both, read off the schema holding them.
    if (issue.schema instanceof z.ZodNumber && issue.schema.minValue !== null && issue.schema.maxValue !== null) {
      return feld.zwischen(issue.schema.minValue, issue.schema.maxValue);
    }
  }

  // A value of the wrong shape is shown the shape: the field's own example, or the address example for an address.
  const example = beispiele[(issue.path ?? []).map(String).join(".")];
  if (example !== undefined) return feld.format(example);
  if (issue.code === "invalid_format" && issue.format === "email") return feld.format(feld.beispielAdresse);

  return fehler.unerwartet;
}

// Redesign: goes, with its call in `instrumentation.ts`, with the last parse that passes no map of its own, the old
// actions' and route handlers'; `core/action.ts` hands `fieldMessage` to every parse it makes.
/**
 * Makes the map the process's, below every message a schema, a check or a parse names itself, and above Zod's English
 * locale. Called once, from `fl_frontend/src/instrumentation.ts :: register`, before the server serves: Zod keeps its
 * config on `globalThis`, so every copy of Zod a server bundle holds reads it.
 */
export function installGermanMap(): void {
  z.config({ customError: (issue) => fieldMessage(issue) });
}
