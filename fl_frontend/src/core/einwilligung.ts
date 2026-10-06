import "server-only";

import { cache } from "react";
import { cacheLife } from "next/cache";

import { apiClient } from "./api";
import { ContractBreakError, isRecordMissing } from "./errors";
import { FLEinwilligungFassungResponseSchema, FLEinwilligungSeitenResponseSchema } from "./schemas";

import type { EinwilligungSeite } from "./einwilligungSeiten";
import type { FLEinwilligungFassung } from "./schemas";

/**
 * The words a stored label names, `null` for one the registry does not hold. Never a fallback: the
 * running words under an old label are a record claiming a text its person never read.
 */
export async function getEinwilligungFassung(textVersion: string): Promise<FLEinwilligungFassung | null> {
  "use cache";

  // Untagged and at the longest life: a label's words never change, so nothing has a reason to drop it.
  cacheLife("max");

  try {
    const antwort = await apiClient(`/einwilligung/fassungen/${encodeURIComponent(textVersion)}`, FLEinwilligungFassungResponseSchema, {
      authType: "base",
      cacheFill: { name: "getEinwilligungFassung", args: textVersion },
    });
    return antwort.fassung;
  } catch (error) {
    // Inside the cached scope: a production build redacts what a `"use cache"` function throws
    // (`docs/frontend/spec.md` §1.2).
    if (isRecordMissing(error)) return null;
    throw error;
  }
}

/**
 * Whether the registry holds the label a record stores; `true` for a record storing none, which an
 * admin editor words for itself. Called inside the request's trace scope.
 */
export async function istFassungBekannt(textVersion: string | null): Promise<boolean> {
  return textVersion === null || (await getEinwilligungFassung(textVersion)) !== null;
}

// React's `cache` and never `"use cache"`: a deploy moves a page's running label, and a frontend
// recreated before the backend would go on stamping a label the backend has moved past.
/** Each page's running label, read once per render pass. Called inside the request's trace scope. */
const getLaufendeFassungen = cache(async (): Promise<Readonly<Record<string, string>>> => {
  const antwort = await apiClient("/einwilligung/seiten", FLEinwilligungSeitenResponseSchema, { authType: "base" });
  return antwort.laufende_fassungen;
});

/** The label `seite` stamps on a new acceptance. Throws where the backend names none for it. */
export async function getLaufendesLabel(seite: EinwilligungSeite): Promise<string> {
  const laufend = await getLaufendeFassungen();
  const textVersion = Object.hasOwn(laufend, seite) ? laufend[seite] : undefined;
  if (textVersion === undefined) throw new ContractBreakError(`the backend runs no label for the page ${seite}`);

  return textVersion;
}

/** The words `seite` runs, its label among them. Throws where the backend serves no words for it. */
export async function getLaufendeFassung(seite: EinwilligungSeite): Promise<FLEinwilligungFassung> {
  const textVersion = await getLaufendesLabel(seite);
  const fassung = await getEinwilligungFassung(textVersion);
  if (fassung === null) throw new ContractBreakError(`the backend runs ${textVersion} on ${seite} and serves no words for it`);

  return fassung;
}
