import { publishedRefusals, refusedOn } from "@/test-support/publishedRefusals.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";

import { spielortAnlegen } from "./spielortAnlegen";

import type { SpielortFeld } from "./spielortRegeln";

const ANLEGEN = "POST /spielorte";

/** Every payload the write was sent, and what it throws instead of creating the venue. */
const stand = vi.hoisted(() => ({
  gesendet: [] as unknown[],
  ablehnung: null as unknown,
  /** Why the guard turns the create away, or `null` where it admits it. */
  abgewiesen: null as string | null,
  /** The spine found that the write it sent may stand, whatever the body made of it. */
  unklar: false,
}));

vi.mock("@/features/spielorte/mutations", () => ({
  postSpielort: async (payload: unknown) => {
    stand.gesendet.push(payload);
    if (stand.ablehnung !== null) throw stand.ablehnung;
    return { acknowledged: 1, created_id: "64b000000000000000000009" };
  },
}));

// The guard's spine: it turns a session away with the create's own `turnedAway`, or runs the body and answers
// its own unclear outcome where the write it sent may stand.
vi.mock("@/shared/utils/adminMutation", () => ({
  runAdminMutation: async (_name: string, declared: { turnedAway: (grund: string) => string }, body: () => Promise<unknown>) => {
    if (stand.abgewiesen !== null) return { success: false, error: declared.turnedAway(stand.abgewiesen) };
    const answer = await body();
    return stand.unklar ? { success: false, error: "Ob gespeichert wurde, ist unklar.", outcome: "unknown" } : answer;
  },
  FORBIDDEN_BY_REFUSAL: { signIn: "abgelaufen", noGrant: "kein Zugang", grantGone: "kein Zugang", unread: "ungelesen" },
}));

const FELDER: Readonly<Record<SpielortFeld, string>> = {
  name: "Sportpark Nord",
  strasse: "Am Riedberg",
  hausnummer: "12",
  plz: "60438",
  stadtteil: "Riedberg",
  stadt: "Frankfurt am Main",
  mietpreis: "60",
};

const formular = (felder: Partial<Record<SpielortFeld, string>> = {}) => {
  const formData = new FormData();
  for (const [name, wert] of Object.entries({ ...FELDER, ...felder })) formData.set(name, wert);
  return formData;
};

beforeEach(() => {
  stand.gesendet = [];
  stand.ablehnung = null;
  stand.abgewiesen = null;
  stand.unklar = false;
});

describe("the venue dialog's create", () => {
  it("creates the venue from the dialog's fields and answers done", async () => {
    expect(await spielortAnlegen(formular())).toEqual({ ok: true, value: undefined });
    expect(stand.gesendet).toEqual([
      {
        name: "Sportpark Nord",
        default_mietpreis: 60,
        address: { strasse: "Am Riedberg", hausnummer: "12", plz: "60438", stadtteil: "Riedberg", stadt: "Frankfurt am Main" },
      },
    ]);
  });

  it("places a name another venue holds on the name's field", async () => {
    stand.ablehnung = refusedOn(ANLEGEN, "DB-COMMON-002");

    expect(await spielortAnlegen(formular())).toEqual({ ok: false, fieldErrors: { name: COPY.shared.feld.schonVergeben } });
  });

  it("answers every refusal the create publishes in words of its own", async () => {
    for (const code of publishedRefusals(ANLEGEN)) {
      stand.ablehnung = refusedOn(ANLEGEN, code);
      expect(await spielortAnlegen(formular()), `${code} reaches the admin as the unexpected failure`).not.toEqual({ ok: false });
    }
  });

  it("tells a name the backend's own schema refuses from a taken one", async () => {
    // Python's strip drops the file separator, JavaScript's trim keeps it: the dialog's schema passes the name.
    stand.ablehnung = new APIBadStatusError({
      message: "refused",
      url: "http://backend/api/v0/spielorte",
      statusCode: 422,
      serverErrorCode: "REQ-VAL-001",
      endpoint: "/spielorte",
      method: "POST",
      readOnly: false,
      traceId: "0",
      refusedFields: [{ in: "body", path: ["name"], kind: "string_too_short" }],
    });

    expect(await spielortAnlegen(formular({ name: "\u001c" }))).toEqual({ ok: false });
    expect(stand.gesendet).toHaveLength(1);
  });

  it("answers a payload the write's schema refuses as unexpected, sending nothing", async () => {
    expect(await spielortAnlegen(formular({ name: "   " }))).toEqual({ ok: false });
    expect(await spielortAnlegen(formular({ mietpreis: "60 Euro" }))).toEqual({ ok: false });
    expect(stand.gesendet).toEqual([]);
  });

  it("sends a session the guard found ended to sign in again, sending nothing", async () => {
    stand.abgewiesen = "signIn";

    expect(await spielortAnlegen(formular())).toEqual({ ok: false, reason: COPY.shared.fehler.abgelaufen });
    expect(stand.gesendet).toEqual([]);
  });

  it("answers the guard's other refusals as unexpected, which no sign-in repairs", async () => {
    stand.abgewiesen = "unread";

    expect(await spielortAnlegen(formular())).toEqual({ ok: false });
  });

  // A second press would meet the venue the first one made, and say its name is taken.
  it("sends a create nobody can tell landed to reload the page, never to press again", async () => {
    stand.unklar = true;

    expect(await spielortAnlegen(formular())).toEqual({ ok: false, reason: COPY.shared.fehler.veraltet });
  });
});
