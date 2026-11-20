import { describe, expect, it } from "vitest";

import { SPIELER_TEXT_VERSIONS } from "@/core/consentWordings";
import { serveBackend } from "@/test-support/backend";
import { doubleNextRequest } from "@/test-support/nextRequest";
import { posted } from "@/test-support/posted";

import { REGISTRIERUNG_CONFIRMED } from "../ends";

// The answer's one write, answered with the empty body the backend sends; any other request goes unanswered and fails its case.
const backend = serveBackend(({ method, path }) =>
  method === "POST" && path === "/registrierungen/confirmation" ? new Response(null, { status: 204 }) : undefined,
);
doubleNextRequest();

const { answerRegistrierung } = await import("./answerRegistrierung");

const TOKEN = "not-a-real-token";

const confirmation = (media?: "on") =>
  posted({ act: "primary", token: TOKEN, birth_date: "2008-03-14", scope: "internal", ...(media === undefined ? {} : { media }) });

describe("the pupil's answer", () => {
  // The harm: an answer the page refuses before it is sent, or a ticked media consent stored as refused, or an unticked
  // one as given, nothing on the page saying so.
  it("confirms with the choice and the media tick under the payload's names and the wordings the page showed", async () => {
    expect(await answerRegistrierung(confirmation("on"))).toStrictEqual({ ok: true, value: REGISTRIERUNG_CONFIRMED });
    expect(await answerRegistrierung(confirmation())).toStrictEqual({ ok: true, value: REGISTRIERUNG_CONFIRMED });

    expect(backend.sent.map(({ path, body }) => ({ path, body }))).toStrictEqual(
      [true, false].map((media) => ({
        path: "/registrierungen/confirmation",
        body: { token: TOKEN, birth_date: "2008-03-14", scope: "internal", media, text_versions: SPIELER_TEXT_VERSIONS },
      })),
    );
  });
});
