import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* `useRouter` and `useSearchParams` read contexts no `next/navigation` export carries, so the page
   renders under the two Next keeps them on. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { bestaetigungsStand, zusageHindernis } from "@/features/bewerbungen/bestaetigungStand.ts";
import { FLBewerbungSchema } from "@/features/bewerbungen/schemas.ts";
import { closedControl } from "@/shared/testing/closedControl.ts";

import type { FLBewerbung } from "@/features/bewerbungen/schemas.ts";
import type { ContextType } from "react";

const { AdminBewerbungView } = await import("./AdminBewerbungView.tsx");

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..", "..", "..");

/** The module the redaction lives in, and the triage router, whose calls say whether a decision redacts. */
const RECORDING = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "core", "recording.py"), "utf8");
const ADMIN_ROUTER = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "api", "bewerbungen", "admin_router.py"), "utf8");

/** Every method the page reaches only after a write or a navigation, which no case here makes. */
const ROUTER: NonNullable<ContextType<typeof AppRouterContext>> = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "adminBewerbungView",
};

const TEAM_NAME = "SG Alpha";

const person = (vorname: string, bestaetigtAm: string | null): NonNullable<FLBewerbung["kontakte"]["trainer"]> => ({
  vorname: vorname,
  nachname: "Meier",
  email: `${vorname.toLowerCase()}@schule.example`,
  telefon: "069 1234567",
  geburtsdatum: bestaetigtAm === null ? null : "1988-04-02",
  einwilligung: {
    umfang: "kontaktdaten",
    erfasst_von: bestaetigtAm === null ? "administrativ" : "person",
    text_version: "2026-09-bestaetigungsseite",
    datum: "2026-09-01",
    bestaetigt_am: bestaetigtAm,
  },
});

const SITZ = { verschickt_am: "2026-09-01", erinnert_am: null, abgelehnt_am: null, zustellung: null };

/**
 * An open application for an existing club whose three seats have all confirmed, so nothing closes
 * either decision. Parsed at construction: a drifted field fails here rather than in the page.
 */
const OFFEN: FLBewerbung = FLBewerbungSchema.parse({
  id: "68d0f2a4c1e2b3a4d5e6f708",
  saison_id: "2027",
  eingereicht_am: "2026-09-01",
  status: "eingereicht",
  team_id: "68d0f2a4c1e2b3a4d5e6f709",
  schule: null,
  kontakte: {
    ansprechperson: person("Anna", "2026-09-02"),
    stellvertretung: person("Bernd", "2026-09-02"),
    trainer: person("Clara", "2026-09-03"),
    trainer_ist_zugleich: null,
  },
  trikot: { vorhandener_satz: "Ein Satz", wunschfarbe: null },
  kader: { voraussichtliche_groesse: 14, gute_spieler: 2 },
  stufengroesse: 96,
  wunschgegner: null,
  entscheidung: null,
  bestaetigungen: { ansprechperson: SITZ, stellvertretung: SITZ, trainer: SITZ },
  bestaetigungsfrist: "2099-12-31",
} satisfies FLBewerbung);

function renderPage(bewerbung: FLBewerbung, teamName: string | null = TEAM_NAME) {
  return render(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(
        SearchParamsContext.Provider,
        { value: new URLSearchParams("saison_id=2027") },
        h(AdminBewerbungView, { bewerbung, teamName, saisonStatus: "future", gruppeOffer: [{ gruppe: "A", occupied: 1, capacity: 4 }] }),
      ),
    ),
  );
}

/** One decision's panel, found by the heading it stands under, or `null` where the page offers none. */
const panel = (heading: "Zusage" | "Absage"): HTMLElement | null =>
  screen.queryByRole("heading", { name: heading })?.closest("section") ?? null;

describe("the Zusage where the write would be refused", () => {
  /* Withheld, the section sent the administrator looking for a decision the page still held. It stands
     and closes its own control instead (my rule, 2026-09-04). */
  it("stands whatever would refuse it, and says why on its own control", () => {
    for (const [bewerbung, teamName, wo] of [
      [{ ...OFFEN, kontakte: { ...OFFEN.kontakte, trainer: person("Clara", null) } }, TEAM_NAME, "a seat still unconfirmed"],
      [OFFEN, null, "an application naming no club"],
    ] as const) {
      const { unmount } = renderPage(bewerbung, teamName);
      const hindernis = zusageHindernis(bestaetigungsStand(bewerbung), teamName) ?? "";

      assert.notEqual(hindernis, "", `${wo} refuses nothing, so this case judges an open control`);
      assert.ok(panel("Zusage"), `the page withdraws the acceptance over ${wo}`);
      closedControl("Bewerbung annehmen", hindernis);
      unmount();
    }
  });

  it("offers neither decision once the application is decided", () => {
    renderPage({ ...OFFEN, status: "abgelehnt", entscheidung: { getroffen_am: "2026-09-10", von: "Admin", grund: "Kein Platz." } });

    // First: a page that rendered nothing holds neither panel either.
    assert.ok(screen.getByRole("heading", { name: TEAM_NAME }), "the decided application's page did not render");
    assert.equal(panel("Zusage"), null, "a decided application is offered an acceptance");
    assert.equal(panel("Absage"), null, "a decided application is offered a decline");
  });
});

describe("which irreversibility the triage claims", () => {
  /* `docs/frontend/spec.md` §1.3 splits the two sentences on one mechanical test: the second belongs to a
     write whose transaction empties the log rows it filed. Neither decision redacts, so the pre-image
     survives both and the FIRST sentence is theirs. */
  it("takes the sentence for a write the action log outlives", async () => {
    // Read where the redaction is written: whether a decision redacts is a call the backend router makes.
    assert.match(RECORDING, /def build_redaction_update/, "the redaction this test turns on is gone");
    assert.ok(!ADMIN_ROUTER.includes("build_redaction_update"), "the triage redacts, so the sentence below is the wrong one");

    const user = userEvent.setup();
    const { container } = renderPage(OFFEN);

    await user.selectOptions(container.querySelector('select[name="gruppe"]') ?? assert.fail("the acceptance offers no group"), "A");
    await user.click(screen.getByRole("button", { name: "Bewerbung annehmen" }));
    await user.type(screen.getByRole("textbox", { name: "Grund für die Absage" }), "Kein Platz.");
    await user.click(screen.getByRole("button", { name: "Bewerbung ablehnen" }));

    for (const heading of ["Zusage", "Absage"] as const) {
      const armed = panel(heading)?.textContent ?? "";

      assert.match(armed, /Es gibt in der Verwaltung keinen Weg zurück\./, `the ${heading} drops the irreversibility sentence once armed`);
      assert.ok(
        !armed.includes("Zurückholen lässt sich das nicht"),
        `the ${heading} claims the log is emptied, and no triage write empties one`,
      );
    }
  });
});
