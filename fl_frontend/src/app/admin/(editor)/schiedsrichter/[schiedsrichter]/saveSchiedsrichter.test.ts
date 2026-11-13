import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { describe, expect, it } from "vitest";

import type { FLPatchSchiedsrichterResponse, FLSchiedsrichterSingleResponse } from "@/core/generated/client/types";

const SCHIEDSRICHTER_ID = "64b000000000000000000002";

/** The one address the editor's read and the save's write share. */
const ENDPOINT = `/schiedsrichter/${SCHIEDSRICHTER_ID}`;

/** The referee read again at a count newer than the editor's: someone saved since. */
const STORED = {
  schiedsrichter: {
    id: SCHIEDSRICHTER_ID,
    name: "Erika Muster",
    schule: "Goethe-Gymnasium",
    kontakt: { email: "erika@example.de", phone: "069 1234567" },
    default_payment: 25,
    version: 9,
  },
} as FLSchiedsrichterSingleResponse;

/** The editor's read, behind the stored referee. */
const EDITOR_VERSION = 8;

const WRITTEN: FLPatchSchiedsrichterResponse = { version: 11, confirmation: null };

// The save reads the referee again and writes it at the same address, so the real guard, query, generated call and
// dispatch all run; anything else is unanswered and fails the case.
const backend = serveBackend(({ method, path }) => {
  if (path !== ENDPOINT) return undefined;
  if (method === "GET") return STORED;
  if (method === "PATCH") return WRITTEN;
  return undefined;
});
// An administrator's session, made by passkey, which the save's guard admits.
signedInRequest();

const { saveSchiedsrichter } = await import("./saveSchiedsrichter");

describe("a referee's save", () => {
  // The write replaces the record whole: a field left alone sent as anything but stored erases it, and the save still
  // answers „Gespeichert“. The stored count in the editor's place would write over someone else's save.
  it("sends what it changes with the rest as stored, on the count the editor read", async () => {
    const answer = await saveSchiedsrichter({ id: SCHIEDSRICHTER_ID, version: EDITOR_VERSION, changes: { name: "Erika Neu" } });

    expect(backend.sent.map(({ method, path, body }) => ({ method, path, body }))).toStrictEqual([
      { method: "GET", path: ENDPOINT, body: undefined },
      {
        method: "PATCH",
        path: ENDPOINT,
        body: {
          name: "Erika Neu",
          schule: "Goethe-Gymnasium",
          kontakt: { email: "erika@example.de", phone: "069 1234567" },
          default_payment: 25,
          version: EDITOR_VERSION,
        },
      },
    ]);
    expect(answer).toStrictEqual({ ok: true, value: WRITTEN.version });
  });
});
