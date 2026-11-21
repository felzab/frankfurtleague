import { describe, expect, it } from "vitest";

import { SEAT_TEXT_VERSIONS } from "@/core/consentWordings";
import { ROUTES } from "@/core/routes";
import { serveBackend } from "@/test-support/backend";
import { doubleNextRequest, writtenCookies } from "@/test-support/nextRequest";
import { posted } from "@/test-support/posted";
import { thrownRedirect } from "@/test-support/thrownRedirect";

// The answer's one write, answered with the empty body the backend sends; any other request goes unanswered and fails its case.
const backend = serveBackend(({ method, path }) =>
  method === "POST" && path === "/bewerbungen/confirmation" ? new Response(null, { status: 204 }) : undefined,
);
doubleNextRequest();

const { answerKontakt, objectKontakt } = await import("./answerKontakt");

const TOKEN = "not-a-real-token";

const DONE = ROUTES.kontaktConfirmationDone.path();

/** Where a press led, Next's redirect thrown past the action naming the done page. */
const ledTo = async (press: Promise<unknown>) => (await thrownRedirect(press)).address;

describe("a contact person's answer", () => {
  // The harm: a ticked consent stored as refused, or an unticked one as given, nothing on the page saying so.
  it("confirms with the consents the boxes' ticks post, under the wordings the page showed", async () => {
    // The labels the page carries beside its boxes.
    const answer = {
      act: "primary",
      token: TOKEN,
      birth_date: "2000-01-01",
      "text_versions.scope": SEAT_TEXT_VERSIONS.scope,
      "text_versions.media": SEAT_TEXT_VERSIONS.media,
    };

    expect(await ledTo(answerKontakt(posted({ ...answer, whatsapp: "on" })))).toBe(DONE);
    expect(await ledTo(answerKontakt(posted({ ...answer, media: "on" })))).toBe(DONE);

    expect(backend.sent.map(({ body }) => body)).toStrictEqual(
      [
        { whatsapp: true, media: false },
        { whatsapp: false, media: true },
      ].map((ticks) => ({ answer: "given", token: TOKEN, birth_date: "2000-01-01", text_versions: SEAT_TEXT_VERSIONS, ...ticks })),
    );
    // The next person at a shared browser opening the plain address meets no earlier link: its cookie is deleted on the
    // page's own path, the path it was set on.
    expect(writtenCookies().map(({ name, value, path }) => ({ name, value, path }))).toStrictEqual([
      { name: "mailed_link", value: undefined, path: ROUTES.kontaktConfirmation.path() },
    ]);
  });

  // The harm: an objection handing over a birthdate or a consent the person filled in before deciding against it.
  it("objects by the token alone, whatever the fields hold", async () => {
    const objection = posted({ act: "secondary", token: TOKEN, birth_date: "2000-01-01", whatsapp: "on", media: "on" });

    expect(await ledTo(answerKontakt(objection))).toBe(`${DONE}?end=objected`);
    expect(await ledTo(objectKontakt(posted({ act: "primary", token: TOKEN })))).toBe(`${DONE}?end=objected`);

    expect(backend.sent.map(({ body }) => body)).toStrictEqual([
      { answer: "declined", token: TOKEN },
      { answer: "declined", token: TOKEN },
    ]);
  });
});
