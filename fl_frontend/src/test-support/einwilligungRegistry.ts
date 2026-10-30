import { APIBadStatusError } from "@/core/errors";

import REGISTRY from "./einwilligungRegistry.json";

import type { EinwilligungSeite } from "@/core/einwilligungSeiten";
import type { FLEinwilligungFassung } from "@/core/generated/client/types";

/**
 * A plain fixture of the consent registry: each page's running label and the words of those and of four older labels
 * the suites name, as the backend's registry held them on 2026-10-29. The backend owns the words, so a suite here
 * judges what the frontend does with words shaped like these, never the words themselves.
 */
export const EINWILLIGUNG_REGISTRY: {
  readonly laufende_fassungen: Readonly<Record<string, string>>;
  readonly fassungen: Readonly<Record<string, FLEinwilligungFassung>>;
} = REGISTRY;

/** The words `textVersion` names, throwing where the fixture holds no such label. */
export function fassungOf(textVersion: string): FLEinwilligungFassung {
  const fassung = Object.hasOwn(EINWILLIGUNG_REGISTRY.fassungen, textVersion) ? EINWILLIGUNG_REGISTRY.fassungen[textVersion] : undefined;
  if (fassung === undefined) throw new Error(`the consent fixture holds no label ${textVersion}`);

  return fassung;
}

/** The words `seite` runs, throwing where the fixture runs no label there. */
export function laufendeFassung(seite: EinwilligungSeite): FLEinwilligungFassung {
  const textVersion = Object.hasOwn(EINWILLIGUNG_REGISTRY.laufende_fassungen, seite)
    ? EINWILLIGUNG_REGISTRY.laufende_fassungen[seite]
    : undefined;
  if (textVersion === undefined) throw new Error(`the consent fixture runs no label on ${seite}`);

  return fassungOf(textVersion);
}

const FASSUNGEN = "/einwilligung/fassungen/";

/** The backend's answer to either consent-wording read, off the fixture; `undefined` for any other endpoint. */
export function einwilligungAnswer(endpoint: string): unknown {
  if (endpoint === "/einwilligung/seiten") return { laufende_fassungen: EINWILLIGUNG_REGISTRY.laufende_fassungen };
  if (!endpoint.startsWith(FASSUNGEN)) return undefined;

  const textVersion = decodeURIComponent(endpoint.slice(FASSUNGEN.length));
  if (Object.hasOwn(EINWILLIGUNG_REGISTRY.fassungen, textVersion)) return { fassung: EINWILLIGUNG_REGISTRY.fassungen[textVersion] };

  // The backend's own answer for a label its registry does not hold.
  throw new APIBadStatusError({
    message: "not found",
    url: `http://backend/api/v0${endpoint}`,
    statusCode: 404,
    serverErrorCode: "DB-COMMON-001",
    endpoint: endpoint,
    method: "GET",
    readOnly: true,
    traceId: "0",
  });
}
