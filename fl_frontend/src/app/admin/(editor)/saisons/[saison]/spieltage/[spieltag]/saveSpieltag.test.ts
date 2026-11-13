import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { describe, expect, it } from "vitest";

import type { FLSpieltagAdmin, FLSpieltagAdminResponse, FLSpieltagWriteResponse } from "@/core/generated/client/types";

const SPIELTAG_ID = "64b000000000000000000002";

/** A dated matchday, read again at a version newer than the editor's: someone re-dated it since. */
const STORED: FLSpieltagAdmin = {
  id: SPIELTAG_ID,
  saison_id: "2027",
  saison_phase: "gruppenphase",
  position: 2,
  count_spieltage_in_phase: 5,
  count_spiele: 4,
  start: "2027-03-13",
  end: "2027-03-15",
  version: 4,
};

/** The editor's read, one version behind the stored matchday. */
const EDITOR_VERSION = 3;

const WRITTEN: FLSpieltagWriteResponse = { spieltag_id: SPIELTAG_ID, version: 5 };

// The save reads the matchday again and writes it, so the real guard, query, generated call and dispatch all run;
// anything else is unanswered and fails the case.
const backend = serveBackend(({ method, path }) => {
  if (method === "GET" && path === `/spieltage/${SPIELTAG_ID}/admin`) {
    return { saison_status: "active", spieltag: STORED } satisfies FLSpieltagAdminResponse;
  }
  if (method === "PATCH" && path === `/spieltage/${SPIELTAG_ID}`) return WRITTEN;
  return undefined;
});
// An administrator's session, made by passkey, which the save's guard admits.
signedInRequest();

const { saveSpieltag } = await import("./saveSpieltag");

describe("a matchday's save", () => {
  // The write takes both days and is judged on the version sent: the stored one in its place would write over a
  // re-dating someone else made since the editor was read, and the save would still answer „Gespeichert“.
  it("sends the day it changes with the other as stored, on the version the editor read", async () => {
    const answer = await saveSpieltag({ id: SPIELTAG_ID, version: EDITOR_VERSION, changes: { end: "2027-03-16" } });

    expect(backend.sent.map(({ method, path, body }) => ({ method, path, body }))).toStrictEqual([
      { method: "GET", path: `/spieltage/${SPIELTAG_ID}/admin`, body: undefined },
      { method: "PATCH", path: `/spieltage/${SPIELTAG_ID}`, body: { start: "2027-03-13", end: "2027-03-16", version: EDITOR_VERSION } },
    ]);
    expect(answer).toStrictEqual({ ok: true, value: WRITTEN.version });
  });
});
