import { doubleApiClient, requestsOf } from "@/test-support/apiClientDouble";
import { bodyField } from "@/test-support/refusedPayload";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";

import type { SpielortField } from "./spielortRules";

/** What the create throws instead of creating the venue. */
const state = vi.hoisted(() => ({ refusal: null as unknown }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action, and the write the real dispatch counts reaches it; whether a
// save clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

// The backend client itself is replaced, so the create runs through the real generated call and the real dispatch,
// which counts the write and takes it back where the backend refuses it.
const calls = doubleApiClient(() => {
  if (state.refusal !== null) throw state.refusal;
  return { created_id: "64b000000000000000000009" };
});

const { createSpielort } = await import("./createSpielort");

const FIELDS: Readonly<Record<SpielortField, string>> = {
  name: "Sportpark Nord",
  strasse: "Am Riedberg",
  hausnummer: "12",
  plz: "60438",
  stadtteil: "Riedberg",
  stadt: "Frankfurt am Main",
  mietpreis: "60",
};

const posted = (fields: Partial<Record<SpielortField, string>> = {}) => {
  const formData = new FormData();
  for (const [name, value] of Object.entries({ ...FIELDS, ...fields })) formData.set(name, value);
  return formData;
};

beforeEach(() => {
  calls.length = 0;
  state.refusal = null;
});

describe("the venue dialog's create", () => {
  it("sends the dialog's boxes as the create's payload, with the price as a figure", async () => {
    expect(await createSpielort(posted())).toStrictEqual({ ok: true, value: undefined });
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
  });

  it("places a name another venue holds on the name's box, by the path the create names", async () => {
    state.refusal = new APIBadStatusError({
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

    expect(await createSpielort(posted())).toStrictEqual({
      ok: false,
      errorCode: "duplicate_key",
      fieldErrors: { name: COPY.shared.field.taken },
    });
  });

  it("keeps a price that is no figure back on its box, sending nothing", async () => {
    expect(await createSpielort(posted({ mietpreis: "60 Euro" }))).toStrictEqual({
      ok: false,
      fieldErrors: { mietpreis: COPY.shared.field.format(COPY.admin.spielort.mietpreisExample) },
    });
    expect(calls).toStrictEqual([]);
  });
});
