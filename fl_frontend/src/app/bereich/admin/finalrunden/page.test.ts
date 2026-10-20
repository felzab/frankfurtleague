import "@/shared/testing/pageHarness.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { spielFields } from "@/shared/testing/fixtures.ts";
import { answer, answerReadsWith, EMPTIEST_ANSWER, OBJECT_ID, pageBody, saisonFields } from "@/shared/testing/pageHarness.ts";

import type { FLSpieltagWithSpiele } from "@/features/spieltage/schemas.ts";
import type { NextPageProps } from "@/shared/types/types.ts";
import type { ReactElement } from "react";

// An administrator's session: every admin-tier read resolves its actor from it before it is sent
// (`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`).
doubleActionRequest();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: AdminFinalrundenPage } = await import("./page.tsx");
const { FLSaisonSchema } = await import("@/features/saisons/schemas.ts");

const SAISON = FLSaisonSchema.parse({
  ...saisonFields("2026", "active"),
  start_date: "2026-03-07",
  end_date: "2026-10-31",
  schedule: [],
  spielplan: null,
  bewerbung: null,
  registrierung: null,
});

const SPIELTAG = { id: OBJECT_ID, beginn: null, ende: null, anzahl_spiele: 1, position: 1, saison_phase: "halbfinale", saison_id: "2026" };

/** A playoff fixture with its referee booked, as the admin tier serves the block: the fee, and no publication verdict. */
const GEPFIFFEN = spielFields({
  spieltag_id: OBJECT_ID,
  saison_phase: "halbfinale",
  schiedsrichter: { schiedsrichter_id: "6890a1b2c3d4e5f607800031", name: "Erika Muster", payment: 25 },
});

answerReadsWith((endpoint, schema, params) => {
  if (endpoint === "/saisons/list/admin") return answer(schema, endpoint, { saisons: [SAISON] });
  if (endpoint === "/spieltage/list/admin") return answer(schema, endpoint, { spieltage: [SPIELTAG] });
  if (endpoint === "/spiele/list/admin") return answer(schema, endpoint, { spiele: [GEPFIFFEN] });
  return EMPTIEST_ANSWER(endpoint, schema, params);
});

const PROPS: NextPageProps = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

describe("the bracket wiring page", () => {
  /* The page joins the admin tier's reads, whose referee carries no publication verdict: a parse of the base tier's shape
     throws the whole page to its error boundary once any playoff fixture is booked. */
  it("renders a round whose fixture has its referee booked", async () => {
    const view = (await pageBody(AdminFinalrundenPage, PROPS)) as ReactElement<{ rounds: FLSpieltagWithSpiele[] }>;

    assert.equal(view.props.rounds[0]?.spiele[0]?.schiedsrichter?.schiedsrichter_id, "6890a1b2c3d4e5f607800031");
  });
});
