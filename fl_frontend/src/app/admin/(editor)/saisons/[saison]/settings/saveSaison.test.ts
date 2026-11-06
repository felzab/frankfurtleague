import { doubleApiClient } from "@/test-support/apiClientDouble";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import type { FLPatchSaisonPayload, FLSaisonAdmin } from "@/core/generated/client/types";

/** A season with both windows and every rule set, so a save dropping one is seen. */
const STORED: FLSaisonAdmin = {
  id: "2027",
  start_date: "2027-03-06",
  end_date: "2027-07-03",
  rules: {
    win_points: 3,
    draw_points: 1,
    loss_points: 0,
    tiebreak_order: "tordifferenz",
    number_of_gruppen: 4,
    teams_per_gruppe: 4,
    qualifiers_per_gruppe: 2,
    max_kader_size: 18,
    allowed_stufen: ["E1", "E2", "Q1"],
    forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
  },
  bewerbung: { open: true, start: "2027-01-10", end: "2027-02-07" },
  registrierung: { end: "2027-03-05", open: false },
  schedule: [],
  status: "future",
  begun: false,
  taken_place: false,
  decided: false,
  version: 3,
};

/** Every payload the save sends, and the season the save reads. */
const stand = vi.hoisted(() => ({ sent: [] as unknown[], saison: null as unknown }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a save clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));
vi.mock("@/features/saisons/queries", () => ({ getAdminSaison: async () => ({ saison: stand.saison }) }));

// The backend client itself is replaced, so the write runs through the real generated call and the real dispatch.
doubleApiClient((call) => {
  stand.sent.push(JSON.parse(call.body ?? "null"));
  return { version: 4 };
});

const { saveSaison } = await import("./saveSaison");

beforeEach(() => {
  stand.sent = [];
  stand.saison = STORED;
});

describe("the season editor's save", () => {
  /* The write replaces the season whole: a field the editor left alone and the save dropped would reset in silence. */
  it("sends its changes over every stored field, on the version it read, and answers the one the write stored", async () => {
    const answer = await saveSaison({ id: "2027", version: 3, changes: { gruppen: "2", registrierungPaused: false } });

    expect(answer).toEqual({ ok: true, value: 4 });
    expect(stand.sent).toEqual([
      {
        start_date: "2027-03-06",
        end_date: "2027-07-03",
        rules: { ...STORED.rules, number_of_gruppen: 2 },
        bewerbung: { open: true, start: "2027-01-10", end: "2027-02-07" },
        registrierung: { end: "2027-03-05", open: true },
        version: 3,
      } satisfies FLPatchSaisonPayload,
    ]);
  });

  /* The write replaces the window whole: a pause dropped from it would open a form the league closed, in silence. */
  it("sets the application form's pause alone and keeps a stored one through a save that leaves it", async () => {
    await saveSaison({ id: "2027", version: 3, changes: { bewerbungPaused: true } });
    stand.saison = { ...STORED, bewerbung: { open: false, start: "2027-01-10", end: "2027-02-07" } };
    await saveSaison({ id: "2027", version: 3, changes: { maxKader: "20" } });

    expect(stand.sent).toMatchObject([
      { bewerbung: { open: false, start: "2027-01-10", end: "2027-02-07" }, registrierung: STORED.registrierung },
      { bewerbung: { open: false, start: "2027-01-10", end: "2027-02-07" } },
    ]);
  });

  /* A window with one day gone would be sent as no window, deleting the whole window under „Gespeichert“. */
  it.each(["bewerbungStart", "bewerbungEnd"] as const)(
    "refuses an application window left without its %s, before the write",
    async (cleared) => {
      const answer = await saveSaison({ id: "2027", version: 3, changes: { [cleared]: null } });

      expect(answer).toEqual({ ok: false, fieldErrors: { [`changes.${cleared}`]: COPY.shared.field.required } });
      expect(stand.sent).toEqual([]);
    },
  );
});
