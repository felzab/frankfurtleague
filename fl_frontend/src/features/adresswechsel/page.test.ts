import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { answer, answerReadsWith, clearSteps, EMPTIEST_ANSWER, pageBody, steps } from "@/shared/testing/pageHarness.ts";
import { refusedOn } from "@/shared/testing/publishedRefusals.ts";

const { setSession } = doubleActionRequest();

/* Reached with `await import` and never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: AdminAdresswechselPage } = await import("@/app/bereich/admin/adresswechsel/page.tsx");

const OPERATION = "POST /adresswechsel/ansicht";
const ADRESSWECHSEL_ID = "68c1f0a2b3c4d5e6f7a8b9e0";

const ANSICHT = {
  adresse: "lena.meier@schule.example",
  bestand: { spieler: 1, schiedsrichter: 0, sitze: 0, bewerbungssitze: 0, registrierungen: 0, berechtigung: null },
  moeglich: true,
  offen: null,
};

/** What the tool's read answers, or the refusal it throws, until a case names another. */
let ansicht: () => object = () => ANSICHT;

answerReadsWith((endpoint, schema, params) => {
  if (endpoint === "/adresswechsel/ansicht") return answer(schema, endpoint, ansicht());
  if (endpoint === "/identitaet/subjekt") {
    return answer(schema, endpoint, { verwaltung: "administration", berechtigt_seit: "2026-01-01T00:00:00Z", inhaber_seit: null });
  }
  return EMPTIEST_ANSWER(endpoint, schema, params);
});

beforeEach(() => {
  ansicht = () => ANSICHT;
  clearSteps();
  setSession({ user: { email: "vorstand@schule.de" } });
});

/** What the page hands the tool, opened on `query`. */
const anfangFor = async (query: Record<string, string>): Promise<unknown> =>
  ((await pageBody(AdminAdresswechselPage, { params: Promise.resolve({}), searchParams: Promise.resolve(query) })).props as { anfang: unknown })
    .anfang;

const toolReads = (): unknown[] =>
  steps.flatMap((step) => (step.kind === "read" && step.endpoint === "/adresswechsel/ansicht" ? [step.body] : []));

/* Every editor's „Zur Änderung“ link opens the tool by the change's id, never by an address a URL would keep. */
describe("the address tool opened by a change's id", () => {
  it("reads the change by its id and hands the tool what it read", async () => {
    const anfang = await anfangFor({ adresswechsel: ADRESSWECHSEL_ID });

    assert.deepEqual(toolReads(), [{ adresswechsel_id: ADRESSWECHSEL_ID }]);
    assert.deepEqual(anfang, { status: "read", ansicht: { acknowledged: 0, ...ANSICHT } });
  });

  /* A link outlives its change: the panel says the change ended, never the page's error boundary. */
  it("hands the tool its own sentence where the change has ended since the link was made", async () => {
    ansicht = () => {
      throw refusedOn(OPERATION, "REQ-ADRESSWECHSEL-002");
    };

    assert.deepEqual(await anfangFor({ adresswechsel: ADRESSWECHSEL_ID }), {
      status: "refused",
      reason: "Diese Änderung ist schon beendet. Lade die Seite neu.",
    });
  });

  it("hands the tool its own sentence where no change holds the id", async () => {
    ansicht = () => {
      throw refusedOn(OPERATION, "DB-COMMON-001");
    };

    assert.deepEqual(await anfangFor({ adresswechsel: ADRESSWECHSEL_ID }), {
      status: "refused",
      reason: "Diese Änderung gibt es nicht. Gib die Adresse ein, um die es geht.",
    });
  });

  it("opens empty and reads nothing where no id or a malformed one is named", async () => {
    assert.equal(await anfangFor({}), null);
    assert.equal(await anfangFor({ adresswechsel: "kein-id" }), null);
    assert.deepEqual(toolReads(), []);
  });
});
