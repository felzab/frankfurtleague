import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { describe, expect, it } from "vitest";

import type { FLPatchSpielerSaisonResponse, FLSpielerSaisonAdminResponse } from "@/core/generated/client/types";

const SPIELER_ID = "64b000000000000000000002";
const SAISON = "2027";

/** The one address the editor's read and the save's write share. */
const ENDPOINT = `/spieler/${SPIELER_ID}/saisons/${SAISON}/admin`;

/** The player read again at a count newer than the editor's: someone saved since. */
const STORED = {
  version: 9,
  person: { first_name: "Max", last_name: "Mustermann", birth_date: "2009-05-04" },
  kader: { nummer: "7", position: "Abwehr", stufe: "Q2", rolle: "kapitaen" },
} as FLSpielerSaisonAdminResponse;

/** The editor's read, behind the stored player. */
const EDITOR_VERSION = 8;

const WRITTEN: FLPatchSpielerSaisonResponse = { version: 11 };

// The save reads the player again and writes it at the same address, so the real guard, query, generated call and
// dispatch all run; anything else is unanswered and fails the case.
const backend = serveBackend(({ method, path }) => {
  if (path !== ENDPOINT) return undefined;
  if (method === "GET") return STORED;
  if (method === "PATCH") return WRITTEN;
  return undefined;
});
// An administrator's session, made by passkey, which the save's guard admits.
signedInRequest();

const { saveSpieler } = await import("./saveSpieler");

/** The bodies of every write the save sent. */
const written = () => backend.sent.filter(({ method }) => method === "PATCH").map(({ body }) => body);

describe("a player's save", () => {
  // The write replaces both documents whole: a field left alone sent as anything but stored erases it, and the save
  // still answers „Gespeichert“. The stored count in the editor's place would write over someone else's save.
  it("sends what it changes with the rest as stored, on the count the editor read", async () => {
    const answer = await saveSpieler({ id: SPIELER_ID, saison: SAISON, version: EDITOR_VERSION, changes: { first_name: "Maximilian" } });

    expect(backend.sent.map(({ method, path }) => `${method} ${path}`)).toStrictEqual([`GET ${ENDPOINT}`, `PATCH ${ENDPOINT}`]);
    expect(written()).toStrictEqual([
      {
        first_name: "Maximilian",
        last_name: "Mustermann",
        birth_date: "2009-05-04",
        nummer: "7",
        position: "Abwehr",
        stufe: "Q2",
        rolle: "kapitaen",
        version: EDITOR_VERSION,
      },
    ]);
    expect(answer).toStrictEqual({ ok: true, value: WRITTEN.version });
  });

  // An emptied select or box is a value the person chose to clear, never one left alone.
  it("clears what the editor emptied", async () => {
    await saveSpieler({ id: SPIELER_ID, saison: SAISON, version: EDITOR_VERSION, changes: { last_name: "", nummer: "", rolle: "" } });

    expect(written()).toMatchObject([{ last_name: null, nummer: null, rolle: null, position: "Abwehr" }]);
  });
});
