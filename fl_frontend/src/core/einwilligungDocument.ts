import { readFileSync } from "node:fs";
import path from "node:path";

import z from "zod";

import { APIBadStatusError } from "./errors";
import { FLEinwilligungFassungSchema } from "./schemas";

import type { EinwilligungSeite } from "./einwilligungSeiten";
import type { FLEinwilligungFassung } from "./schemas";

const DOCUMENT_PATH = path.resolve(import.meta.dirname, "..", "..", "..", "fl_backend", "einwilligung.json");

// A citation rather than the command, for `fl_frontend/src/core/openapiDocument.ts :: REGENERATE_CITATION`'s reason.
const REGENERATE_CITATION = "`fl_backend/tests/einwilligung_document.py`";

// Parsed through the words read's own mirror: a document the frontend could not take from the wire
// is one no test may stand on.
const EinwilligungDocumentSchema = z.object({
  fassungen: z.record(z.string(), FLEinwilligungFassungSchema),
  laufende_fassungen: z.record(z.string(), z.string()),
});

export type EinwilligungDocument = z.infer<typeof EinwilligungDocumentSchema>;

/**
 * The backend's registry as it generated it for the frontend's tests, which take every word from here
 * and none from a copy: the backend is the one place a label's words are defined.
 */
export function readEinwilligungDocument(): EinwilligungDocument {
  let roh: unknown;
  try {
    roh = JSON.parse(readFileSync(DOCUMENT_PATH, "utf8"));
  } catch (cause) {
    throw new Error(`Could not read ${DOCUMENT_PATH}. Generate it with the command ${REGENERATE_CITATION} declares.`, { cause });
  }

  return EinwilligungDocumentSchema.parse(roh);
}

/** The words `textVersion` names, throwing where the registry holds no such label. */
export function publishedFassung(textVersion: string, document: EinwilligungDocument = readEinwilligungDocument()): FLEinwilligungFassung {
  const fassung = Object.hasOwn(document.fassungen, textVersion) ? document.fassungen[textVersion] : undefined;
  if (fassung === undefined) throw new Error(`${DOCUMENT_PATH} holds no label ${textVersion}`);

  return fassung;
}

/** The words `seite` runs, throwing where the registry runs no label there. */
export function publishedLaufendeFassung(
  seite: EinwilligungSeite,
  document: EinwilligungDocument = readEinwilligungDocument(),
): FLEinwilligungFassung {
  const textVersion = Object.hasOwn(document.laufende_fassungen, seite) ? document.laufende_fassungen[seite] : undefined;
  if (textVersion === undefined) throw new Error(`${DOCUMENT_PATH} runs no label on ${seite}`);

  return publishedFassung(textVersion, document);
}

const FASSUNGEN = "/einwilligung/fassungen/";

/**
 * The backend's answer to either consent-wording read, off its generated registry; `undefined` for
 * any other endpoint. In `core`, so a core suite reaches it past the layer boundary.
 */
export function einwilligungAnswer(endpoint: string, document: EinwilligungDocument = readEinwilligungDocument()): unknown {
  if (endpoint === "/einwilligung/seiten") return { acknowledged: 1, laufende_fassungen: document.laufende_fassungen };
  if (!endpoint.startsWith(FASSUNGEN)) return undefined;

  const textVersion = decodeURIComponent(endpoint.slice(FASSUNGEN.length));
  if (Object.hasOwn(document.fassungen, textVersion)) return { acknowledged: 1, fassung: document.fassungen[textVersion] };

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
