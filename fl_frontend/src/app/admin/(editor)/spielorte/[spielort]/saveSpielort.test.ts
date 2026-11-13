import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { describe, expect, it } from "vitest";

import type { FLPatchSpielortResponse, FLSpielort } from "@/core/generated/client/types";

const SPIELORT_ID = "64b000000000000000000002";

/** The one address the editor's read and the save's write share. */
const ENDPOINT = `/spielorte/${SPIELORT_ID}`;

/** The venue read again at a count newer than the editor's: someone saved since. */
const STORED = {
  id: SPIELORT_ID,
  name: "Sportpark West",
  address: { street: "Am Sportfeld", house_number: "3", postcode: "60489", district: "Rödelheim", city: "Frankfurt" },
  default_mietpreis: 40,
  version: 9,
} as FLSpielort;

/** The editor's read, behind the stored venue. */
const EDITOR_VERSION = 8;

const WRITTEN: FLPatchSpielortResponse = { version: 11 };

// The save reads the venue again and writes it at the same address, so the real guard, query, generated call and
// dispatch all run; anything else is unanswered and fails the case.
const backend = serveBackend(({ method, path }) => {
  if (path !== ENDPOINT) return undefined;
  if (method === "GET") return { spielort: STORED };
  if (method === "PATCH") return WRITTEN;
  return undefined;
});
// An administrator's session, made by passkey, which the save's guard admits.
signedInRequest();

const { saveSpielort } = await import("./saveSpielort");

describe("a venue's save", () => {
  // The write replaces the record whole: a field left alone sent as anything but stored erases it, and the save still
  // answers „Gespeichert“. The stored count in the editor's place would write over someone else's save.
  it("sends what it changes with the rest as stored, on the count the editor read", async () => {
    const answer = await saveSpielort({ id: SPIELORT_ID, version: EDITOR_VERSION, changes: { name: "Sportpark Nord" } });

    expect(backend.sent.map(({ method, path, body }) => ({ method, path, body }))).toStrictEqual([
      { method: "GET", path: ENDPOINT, body: undefined },
      {
        method: "PATCH",
        path: ENDPOINT,
        body: {
          name: "Sportpark Nord",
          default_mietpreis: 40,
          address: { street: "Am Sportfeld", house_number: "3", postcode: "60489", district: "Rödelheim", city: "Frankfurt" },
          version: EDITOR_VERSION,
        },
      },
    ]);
    expect(answer).toStrictEqual({ ok: true, value: WRITTEN.version });
  });
});
