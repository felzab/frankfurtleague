import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";

import { spielortAnlegen } from "./spielortAnlegen";

import type { SpielortFeld } from "./spielortRegeln";

/** Every payload the create was sent, and what it throws instead of creating the venue. */
const stand = vi.hoisted(() => ({ gesendet: [] as unknown[], ablehnung: null as unknown }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));
vi.mock("@/core/generated/client/sdk", () => ({
  spielortePostSpielort: async (payload: unknown) => {
    stand.gesendet.push(payload);
    if (stand.ablehnung !== null) throw stand.ablehnung;
    return { created_id: "64b000000000000000000009" };
  },
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
});

describe("the venue dialog's create", () => {
  it("sends the dialog's boxes as the create's payload, the price as a figure", async () => {
    expect(await spielortAnlegen(formular())).toStrictEqual({ ok: true, value: undefined });
    expect(stand.gesendet).toStrictEqual([
      {
        name: "Sportpark Nord",
        default_mietpreis: 60,
        address: { strasse: "Am Riedberg", hausnummer: "12", plz: "60438", stadtteil: "Riedberg", stadt: "Frankfurt am Main" },
      },
    ]);
  });

  it("places a name another venue holds on the name's box", async () => {
    stand.ablehnung = new APIBadStatusError({
      message: "refused",
      url: "http://backend/api/v0/spielorte",
      statusCode: 409,
      serverErrorCode: "duplicate_key",
      endpoint: "/spielorte",
      method: "POST",
      readOnly: false,
      traceId: "0",
    });

    expect(await spielortAnlegen(formular())).toStrictEqual({
      ok: false,
      errorCode: "duplicate_key",
      fieldErrors: { name: COPY.shared.feld.schonVergeben },
    });
  });

  it("keeps a price that is no figure back on its box, sending nothing", async () => {
    expect(await spielortAnlegen(formular({ mietpreis: "60 Euro" }))).toStrictEqual({
      ok: false,
      fieldErrors: { mietpreis: COPY.shared.feld.format(COPY.verwaltung.spielort.mietpreisBeispiel) },
    });
    expect(stand.gesendet).toStrictEqual([]);
  });
});
