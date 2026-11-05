import { doubleApiAnswers, requestsOf } from "@/test-support/apiClientDouble";
import { describe, expect, it, vi } from "vitest";

import { SCHIEDSRICHTER_TEXT_VERSIONS } from "@/core/consentWordings";

import { END } from "./ends";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));

const { calls } = doubleApiAnswers();

const { answerSchiedsrichter } = await import("./answerSchiedsrichter");

const TOKEN = "kein-echtes-token";

/** The question's form as the browser posts it, the act pressed among its entries. */
const posted = (entries: Readonly<Record<string, string>>) => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(entries)) formData.set(name, value);
  return formData;
};

const confirmation = (media?: "on") =>
  posted({ act: "primary", token: TOKEN, geburtsdatum: "2000-01-01", scope: "intern", ...(media === undefined ? {} : { media }) });

describe("the referee's answer", () => {
  // The harm: a ticked media consent stored as refused, or an unticked one as given, nothing on the page saying so.
  it("confirms with the media consent the box's tick posts, under the wordings the page showed", async () => {
    expect(await answerSchiedsrichter(confirmation("on"))).toStrictEqual({ ok: true, value: END.confirmed });
    expect(await answerSchiedsrichter(confirmation())).toStrictEqual({ ok: true, value: END.confirmed });

    expect(requestsOf(calls).map(({ endpoint, body }) => ({ endpoint, body }))).toStrictEqual(
      [true, false].map((media) => ({
        endpoint: "/schiedsrichter/confirmation",
        body: { token: TOKEN, geburtsdatum: "2000-01-01", scope: "intern", media, text_versions: SCHIEDSRICHTER_TEXT_VERSIONS },
      })),
    );
  });

  // The harm: an objection handing over a birthdate or a consent the person filled in before deciding against it.
  it("objects by the token alone, whatever the fields hold", async () => {
    const objection = posted({ act: "secondary", token: TOKEN, geburtsdatum: "2000-01-01", scope: "intern", media: "on" });

    expect(await answerSchiedsrichter(objection)).toStrictEqual({ ok: true, value: END.objected });
    expect(requestsOf(calls)).toStrictEqual([{ endpoint: "/schiedsrichter/confirmation/decline", method: "POST", body: { token: TOKEN } }]);
  });
});
