import "@/shared/testing/pageHarness.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { membershipAnswer } from "@/shared/testing/membershipFixtures.ts";
import { answer, answerReadsWith, EMPTIEST_ANSWER, pageBody, saisonFields } from "@/shared/testing/pageHarness.ts";

import type { NextPageProps } from "@/shared/types/types.ts";
import type { ReactElement } from "react";

// An administrator's session: each read resolves its actor from it before it is sent.
doubleActionRequest();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: AdminSpielsuchePage } = await import("./page.tsx");

const PROPS: NextPageProps = { params: Promise.resolve({}), searchParams: Promise.resolve({ saison_id: "2026" }) };

const ADDRESS = { strasse: "Hauptstraße", hausnummer: "1", plz: "60311", stadtteil: "", stadt: "Frankfurt am Main" };

/** A club, its row of the searched season standing or left as `austritt` says, and a row of another season besides. */
const club = (id: string, austritt: Record<string, unknown> | null) => ({
  id,
  name: `FC ${id.slice(-2)}`,
  shorthand: "FC",
  description: "",
  full_name: "FC Frankfurt",
  website_url: null,
  address: ADDRESS,
  schulform: null,
  inactive_since: null,
  memberships: [membershipAnswer({ saison_id: "2026", austritt }), membershipAnswer({ saison_id: "2025" })],
});

const GEGANGEN = "6890a1b2c3d4e5f607182901";
const GEBLIEBEN = "6890a1b2c3d4e5f607182902";

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
  if (endpoint === "/teams/memberships") {
    return answer(schema, endpoint, {
      teams: [club(GEGANGEN, { type: "rueckzug", grund: "Kein Kader", datum: "2026-05-02" }), club(GEBLIEBEN, null)],
    });
  }
  // A cut read, so the page's hand-through is told from a default.
  if (endpoint === "/spielbestaetigungen") return answer(schema, endpoint, { spielbestaetigungen: [], vollstaendig: false });
  return EMPTIEST_ANSWER(endpoint, schema, params);
});

/* Every card judges a club's confirmation against the day it left, and a page handing the view no departure would show a
   club that left still owing an answer; the rows read whole would hide a cut. */
describe("what the fixture search hands its cards", () => {
  it("hands the season's rows, whether the read served them all, and each club's day of leaving this season", async () => {
    const view = (await pageBody(AdminSpielsuchePage, PROPS)) as ReactElement<{
      bestaetigungen: unknown;
      bestaetigungenVollstaendig: unknown;
      austritte: unknown;
    }>;

    assert.deepEqual(view.props.bestaetigungen, []);
    assert.equal(view.props.bestaetigungenVollstaendig, false);
    assert.deepEqual(view.props.austritte, { [GEGANGEN]: "2026-05-02" });
  });
});
