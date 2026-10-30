import z from "zod";

import { ANMELDUNG_CODE, ANMELDUNG_TAG } from "@/core/anmeldeTag";
import { BERECHTIGUNG_HINWEIS, BERECHTIGUNG_TAG } from "@/core/berechtigungTag";
import { SPIELLEITUNG_HINWEIS, SPIELLEITUNG_TAG } from "@/core/spielleitungTag";
import { FLZustellungEreignisPayloadSchema, FLZustellungZielSchema, zielHatSitze } from "@/features/zustellung/schemas";
import { CustomObjectIdStringSchema } from "@/shared/schemas";

import {
  FLBewerbungZustellungEreignisPayloadSchema,
  FLKontaktRolleSchema,
  ZUSTELLUNG_GRUND_MAX_LENGTH,
  ZUSTELLUNG_NACHRICHT_ID_MAX_LENGTH,
  ZUSTELLUNG_ZEITPUNKT_MAX_LENGTH,
} from "./schemas";

import type { FLBewerbungZustellungEreignisPayload, FLKontaktRolle } from "@/core/generated/client/types";
import type { FLZustellungEreignisPayload, FLZustellungZiel } from "@/features/zustellung/schemas";

/**
 * Which message a delivery event is about, as it rides the send. Its own vocabulary rather than the
 * operation names the log lines use: a tag value admits ASCII letters, digits, `_` and `-` alone.
 */
export type ZustellAnlass =
  | "eingang"
  | "empfang"
  | "erinnerung"
  | "erneut"
  | "vollstaendig"
  | "widerspruch"
  | "loeschung"
  | "einladung"
  | "ablehnung"
  | "anfrage"
  | "neue_ansetzung"
  | "spiel_abgesagt"
  | "vorschlag_verworfen";

/**
 * The envelope's own `created_at` orders events and `data.created_at` does not: the second is when the
 * MESSAGE was made, which every event about one message repeats.
 */
const ZustellEreignisSchema = z.object({
  type: z.string(),
  created_at: z.string(),
  data: z.object({
    email_id: z.string(),
    tags: z.record(z.string(), z.string()).optional(),
    bounce: z.object({ type: z.string(), subType: z.string().optional() }).optional(),
    suppressed: z.object({ type: z.string() }).optional(),
    failed: z.object({ reason: z.string() }).optional(),
  }),
});

type ZustellEreignis = z.infer<typeof ZustellEreignisSchema>;

// Mirrors `fl_backend/app/shared/schemas/custom.py :: SINGLE_LINE_PATTERN`, applied there to `grund`
// and copied again in `fl_frontend/src/features/bewerbungen/schemas.ts`.
const EINZEILIG = /^[^\x00\n\v\f\r\u0085\u2028\u2029]*$/u;

// The offset the endpoint requires, anchored to a time so a date alone cannot satisfy it. Nothing of
// the instant before it: a check narrower than `datetime.fromisoformat` would drop an event the
// endpoint takes.
const UTC_VERSATZ = /\d:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:[Zz]|[+-]\d{2}(?::?\d{2}(?::?\d{2}(?:[.,]\d+)?)?)?)$/u;

const ZustellNachrichtIdSchema = z.string().trim().min(1).max(ZUSTELLUNG_NACHRICHT_ID_MAX_LENGTH);
const ZustellZeitpunktSchema = z.string().trim().min(1).max(ZUSTELLUNG_ZEITPUNKT_MAX_LENGTH).regex(UTC_VERSATZ);
const ZustellGrundSchema = z.string().trim().max(ZUSTELLUNG_GRUND_MAX_LENGTH).regex(EINZEILIG);

/**
 * The state one event leaves, or `null` where the event says nothing about a seat — `email.sent`
 * among them, which the accepted send has already recorded.
 */
function standAus({ type, data }: ZustellEreignis): { stand: FLBewerbungZustellungEreignisPayload["stand"]; grund: string | null } | null {
  switch (type) {
    case "email.delivered":
      return { stand: "zugestellt", grund: null };
    // A temporary bounce is the receiving server asking for later, not the mailbox refusing: reading
    // it as permanent would stop the reminder clock and hold the application over a full mailbox.
    case "email.bounced":
      return { stand: data.bounce?.type === "Permanent" ? "unzustellbar" : "verzoegert", grund: data.bounce?.subType ?? null };
    case "email.suppressed":
      return { stand: "unterdrueckt", grund: data.suppressed?.type ?? null };
    case "email.complained":
      return { stand: "beschwerde", grund: null };
    case "email.delivery_delayed":
      return { stand: "verzoegert", grund: null };
    // The documented reason is the league's own daily quota, which says nothing about the address:
    // marking the seat permanently refused would spend its one chase on the sender's fault.
    case "email.failed":
      return { stand: "verzoegert", grund: data.failed?.reason ?? null };
    default:
      return null;
  }
}

/** The seats one tag names, or `null` where the value spells anything but this application's own keys. */
function rollenAus(value: string | undefined): FLKontaktRolle[] | null {
  if (value === undefined) return null;

  const gelesen = z.array(FLKontaktRolleSchema).min(1).safeParse(value.split("-"));

  return gelesen.success ? gelesen.data : null;
}

/** What every event says whatever record it is about: the message, the state it leaves, and the instant that orders it. */
type ZustellGemeinsam = {
  nachricht_id: string;
  stand: FLBewerbungZustellungEreignisPayload["stand"];
  grund: string | null;
  am: string;
};

/** Why a tagged event reached no record. A closed set, because it reaches a log line rather than a reader. */
type ZustellUnplatzierbarGrund = "ziel_unbekannt" | "ziel_id_unlesbar" | "rollen_unlesbar";

/** The lanes no store holds, where a message that did not arrive leaves a line and nothing else. */
const OHNE_EINTRAG = [
  // An administrator locked out of their own mailbox is a line for an operator, and a record here would
  // be a second home for the `auth` store.
  { ziel: "anmeldung", tag: ANMELDUNG_TAG, wert: ANMELDUNG_CODE },
  // The notice's outbox row is gone once stamped.
  { ziel: "berechtigung", tag: BERECHTIGUNG_TAG, wert: BERECHTIGUNG_HINWEIS },
  // A referee's fixture row holds no seat to record a delivery on, and a seat kind refuses a send naming none.
  { ziel: "spielleitung", tag: SPIELLEITUNG_TAG, wert: SPIELLEITUNG_HINWEIS },
] as const;

/**
 * **`bewerbung` is the fall-through**: no message the application flow sends carries a `ziel`, so an
 * event naming neither that nor a lane of `OHNE_EINTRAG` is read as that flow's rather than as unplaceable.
 */
export type ZustellMeldung =
  | { ziel: "bewerbung"; meldung: FLBewerbungZustellungEreignisPayload }
  | { ziel: FLZustellungZiel; meldung: FLZustellungEreignisPayload }
  // Carries no `meldung`: no store holds these lanes, so the message id rides bare for the line.
  | { ziel: (typeof OHNE_EINTRAG)[number]["ziel"]; stand: ZustellGemeinsam["stand"]; nachricht_id: string }
  // Its own arm rather than `null`: read as nothing, a tag block this side cannot place is dropped
  // exactly as an untagged message is, and a slice's bounces go unrecorded in silence.
  | { ziel: "unplatzierbar"; grund: ZustellUnplatzierbarGrund; art: FLZustellungZiel | null };

/** The generic arm: a kind names a population, so an event carrying one without the row's own id is placed nowhere. */
function leseZielMeldung(tags: Record<string, string>, gemeinsam: ZustellGemeinsam): ZustellMeldung {
  const art = FLZustellungZielSchema.safeParse(tags["ziel"]);
  if (!art.success) return { ziel: "unplatzierbar", grund: "ziel_unbekannt", art: null };

  // A seat-carrying kind's message names the seats it covered, and every other kind's names none: a
  // stray `rollen` on those is ignored rather than refused, their one carrier needing no seat.
  const rollen = zielHatSitze(art.data) ? rollenAus(tags["rollen"]) : [];
  if (rollen === null) return { ziel: "unplatzierbar", grund: "rollen_unlesbar", art: art.data };

  const zeile = CustomObjectIdStringSchema.safeParse(tags["ziel_id"]);
  const meldung = zeile.success
    ? FLZustellungEreignisPayloadSchema.safeParse({ ziel: art.data, ziel_id: zeile.data, rollen: rollen, ...gemeinsam }).data
    : undefined;

  return meldung === undefined ? { ziel: "unplatzierbar", grund: "ziel_id_unlesbar", art: art.data } : { ziel: art.data, meldung: meldung };
}

/**
 * One event as the write it asks for, or `null` where nothing is owed. **Every `null` is answered
 * 200**: the provider retries a non-200 for thirty-two hours and then disables the endpoint.
 */
export function leseZustellEreignis(raw: unknown): ZustellMeldung | null {
  const gelesen = ZustellEreignisSchema.safeParse(raw);
  if (!gelesen.success) return null;

  const ereignis = gelesen.data;
  const stand = standAus(ereignis);
  if (stand === null) return null;

  const nachrichtId = ZustellNachrichtIdSchema.safeParse(ereignis.data.email_id);
  const am = ZustellZeitpunktSchema.safeParse(ereignis.created_at);

  // The message and the instant are refused rather than repaired, unlike `grund` below: one the
  // endpoint will not take names neither the link a record holds nor the order two events fall in.
  if (!nachrichtId.success || !am.success) return null;

  const gemeinsam: ZustellGemeinsam = {
    nachricht_id: nachrichtId.data,
    stand: stand.stand,
    // Null where the provider sent prose rather than its own token: the state is a fact about the
    // mailbox with or without one, and a refused `grund` would take the whole bounce with it.
    grund: ZustellGrundSchema.safeParse(stand.grund).data ?? null,
    am: am.data,
  };

  // First, because these lanes carry neither a `ziel` nor an application's id: read after them one
  // would fall through to the application flow and be reported against a record nobody has.
  const ohneEintrag = OHNE_EINTRAG.find(({ tag, wert }) => ereignis.data.tags?.[tag] === wert);
  if (ohneEintrag !== undefined) return { ziel: ohneEintrag.ziel, stand: gemeinsam.stand, nachricht_id: gemeinsam.nachricht_id };

  if (ereignis.data.tags?.["ziel"] !== undefined) return leseZielMeldung(ereignis.data.tags, gemeinsam);

  const bewerbungId = CustomObjectIdStringSchema.safeParse(ereignis.data.tags?.["bewerbung_id"]);
  const rollen = rollenAus(ereignis.data.tags?.["rollen"]);
  if (!bewerbungId.success || rollen === null) return null;

  // The wire's own mirror last, over a payload already held to the ceilings above: nothing this
  // module composes reaches the endpoint in a shape it refuses.
  const meldung = FLBewerbungZustellungEreignisPayloadSchema.safeParse({
    bewerbung_id: bewerbungId.data,
    rollen: rollen,
    ...gemeinsam,
  }).data;

  return meldung === undefined ? null : { ziel: "bewerbung", meldung: meldung };
}
