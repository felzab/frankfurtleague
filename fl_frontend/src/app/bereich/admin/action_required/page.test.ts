import "@/shared/testing/pageHarness.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { APINetworkError } from "@/core/errors.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import {
  answer,
  answerReadsWith,
  backendUnreachable,
  EMPTIEST_ANSWER,
  OBJECT_ID,
  pageBody,
  readsOf,
  saisonFields,
  steps,
} from "@/shared/testing/pageHarness.ts";

import type { AnswerSchema, ReadAnswer } from "@/shared/testing/pageHarness.ts";
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

const antworten = (liste: ReadAnswer) => (endpoint: string, schema: AnswerSchema, params: Record<string, unknown>) => {
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
  if (endpoint === "/spiele/action_required") return liste(endpoint, schema, params);
  // A cut confirmations read, so the page's hand-through is told from a default.
  if (endpoint === "/spielbestaetigungen") return answer(schema, endpoint, { spielbestaetigungen: [], vollstaendig: false });
  return EMPTIEST_ANSWER(endpoint, schema, params);
};
const GELESEN: ReadAnswer = (endpoint, schema) => answer(schema, endpoint, { spielberichte: [ABWEICHEND] });

answerReadsWith(antworten(GELESEN));

/* The backend unions a standing report's fixture into the triage whatever the switch reads, and serves the states it
   judged that union on beside it: one snapshot, so a state the page reads again could disagree with the list. */
describe("the reports the triage reads", () => {
  it("hands the view the states served with the list while the switch reads off, and reads no second list", async (t) => {
    const gesetzt = frontend_config.SPIELBERICHT_EINGABE;
    Reflect.set(frontend_config, "SPIELBERICHT_EINGABE", "off");
    t.after(() => Reflect.set(frontend_config, "SPIELBERICHT_EINGABE", gesetzt));

    const view = (await pageBody(AdminOverviewPage, PROPS)) as ReactElement<{ spielberichte: unknown }>;

    assert.deepEqual(view.props.spielberichte, [ABWEICHEND]);
    assert.deepEqual(
      readsOf(steps).filter(({ endpoint }) => endpoint === "/spielberichte"),
      [],
    );
  });

  /* The states ride the list's own request, so a failed read of them is the list's failure: the error boundary, never
     tabs read as clear. */
  it("takes the page to its error boundary where the list, its report states with it, could not be read", async (t) => {
    answerReadsWith(
      antworten((endpoint) => {
        throw backendUnreachable(endpoint);
      }),
    );
    t.after(() => answerReadsWith(antworten(GELESEN)));

    await assert.rejects(pageBody(AdminOverviewPage, PROPS), APINetworkError);
  });
});

/* The confirmations' read is degraded, so a page handing the view a constant would pass every case that reads a whole
   read; a cut one tells the hand-through from a default. */
describe("the confirmations the triage reads", () => {
  it("hands the view the season's rows and whether the read served them all", async () => {
    const view = (await pageBody(AdminOverviewPage, PROPS)) as ReactElement<{ bestaetigungen: unknown; bestaetigungenVollstaendig: unknown }>;

    assert.deepEqual(view.props.bestaetigungen, []);
    assert.equal(view.props.bestaetigungenVollstaendig, false);
  });
});
