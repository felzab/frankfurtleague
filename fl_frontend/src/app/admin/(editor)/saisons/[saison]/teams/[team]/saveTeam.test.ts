import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { describe, expect, it } from "vitest";

const TEAM_ID = "64b000000000000000000002";
const SAISON = "2027";

/** The one address the editor's read and the save's write share. */
const ENDPOINT = `/teams/${TEAM_ID}/saisons/${SAISON}/admin`;

/** The club read again at a count newer than the editor's: someone saved since. */
const STORED = {
  team: {
    name: "Goethe",
    shorthand: "GOE",
    full_name: "Goethe-Gymnasium",
    schulform: "gymnasium",
    website_url: "https://goethe.example",
    description: "Im Westend",
    address: { street: "Friedrichstraße", house_number: "1", postcode: "60323", district: "Westend", city: "Frankfurt" },
  },
  membership: { gruppe: "A", trikot_farbe: "rot" },
};

/** The editor's read, behind the stored club. */
const EDITOR_VERSION = 8;

// The save reads the club and its row again and writes both at the same address, so the real guard, query, generated
// call and dispatch all run; anything else is unanswered and fails the case.
const backend = serveBackend(({ method, path }) => {
  if (path !== ENDPOINT) return undefined;
  if (method === "GET") return STORED;
  if (method === "PATCH") return { version: 11 };
  return undefined;
});
// An administrator's session, made by passkey, which the save's guard admits.
signedInRequest();

const { saveTeam } = await import("./saveTeam");

/** The bodies of every write the save sent. */
const written = () => backend.sent.filter(({ method }) => method === "PATCH").map(({ body }) => body);

describe("a club's save", () => {
  // The write replaces both documents whole: a field left alone sent as anything but stored erases a club's address or
  // its description, and the bar still says „Gespeichert“. The stored count in the editor's place would write over
  // someone else's save.
  it("sends what it changes with the rest as stored, on the count the editor read", async () => {
    const answer = await saveTeam({ id: TEAM_ID, saison_id: SAISON, version: EDITOR_VERSION, changes: { name: "Goethe 2" } });

    expect(backend.sent.map(({ method, path }) => `${method} ${path}`)).toStrictEqual([`GET ${ENDPOINT}`, `PATCH ${ENDPOINT}`]);
    expect(written()).toStrictEqual([
      {
        name: "Goethe 2",
        shorthand: "GOE",
        full_name: "Goethe-Gymnasium",
        description: "Im Westend",
        schulform: "gymnasium",
        website_url: "https://goethe.example",
        address: { street: "Friedrichstraße", house_number: "1", postcode: "60323", district: "Westend", city: "Frankfurt" },
        gruppe: "A",
        trikot_farbe: "rot",
        version: EDITOR_VERSION,
      },
    ]);
    expect(answer).toStrictEqual({ ok: true, value: 11 });
  });

  // An emptied select or box is a value the person chose to clear, never one left alone.
  it("clears what the editor emptied", async () => {
    await saveTeam({ id: TEAM_ID, saison_id: SAISON, version: EDITOR_VERSION, changes: { schulform: "", website_url: "", trikot_farbe: "" } });

    expect(written()).toMatchObject([{ schulform: null, website_url: null, trikot_farbe: null, gruppe: "A", name: "Goethe" }]);
  });
});
