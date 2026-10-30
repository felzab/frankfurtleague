import { TIME_ZONE } from "@/core/format";
import { GELOESCHT_ACTOR_MARKER } from "@/core/geloeschtActor";
import { GELOESCHTE_PERSON, vonOderGesperrt } from "@/features/berechtigungen/constants";

import { AKTION_COLLECTION_LABELS, AKTION_HERKUNFT_LABELS, AKTOR_FUNKTION_LABELS, AKTOR_HERKUNFT } from "./constants";

import type { FLAktion, FLAktorPerson } from "@/core/generated/client/types";
import type { AktionHerkunft } from "./constants";

/**
 * Where the write behind a row came from. Read through the map and never off the actor's fields: `SYSTEM`
 * and `PUBLIC` are spellings of "nobody", and a signed-in person carries no address at all.
 */
export function herkunftOfAktor(actor: FLAktion["actor"]): AktionHerkunft {
  return AKTOR_HERKUNFT[actor.kind];
}

/**
 * How a signed-in person's row names them: the kind of person the write was made as and their pseudonym,
 * served cut to the start a page may show (`fl_backend/app/api/aktionen/schemas.py :: FLAktorPerson`), or the
 * admin cards' word for one erased since.
 */
export function personAkteurLabel(actor: FLAktorPerson): string {
  const wer = actor.pseudonym === GELOESCHT_ACTOR_MARKER ? GELOESCHTE_PERSON : actor.pseudonym;

  return `${AKTOR_FUNKTION_LABELS[actor.funktion]} · ${wer}`;
}

/**
 * What a row's actor cell prints, through the functions the cell renders with, which the log's search
 * reads too: the stored sentinels and markers are on no screen to type.
 */
export function aktorAnzeige(actor: FLAktion["actor"]): string {
  if (actor.kind === "person_session") return personAkteurLabel(actor);
  if (actor.kind === "admin_session") return vonOderGesperrt(actor.email, actor.email_gesperrt);

  return AKTION_HERKUNFT_LABELS[herkunftOfAktor(actor)];
}

/** Falls back to the stored name, so a collection the backend adds lists as itself rather than as an empty cell. */
export function labelForCollection(collection: string): string {
  // The collection is an unvalidated wire string, and an unguarded lookup reaches `Object.prototype`: `toString` selects a function.
  const known = Object.hasOwn(AKTION_COLLECTION_LABELS, collection) ? AKTION_COLLECTION_LABELS[collection] : undefined;

  return known ?? collection;
}

// Europe/Berlin, as every other date in this app is rendered: the log stores UTC, and an admin reading
// "14:23" for a write they made at 16:23 would look for it on the wrong side of midnight.
const ZEITPUNKT_DATUM = new Intl.DateTimeFormat("de-DE", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const ZEITPUNKT_UHRZEIT = new Intl.DateTimeFormat("de-DE", {
  timeZone: TIME_ZONE,
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
 * fan-out ran, and a bare count where a bulk create selected nothing.
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
