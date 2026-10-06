import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import {
  einzeiligerName,
  FLKontaktRolleSchema,
  ZUSTELLUNG_GRUND_MAX_LENGTH,
  ZUSTELLUNG_NACHRICHT_ID_MAX_LENGTH,
  ZUSTELLUNG_ZEITPUNKT_MAX_LENGTH,
} from "@/features/bewerbungen/schemas";
import { CustomObjectIdStringSchema, FLBewerbungZustellstandSchema } from "@/shared/schemas";

/**
 * Mirrors `fl_backend/app/api/zustellung/schemas.py :: FLZustellungZiel` — which kind of record a
 * report is about. Closed on both sides, so a kind the register has no home for is refused here
 * rather than dispatched to nothing.
 */
export const FLZustellungZielSchema = z.enum(["schiedsrichter", "einladung", "registrierung", "kontakt", "schiedsrichter_adresswechsel"], {
  error: "Diesen Empfängertyp gibt es nicht.",
});
export type FLZustellungZiel = z.infer<typeof FLZustellungZielSchema>;

/**
 * Mirrors `fl_backend/app/api/zustellung/schemas.py :: ZIELE_JE_SITZ` — the kinds whose record sits
 * under each contact seat, so their reports name the seats one message reached and every other kind's
 * name none. One list on one line, which `fl_backend/tests/shared/test_frontend_mirrors.py` reads.
 */
export const ZIELE_JE_SITZ = ["kontakt"] as const satisfies readonly FLZustellungZiel[];
export type FLZielJeSitz = (typeof ZIELE_JE_SITZ)[number];

/** Whether a kind's reports name the seats they reached. */
export function zielHatSitze(ziel: FLZustellungZiel): ziel is FLZielJeSitz {
  return (ZIELE_JE_SITZ as readonly FLZustellungZiel[]).includes(ziel);
}

/**
 * What every generic delivery write names, mirroring the one private base they share on the backend.
 * Spelled once for the reason the base exists: two copies would let the three writes judge one
 * provider's message differently.
 */
const zielMeldungFields = {
  ziel: FLZustellungZielSchema,
  // Beside the kind, which names a population rather than a row: an event carrying the kind alone
  // would be applied to whichever record a later reader guessed at.
  ziel_id: CustomObjectIdStringSchema,
  am: z
    .string()
    .trim()
    // German though no reader meets one: this server composes every write, and a refusal reaches the
    // log rather than a box. `fl_frontend/src/core/schemaGerman.test.ts` holds every payload to it.
    .min(1, { error: "Diese Meldung nennt keinen Zeitpunkt." })
    .max(ZUSTELLUNG_ZEITPUNKT_MAX_LENGTH, { error: "Dieser Zeitpunkt ist zu lang." }),
  // Required on every kind and empty on all but `kontakt`, whose one row holds three seats: the
  // message names which of them it covered, and a seat it did not name keeps its own record.
  rollen: z.array(FLKontaktRolleSchema),
};

/**
 * The endpoint's own pairing, refused there 422: a seat named for a kind with one carrier is applied to
 * nothing, and a contact message naming none is applied to no seat.
 */
function sitzeZumZiel({ ziel, rollen }: { ziel: FLZustellungZiel; rollen: readonly unknown[] }, ctx: z.core.$RefinementCtx): void {
  const mitSitzen = zielHatSitze(ziel);
  if (mitSitzen ? rollen.length === 0 : rollen.length > 0) {
    ctx.addIssue({
      code: "custom",
      message: mitSitzen ? "Diese Meldung nennt keinen Sitz." : "Diese Meldung nennt einen Sitz, den es hier nicht gibt.",
      path: ["rollen"],
    });
  }
}

/** The id a mint answered with, on the two writes there is a message to name. */
const nachrichtIdFeld = z
  .string()
  .trim()
  .min(1, { error: "Diese Meldung nennt keine Nachricht." })
  .max(ZUSTELLUNG_NACHRICHT_ID_MAX_LENGTH, { error: "Diese Nachrichten-ID ist zu lang." });

// No floor beside the ceiling: the endpoint takes an empty reason and a `null` alike, a refusal
// carrying no token still being a fact about the mailbox. The class is screened as the endpoint
// screens it.
const grundFeld = einzeiligerName(
  z.string().trim().max(ZUSTELLUNG_GRUND_MAX_LENGTH, { error: "Dieser Grund ist zu lang." }),
  "Der Grund",
).nullable();

/** Mirrors `FLZustellungAngenommenPayload` — one message the provider took. No `stand`: that endpoint records `angenommen` and refuses anything else. */
export const FLZustellungAngenommenPayloadSchema = z.object({ ...zielMeldungFields, nachricht_id: nachrichtIdFeld }).superRefine(sitzeZumZiel);
export type FLZustellungAngenommenPayload = z.infer<typeof FLZustellungAngenommenPayloadSchema>;

/** Mirrors `FLZustellungAbgewiesenPayload` — a send the provider refused. No `nachricht_id`: nothing was minted for it to name. */
export const FLZustellungAbgewiesenPayloadSchema = z.object({ ...zielMeldungFields, grund: grundFeld }).superRefine(sitzeZumZiel);
export type FLZustellungAbgewiesenPayload = z.infer<typeof FLZustellungAbgewiesenPayloadSchema>;

/** Mirrors `FLZustellungEreignisPayload` — one event the provider sent about a message already recorded. */
export const FLZustellungEreignisPayloadSchema = z
  .object({
    ...zielMeldungFields,
    nachricht_id: nachrichtIdFeld,
    // Without `angenommen`, which the acceptance endpoint alone writes: a webhook composing one would
    // be refused 422 and retried for thirty-two hours over a state no event of the provider's carries.
    stand: FLBewerbungZustellstandSchema.exclude(["angenommen"]),
    grund: grundFeld,
  })
  .superRefine(sitzeZumZiel);
export type FLZustellungEreignisPayload = z.infer<typeof FLZustellungEreignisPayloadSchema>;

/** Whether the write reached the record. `false` is a superseded message or an event already answered, and is not a refusal. */
export const FLZustellungResponseSchema = BaseAPIResponseSchema.extend({
  angewendet: z.boolean(),
});
export type FLZustellungResponse = z.infer<typeof FLZustellungResponseSchema>;
