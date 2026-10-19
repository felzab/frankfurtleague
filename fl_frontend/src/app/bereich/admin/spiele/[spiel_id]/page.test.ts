import "@/shared/testing/pageHarness.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { spielFields } from "@/shared/testing/fixtures.ts";
import {
  answer,
  answerReadsWith,
  clearSteps,
  EMPTIEST_ANSWER,
  OBJECT_ID,
  pageBody,
  prerenderShell,
  readsOf,
  saisonFields,
  steps,
} from "@/shared/testing/pageHarness.ts";

import type { FLSpielAdmin } from "@/features/spiele/schemas.ts";
import type { NextPageProps } from "@/shared/types/types.ts";
import type { ReactElement } from "react";

// An administrator's session: the editor's read resolves its actor from it before it is sent
// (`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`).
doubleActionRequest();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: AdminSpielEditPage } = await import("./page.tsx");
const { FLSpielAdminSchema } = await import("@/features/spiele/schemas.ts");
const { spielStateKey } = await import("@/features/spiele/utils.ts");
const { AdminContextWrapper } = await import("@/features/admin/components/providers/AdminContextWrapper.tsx");
const { FLSaisonSchema } = await import("@/features/saisons/schemas.ts");
const { default: nextConfig } = await import("../../../../../../next.config.ts");

const ENDPOINT = `/spiele/${OBJECT_ID}/admin`;
const PROPS: NextPageProps<{ spiel_id: string }> = { params: Promise.resolve({ spiel_id: OBJECT_ID }), searchParams: Promise.resolve({}) };

const STORED = FLSpielAdminSchema.parse(spielFields({ id: OBJECT_ID, datum: "2026-11-07", uhrzeit: "18:00:00" }));
/** The same fixture once another administrator moved it. */
const MOVED = FLSpielAdminSchema.parse(spielFields({ id: OBJECT_ID, datum: "2026-11-14", uhrzeit: "19:30:00" }));

/** What the database holds of the fixture at the moment a read reaches it. */
let stored: FLSpielAdmin = STORED;

answerReadsWith((endpoint, schema, params) =>
  endpoint === ENDPOINT ? answer(schema, endpoint, { spiel: stored }) : EMPTIEST_ANSWER(endpoint, schema, params),
);

type EditView = ReactElement<{ spielData: FLSpielAdmin }>;

/** The editor a navigation opens: the fixture its fields seed from and the key that remounts it. */
async function opened(): Promise<{ spielData: FLSpielAdmin; key: string | null }> {
  const body = (await pageBody(AdminSpielEditPage, PROPS)) as ReactElement<{ children: EditView }>;
  const view = body.props.children;
  return { spielData: view.props.spielData, key: view.key };
}

/**
 * What a prefetch carries of the editor. Under the layout's markup, as the page always is: a prerender
 * aborted with its root boundary pending writes no prelude at all.
 */
const prefetched = (): Promise<string> => prerenderShell(h("main", null, h(AdminSpielEditPage, PROPS)));

beforeEach(() => {
  stored = STORED;
  clearSteps();
});

/* With partial prefetching a link prefetches the route's App Shell, statically or, with the session, at
   request time; both renders stop short of `connection()`, which settles only in a render somebody opened.
   `prerenderShell` holds it unsettled the same way. */
describe("the match editor's freshness across a prefetch", () => {
  it("reads nothing of the fixture in the render a prefetch carries", async () => {
    const shell = await prefetched();

    assert.deepEqual(readsOf(steps), [], "a prefetch-time render reads the fixture, so a later opening can show it as it stood then");
    assert.ok(shell.includes('role="status"'), "the prefetched render holds no loader where the editor will stand");
  });

  it("opens on the fixture as stored at the opening, after an earlier opening and a prefetch", async () => {
    const before = await opened();
    await prefetched();
    stored = MOVED;

    const after = await opened();

    assert.deepEqual(after.spielData, MOVED, "the editor seeds its fields from the fixture as it stood before the move");
    assert.equal(after.key, spielStateKey(MOVED), "the editor is keyed by a state other than the one it seeds from");
    assert.notEqual(after.key, before.key, "a still-mounted editor would keep the moved fixture's earlier values");
  });

  /* The cases above hold what the server renders; the client router reuses a dynamic page's payload for
     `staleTimes.dynamic`, a reopening inside it seeding from the fixture as the first opening read it. */
  it("keeps no opened editor in the client router", () => {
    assert.equal(nextConfig.experimental?.staleTimes?.dynamic ?? 0, 0, "the client router serves a reopened editor its earlier payload");
  });
});

/* The confirmations' sweep visits the running season alone, so the editor's near-date warning is too: a planned
   season's fixture raising it warns of a request that never comes. */
describe("which season the match editor calls running", () => {
  for (const [status, running] of [
    ["active", true],
    ["future", false],
    ["past", false],
  ] as const) {
    it(`calls the fixture's ${status} season ${running ? "running" : "not running"}`, async () => {
      const saison = FLSaisonSchema.parse({
        ...saisonFields(STORED.saison_id, status),
        start_date: `${STORED.saison_id}-03-07`,
        end_date: `${STORED.saison_id}-10-31`,
        schedule: [],
        spielplan: null,
        bewerbung: null,
        registrierung: null,
      });
      answerReadsWith((endpoint, schema, params) => {
        if (endpoint === ENDPOINT) return answer(schema, endpoint, { spiel: stored });
        if (endpoint === "/saisons/list/admin") return answer(schema, endpoint, { saisons: [saison] });
        return EMPTIEST_ANSWER(endpoint, schema, params);
      });

      // The page's own wrapper, called as the renderer calls it, so the season it hands is the page's choice too.
      const wrapper = (await pageBody(AdminSpielEditPage, PROPS)) as ReactElement<Parameters<typeof AdminContextWrapper>[0]>;
      const provider = (await AdminContextWrapper(wrapper.props)) as ReactElement<{ isActiveSaison: boolean }>;

      assert.equal(provider.props.isActiveSaison, running);
    });
  }
});
