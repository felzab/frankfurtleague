import { serveBackend } from "@/test-support/backend";
import { doubleNextRequest } from "@/test-support/nextRequest";
import { describe, expect, it } from "vitest";

import { SPIELER_TEXT_VERSIONS } from "@/core/consentWordings";

import { CONFIRMED } from "./ends";

import type { FLRegistrierungConfirmationResponse } from "@/core/generated/client/types";

// The answer's one write, answered as the backend stores it; any other request goes unanswered and fails its case.
const backend = serveBackend(({ method, path }) =>
  method === "POST" && path === "/registrierungen/confirmation"
    ? ({ birth_date: "2008-03-14", media: false, outcome: "confirmed", scope: "internal" } satisfies FLRegistrierungConfirmationResponse)
    : undefined,
);
doubleNextRequest();

const { answerRegistrierung } = await import("./answerRegistrierung");

const TOKEN = "not-a-real-token";

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

    expect(backend.sent.map(({ path, body }) => ({ path, body }))).toStrictEqual(
      [true, false].map((media) => ({
        path: "/registrierungen/confirmation",
        body: { token: TOKEN, birth_date: "2008-03-14", scope: "internal", media, text_versions: SPIELER_TEXT_VERSIONS },
      })),
    );
  });
});
