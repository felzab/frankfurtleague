import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerReadsWith, callPage, EMPTIEST_ANSWER, pageBody, redirectTarget } from "@/shared/testing/pageHarness.ts";

import { asDataUrl, cookieHeader, memoryAdapterDouble, ORIGIN, registerAuthDoubles, seedLink } from "../../core/authDoubles.ts";

const STORE = "__flOfferLaterStore";
const REQUEST_HEADERS = "__flOfferLaterRequestHeaders";

/** Allowlisted by nothing: the person the offer is made to. */
const PERSON_EMAIL = "spielerin@example.org";
const TEAM_ID = "6890a1b2c3d4e5f607250011";

const globals = globalThis as unknown as Record<string, unknown>;
const store = { user: [], session: [] as { createdAt: Date }[], account: [], verification: [] as Parameters<typeof seedLink>[0], passkey: [] };
globals[STORE] = store;

/* Registered after the page harness's, so this request's cookie answers `headers()` rather than its
   empty one: the real sign-in store judges the session the cookie names. */
registerAuthDoubles({
  specifiers: {
    "next/headers": asDataUrl(`export const headers = async () => globalThis.${REQUEST_HEADERS};`),
    "@better-auth/mongo-adapter": memoryAdapterDouble(STORE),
  },
});

// The one backend read on this path, the sign-in gate's and the landing's alike: a live seat.
answerReadsWith((endpoint, schema, params) =>
  endpoint === "/identitaet/subjekt"
    ? {
        acknowledged: 1,
        sitze: [{ saison_id: "2526", team_id: TEAM_ID, rolle: "ansprechperson", team_name: "Goethe-Gymnasium", saison_status: "active" }],
        spieler: [],
        schiedsrichter: [],
        unbestaetigt: false,
        gesperrt: false,
      }
    : EMPTIEST_ANSWER(endpoint, schema, params),
);

// After the doubles, so each import resolves through them.
const { auth, getPasskeyStep, getSignInDestination } = await import("@/core/auth.ts");
const { default: PasskeyPage } = await import("@/app/(public)/signin/passkey/page.tsx");
const { default: PersoenlichStartPage } = await import("@/app/bereich/(persoenlich)/page.tsx");

const NO_PROPS = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

/** Every redirect one page answers, in order. */
async function redirectsOf(Page: (props: typeof NO_PROPS) => unknown): Promise<string[]> {
  const { thrown } = await callPage(Page, NO_PROPS);
  return thrown.flatMap((error) => redirectTarget(error) ?? []);
}

/* Over the real sign-in store and pages: a „Später“ that led back to the offer would make the passkey
   required in all but name (`docs/frontend/spec.md :: I412`). */
describe("where „Später“ on the passkey offer leads", () => {
  it("reaches the person's own page from inside the offer window, by no route back to the offer", async () => {
    const verified = await auth.api.magicLinkVerify({
      query: { token: seedLink(store.verification, PERSON_EMAIL) },
      headers: new Headers(ORIGIN),
      returnHeaders: true,
    });
    globals[REQUEST_HEADERS] = new Headers({ ...ORIGIN, cookie: cookieHeader(verified) });

    // Inside the window: the landing offers the passkey, and the page shows the offer.
    assert.equal(await getSignInDestination(), "/signin/passkey");
    assert.deepEqual(await getPasskeyStep(), { step: "offer", email: PERSON_EMAIL });

    // Where the offer's „Später“ goes, read off the props the real page hands its card.
    const card = await pageBody(PasskeyPage, NO_PROPS);
    const later = (card.props as { later?: unknown }).later;
    assert.equal(later, "/bereich");

    // That landing, over the same session: straight to the person's own page, never back to the
    // sign-in landing that offers the passkey, nor to the admin subtree whose proxy sends it there.
    assert.deepEqual(await redirectsOf(PersoenlichStartPage), [`/bereich/team/${TEAM_ID}/2526`]);
  });
});
