import { doubleApiAnswers, requestsOf } from "@/test-support/apiClientDouble";
import { describe, expect, it, vi } from "vitest";

import { SPIELER_TEXT_VERSIONS } from "@/core/consentWordings";

import { CONFIRMED } from "./ends";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));

const { calls } = doubleApiAnswers();

const { answerRegistrierung } = await import("./answerRegistrierung");

const TOKEN = "kein-echtes-token";

/** The question's form as the browser posts it, the act pressed among its entries. */
const posted = (entries: Readonly<Record<string, string>>) => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(entries)) formData.set(name, value);
  return formData;
};

const confirmation = (media?: "on") =>
  posted({ act: "primary", token: TOKEN, birth_date: "2008-03-14", scope: "internal", ...(media === undefined ? {} : { media }) });

describe("the pupil's answer", () => {
  // The harm: an answer the page refuses before it is sent, or a ticked media consent stored as refused, or an unticked
  // one as given, nothing on the page saying so.
  it("confirms with the choice and the media tick under the payload's names and the wordings the page showed", async () => {
    expect(await answerRegistrierung(confirmation("on"))).toStrictEqual({ ok: true, value: CONFIRMED });
    expect(await answerRegistrierung(confirmation())).toStrictEqual({ ok: true, value: CONFIRMED });

    expect(requestsOf(calls).map(({ endpoint, body }) => ({ endpoint, body }))).toStrictEqual(
      [true, false].map((media) => ({
        endpoint: "/registrierungen/confirmation",
        body: { token: TOKEN, birth_date: "2008-03-14", scope: "internal", media, text_versions: SPIELER_TEXT_VERSIONS },
      })),
    );
  });
});
