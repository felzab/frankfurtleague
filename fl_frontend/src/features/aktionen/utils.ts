import { AKTION_COLLECTION_LABELS, AKTOR_HERKUNFT } from "./constants";

import type { AktionHerkunft } from "./constants";
import type { FLAktion, FLAktor } from "./schemas";

/**
 * Where the write behind a row came from. Read through the map and never off `email`, which holds a
 * sentinel for two of the three kinds -- `SYSTEM` and `PUBLIC` are spellings of "nobody", not mailboxes.
 */
export function herkunftOfAktor(actor: FLAktor): AktionHerkunft {
  return AKTOR_HERKUNFT[actor.kind];
}

/** Falls back to the stored name, so a collection the backend adds lists as itself rather than as an empty cell. */
export function labelForCollection(collection: string): string {
  return AKTION_COLLECTION_LABELS[collection] ?? collection;
}

// Europe/Berlin, as every other date in this app is rendered: the log stores UTC, and an admin reading
// "14:23" for a write they made at 16:23 would look for it on the wrong side of midnight.
const ZEITPUNKT_DATUM = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const ZEITPUNKT_UHRZEIT = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
});

/** `uhrzeit` is null only where `at` could not be read, and `datum` then carries the stored value unchanged. */
export type AktionZeitpunkt = { datum: string; uhrzeit: string | null };

export function formatAktionZeitpunkt(at: string): AktionZeitpunkt {
  const instant = new Date(at);

  // The read model refuses no stored value, so an unreadable `at` arrives here rather than failing the
  // response — and `Intl.format` throws on one, which would take the whole page with it.
  if (Number.isNaN(instant.getTime())) return { datum: at, uhrzeit: null };

  return { datum: ZEITPUNKT_DATUM.format(instant), uhrzeit: ZEITPUNKT_UHRZEIT.format(instant) };
}

/**
 * Three shapes because the reader needs a different thing from each: an id to look the document up, the filter a
 * fan-out ran, and a bare count where a bulk create selected nothing (`docs/backend/spec.md :: I40`).
 */
export type AktionDatensatz =
  { kind: "dokument"; id: string } | { kind: "menge"; filterPaare: readonly [string, string][]; betroffen: number | null } | { kind: "ohne" };

/**
 * A count alone still names a set, so `ohne` needs all three absent — the read model refuses no stored
 * row, and one naming nothing at all can reach the page.
 */
export function describeAktionDatensatz(aktion: Pick<FLAktion, "document_id" | "db_filter" | "modified_count">): AktionDatensatz {
  if (aktion.document_id !== null) return { kind: "dokument", id: aktion.document_id };

  const filterPaare = Object.entries(aktion.db_filter ?? {});
  if (filterPaare.length === 0 && aktion.modified_count === null) return { kind: "ohne" };

  return { kind: "menge", filterPaare, betroffen: aktion.modified_count };
}
