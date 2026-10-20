import "@/shared/testing/pageHarness.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { answer, answerReadsWith, EMPTIEST_ANSWER, OBJECT_ID, pageBody, readsOf, saisonFields, steps } from "@/shared/testing/pageHarness.ts";

import type { NextPageProps } from "@/shared/types/types.ts";
import type { ReactElement } from "react";

// An administrator's session: each read resolves its actor from it before it is sent.
doubleActionRequest();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: AdminOverviewPage } = await import("./page.tsx");
const { frontend_config } = await import("@/core/config.ts");

const PROPS: NextPageProps = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

/** A report of the running season corrected after its adoption, which files its fixture whatever the switch reads. */
const ABWEICHEND = {
  spiel_id: OBJECT_ID,
  zustand: "abweichend",
  ergebnis_vorschlag: { team1_tore: 3, team2_tore: 1, elfmeterschiessen: null, sonderereignis: null },
};

answerReadsWith((endpoint, schema, params) => {
  if (endpoint === "/saisons/list/admin") {
    const saison = {
      ...saisonFields("2026", "active"),
      start_date: "2026-03-07",
      end_date: "2026-10-31",
      schedule: [],
      spielplan: null,
      bewerbung: null,
      registrierung: null,
    };
    return answer(schema, endpoint, { saisons: [saison] });
  }
  if (endpoint === "/spielberichte") return answer(schema, endpoint, { spielberichte: [ABWEICHEND] });
  return EMPTIEST_ANSWER(endpoint, schema, params);
});

/* The backend unions a standing report's fixture into the triage whatever the switch reads, so its state is read
   alike: a closed switch handing the view none leaves that fixture under no category. */
describe("the reports the triage reads", () => {
  it("reads the season's report states while the switch reads off, and hands them to the view", async (t) => {
    const gesetzt = frontend_config.SPIELBERICHT_EINGABE;
    Reflect.set(frontend_config, "SPIELBERICHT_EINGABE", "off");
    t.after(() => Reflect.set(frontend_config, "SPIELBERICHT_EINGABE", gesetzt));

    const view = (await pageBody(AdminOverviewPage, PROPS)) as ReactElement<{ spielberichte: unknown }>;

    assert.deepEqual(view.props.spielberichte, [ABWEICHEND]);
    assert.deepEqual(
      readsOf(steps)
        .filter(({ endpoint }) => endpoint === "/spielberichte")
        .map(({ params }) => params),
      [{ saison_id: "2026" }],
    );
  });
});
