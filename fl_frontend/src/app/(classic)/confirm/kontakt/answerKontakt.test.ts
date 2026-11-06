import { doubleApiAnswers, requestsOf } from "@/test-support/apiClientDouble";
import { describe, expect, it, vi } from "vitest";

import { SEAT_TEXT_VERSIONS } from "@/core/consentWordings";

import { END } from "./ends";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));

const { calls } = doubleApiAnswers();

const { answerKontakt, objectKontakt } = await import("./answerKontakt");

const TOKEN = "kein-echtes-token";

/** The question's form as the browser posts it, the act pressed among its entries. */
const posted = (entries: Readonly<Record<string, string>>) => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(entries)) formData.set(name, value);
  return formData;
};

describe("a contact person's answer", () => {
  // The harm: a ticked consent stored as refused, or an unticked one as given, nothing on the page saying so.
  it("confirms with the consents the boxes' ticks post, under the wordings the page showed", async () => {
    const answer = { act: "primary", token: TOKEN, birth_date: "2000-01-01" };

    expect(await answerKontakt(posted({ ...answer, whatsapp: "on" }))).toStrictEqual({ ok: true, value: END.confirmed });
    expect(await answerKontakt(posted({ ...answer, media: "on" }))).toStrictEqual({ ok: true, value: END.confirmed });

    expect(requestsOf(calls).map(({ body }) => body)).toStrictEqual(
      [
        { whatsapp: true, media: false },
        { whatsapp: false, media: true },
      ].map((ticks) => ({ answer: "given", token: TOKEN, birth_date: "2000-01-01", text_versions: SEAT_TEXT_VERSIONS, ...ticks })),
    );
  });

  // The harm: an objection handing over a birthdate or a consent the person filled in before deciding against it.
  it("objects by the token alone, whatever the fields hold", async () => {
    const objection = posted({ act: "secondary", token: TOKEN, birth_date: "2000-01-01", whatsapp: "on", media: "on" });

    expect(await answerKontakt(objection)).toStrictEqual({ ok: true, value: END.objected });
    expect(await objectKontakt(posted({ act: "primary", token: TOKEN }))).toStrictEqual({ ok: true, value: END.objected });

    expect(requestsOf(calls).map(({ body }) => body)).toStrictEqual([
      { answer: "declined", token: TOKEN },
      { answer: "declined", token: TOKEN },
    ]);
  });
});
