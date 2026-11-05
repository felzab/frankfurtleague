import { cache } from "react";

import { isRecordMissing } from "@/core/errors";
import {
  bewerbungenGetBewerbung,
  bewerbungenGetBewerbungen,
  bewerbungenGetKuerzel,
  bewerbungenGetSchulen,
  bewerbungenGetTrikotfarben,
  bewerbungenGetWindow,
} from "@/core/generated/client/sdk";
import { runWithIncomingTrace } from "@/core/traceScope";
import { runAdminRead } from "@/shared/utils/adminRead";

import { bewerbungenQueueTerms } from "./facets";
import { postEinwilligungAnsicht } from "./mutations";
import { mapEinwilligungAnsichtRefusal } from "./utils";

import type {
  BewerbungenGetBewerbungenParams,
  FLBewerbungenListResponse,
  FLBewerbungKuerzelResponse,
  FLBewerbungSchulenResponse,
  FLBewerbungSingleResponse,
  FLBewerbungTrikotFarbenResponse,
  FLBewerbungWindowResponse,
} from "@/core/generated/client/types";
import type { EinwilligungAnsicht } from "./types";

/**
 * Every application, newest first, narrowable by season and by any number of statuses.
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not caller identity, so a
 * cached read of this admin-tier personal data is a shared slot.
 */
export async function getBewerbungen(filters: BewerbungenGetBewerbungenParams = {}): Promise<FLBewerbungenListResponse> {
  // No cache tag either: one means nothing outside a cache scope.
  return runAdminRead(() => bewerbungenGetBewerbungen(filters));
}

/**
 * The queue as one route's query string selects it. Here rather than at the page: a facet carries a `read`
 * function, which a Server Component may not pass on.
 */
export async function getBewerbungenQueue(
  params: Readonly<Record<string, string | string[] | undefined>>,
  order: "asc" | "desc",
  saisonId: string | undefined,
): Promise<FLBewerbungenListResponse> {
  return getBewerbungen({ order: order, ...bewerbungenQueueTerms(params, saisonId) });
}

/**
 * The one application the triage page decides against, uncached for the reason above. `null` on a
 * 404, which the page turns into `notFound()`; everything else throws.
 */
// `cache` memoizes per RENDER PASS, never `"use cache"`, which keys on the arguments.
export const getBewerbungById = cache(async (bewerbungId: string): Promise<FLBewerbungSingleResponse | null> =>
  runAdminRead(() =>
    bewerbungenGetBewerbung(bewerbungId).catch((error: unknown) => {
      if (isRecordMissing(error)) return null;
      throw error;
    }),
  ),
);

/**
 * One season's window, `null` where that season records none — and `null` for the whole answer where
 * no season carries the id, which is the page's `notFound()`.
 */
// `cache`, never `"use cache"`: the metadata and the body read this once between them, and a cache
// would key on the season and go on serving `laeuft` after the window shut.
export const getBewerbungWindow = cache(async (saisonId: string): Promise<{ window: FLBewerbungWindowResponse | null } | null> =>
  runWithIncomingTrace(() =>
    bewerbungenGetWindow(saisonId)
      // The answer naming no window carries the one key a window has not got.
      .then((antwort) => ("window" in antwort ? { window: null } : { window: antwort }))
      .catch((error: unknown) => {
        if (isRecordMissing(error)) return null;
        throw error;
      }),
  ),
);

/** The clubs a school picks itself out of, name and id alone, in the order the picker offers them. */
export async function getBewerbungSchulen(): Promise<FLBewerbungSchulenResponse> {
  return runWithIncomingTrace(() => bewerbungenGetSchulen());
}

/**
 * Which colours one season has ASSIGNED — `saison_teams.trikot_farbe`, never a wish. Uncached for
 * `getBewerbungKuerzel`'s reason: one is assigned between two page loads, and a cached "still
 * free" outlives that.
 */
export async function getBewerbungTrikotfarben(saisonId: string): Promise<FLBewerbungTrikotFarbenResponse> {
  return runWithIncomingTrace(() => bewerbungenGetTrikotfarben(saisonId));
}

/**
 * One link's standing, read on every open and stored nowhere: a GET records nothing, not even a
 * visit, because mail scanners fetch every link in a message.
 */
export async function getEinwilligungAnsicht(token: string): Promise<EinwilligungAnsicht> {
  return runWithIncomingTrace(() =>
    postEinwilligungAnsicht({ token: token }).then(
      // Narrowed here and never at the page, which would carry the school and the season regardless: a
      // dead link's panel names nothing of the seat. An emptied seat arrives as an unknown token.
      (view): EinwilligungAnsicht => {
        const { state } = view;
        // A closed season row's link still takes a Widerspruch, so it keeps its read as an open one does.
        if (state !== "valid" && state !== "saison_past") return { zustand: state, quelle: view.quelle };

        return { zustand: state, ansicht: view };
      },
      (error: unknown) => {
        // Anything but a refusal is a failed read, which is the page's own state rather than a panel
        // calling a live link void.
        const state = mapEinwilligungAnsichtRefusal(error);
        if (state !== null) return { zustand: state };
        throw error;
      },
    ),
  );
}

/** Whether a Kürzel already belongs to a club, in one neutral answer that names none. */
export async function getBewerbungKuerzel(shorthand: string): Promise<FLBewerbungKuerzelResponse> {
  return runWithIncomingTrace(() => bewerbungenGetKuerzel(shorthand));
}
