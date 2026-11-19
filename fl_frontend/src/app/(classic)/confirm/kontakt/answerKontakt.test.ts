import { describe, expect, it } from "vitest";

import { SEAT_TEXT_VERSIONS } from "@/core/consentWordings";
import { serveBackend } from "@/test-support/backend";
import { doubleNextRequest } from "@/test-support/nextRequest";
import { posted } from "@/test-support/posted";

import { END } from "./ends";

// The answer's one write, answered with the empty body the backend sends; any other request goes unanswered and fails its case.
const backend = serveBackend(({ method, path }) =>
  method === "POST" && path === "/bewerbungen/confirmation" ? new Response(null, { status: 204 }) : undefined,
);
doubleNextRequest();

const { answerKontakt, objectKontakt } = await import("./answerKontakt");

const TOKEN = "not-a-real-token";

describe("a contact person's answer", () => {
  // The harm: a ticked consent stored as refused, or an unticked one as given, nothing on the page saying so.
  it("confirms with the consents the boxes' ticks post, under the wordings the page showed", async () => {
    const answer = { act: "primary", token: TOKEN, birth_date: "2000-01-01" };

    expect(await answerKontakt(posted({ ...answer, whatsapp: "on" }))).toStrictEqual({ ok: true, value: END.confirmed });
    expect(await answerKontakt(posted({ ...answer, media: "on" }))).toStrictEqual({ ok: true, value: END.confirmed });

    expect(backend.sent.map(({ body }) => body)).toStrictEqual(
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

    expect(backend.sent.map(({ body }) => body)).toStrictEqual([
      { answer: "declined", token: TOKEN },
      { answer: "declined", token: TOKEN },
    ]);
  });
});
