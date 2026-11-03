import { doubleApiClient, requestsOf } from "@/test-support/apiClientDouble";
import { bodyField } from "@/test-support/refusedPayload";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";
import { SITE_CACHE_TAG } from "@/core/siteCache";

import type { SpielortFeld } from "./spielortRegeln";

/** What the create throws instead of creating the venue, and each tag the save cleared. */
const stand = vi.hoisted(() => ({ ablehnung: null as unknown, cleared: [] as string[] }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: (tag: string) => void stand.cleared.push(tag) }));
vi.mock("@/core/auth", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

// The backend client itself is replaced, so the create runs through the real generated call and the real dispatch,
// which counts the write and takes it back where the backend refuses it.
const calls = doubleApiClient(() => {
  if (stand.ablehnung !== null) throw stand.ablehnung;
  return { created_id: "64b000000000000000000009" };
});

const { spielortAnlegen } = await import("./spielortAnlegen");

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
  calls.length = 0;
  stand.ablehnung = null;
  stand.cleared = [];
});

describe("the venue dialog's create", () => {
  it("sends the dialog's boxes as the create's payload, the price as a figure, and clears the site's cache", async () => {
    expect(await spielortAnlegen(formular())).toStrictEqual({ ok: true, value: undefined });
    expect(requestsOf(calls)).toStrictEqual([
      {
        endpoint: "/spielorte",
        method: "POST",
        body: {
          name: "Sportpark Nord",
          default_mietpreis: 60,
          address: { strasse: "Am Riedberg", hausnummer: "12", plz: "60438", stadtteil: "Riedberg", stadt: "Frankfurt am Main" },
        },
      },
    ]);
    expect(stand.cleared).toStrictEqual([SITE_CACHE_TAG]);
  });

  it("places a name another venue holds on the name's box, by the path the create names", async () => {
    stand.ablehnung = new APIBadStatusError({
      message: "refused",
      url: "http://backend/api/v0/spielorte",
      statusCode: 409,
      serverErrorCode: "duplicate_key",
      refusedFields: [bodyField(["name"], "duplicate_key")],
      endpoint: "/spielorte",
      method: "POST",
      readOnly: false,
      traceId: "0",
    });

    expect(await spielortAnlegen(formular())).toStrictEqual({
      ok: false,
      errorCode: "duplicate_key",
      fieldErrors: { name: COPY.shared.field.taken },
    });
    // The refusal took the write back, so nothing the site caches changed.
    expect(stand.cleared).toStrictEqual([]);
  });

  it("keeps a price that is no figure back on its box, sending nothing", async () => {
    expect(await spielortAnlegen(formular({ mietpreis: "60 Euro" }))).toStrictEqual({
      ok: false,
      fieldErrors: { mietpreis: COPY.shared.field.format(COPY.verwaltung.spielort.mietpreisExample) },
    });
    expect(calls).toStrictEqual([]);
  });
});
