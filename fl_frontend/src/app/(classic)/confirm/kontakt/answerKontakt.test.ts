import { describe, expect, it } from "vitest";

import { SEAT_TEXT_VERSIONS } from "@/core/consentWordings";
import { ROUTES } from "@/core/routes";
import { refusal, serveBackend } from "@/test-support/backend";
import { doubleNextRequest, forgottenLinks } from "@/test-support/nextRequest";
import { posted } from "@/test-support/posted";
import { thrownRedirect } from "@/test-support/thrownRedirect";

import type { FLBewerbungEinwilligungViewAnsweredState } from "@/core/generated/client/types";

// The answer's one write, answered with the empty body the backend sends; any other request goes unanswered and fails its case.
const backend = serveBackend(({ method, path }) =>
  method === "POST" && path === "/bewerbungen/confirmation" ? new Response(null, { status: 204 }) : undefined,
);
doubleNextRequest();

const { answerKontakt, objectKontakt } = await import("./answerKontakt");

const TOKEN = "not-a-real-token";

const DONE = ROUTES.kontaktConfirmationDone.path();

/** The confirmation's press, with the labels the page carries beside its boxes. */
const CONFIRMATION = {
  act: "primary",
  token: TOKEN,
  birth_date: "2000-01-01",
  "text_versions.scope": SEAT_TEXT_VERSIONS.scope,
  "text_versions.media": SEAT_TEXT_VERSIONS.media,
};

/** Where a press led, Next's redirect thrown past the action naming the done page. */
const ledTo = async (press: Promise<unknown>) => (await thrownRedirect(press)).address;

/** The link's cookie as the presses left it: deleted on the page's own path, the path it was set on. */
const FORGOTTEN = [{ value: undefined, path: ROUTES.kontaktConfirmation.path() }];

/** A seat its person answered in another tab: the write refuses, and the link's view names the answer and its day. */
const answeredAs = (state: FLBewerbungEinwilligungViewAnsweredState) =>
  backend.answerWith(({ method, path }) => {
    if (method !== "POST") return undefined;
    if (path === "/bewerbungen/confirmation") return refusal("bewerbung_seat_already_answered");
    return path === "/bewerbungen/confirmation/view" ? { state, answered_at: "2026-11-20" } : undefined;
  });

describe("a contact person's answer", () => {
  // The harm: a ticked consent stored as refused, or an unticked one as given, nothing on the page saying so.
  it("confirms with the consents the boxes' ticks post, under the wordings the page showed", async () => {
    expect(await ledTo(answerKontakt(posted({ ...CONFIRMATION, whatsapp: "on" })))).toBe(DONE);
    expect(await ledTo(answerKontakt(posted({ ...CONFIRMATION, media: "on" })))).toBe(DONE);

    expect(backend.sent.map(({ body }) => body)).toStrictEqual(
      [
        { whatsapp: true, media: false },
        { whatsapp: false, media: true },
      ].map((ticks) => ({ answer: "given", token: TOKEN, birth_date: "2000-01-01", text_versions: SEAT_TEXT_VERSIONS, ...ticks })),
    );
    // The next person at a shared browser opening the plain address meets no earlier link.
    expect(forgottenLinks()).toStrictEqual(FORGOTTEN);
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

// The harm: a person whose answer another tab saved reads a stale page or a dead link, and doubts that the answer counted.
describe("a contact person's press on a seat answered since the page opened", () => {
  it("reaches the done page where the answer pressed is the one standing, a confirmation's saying its earlier choices stand", async () => {
    answeredAs("confirmed");
    expect(await ledTo(answerKontakt(posted(CONFIRMATION)))).toBe(`${DONE}?end=kept`);
    answeredAs("declined");
    expect(await ledTo(objectKontakt(posted({ token: TOKEN })))).toBe(`${DONE}?end=objected`);

    expect(forgottenLinks()).toStrictEqual(FORGOTTEN);
  });

  it("names the other answer and its day where that one stands", async () => {
    answeredAs("declined");
    expect(await answerKontakt(posted(CONFIRMATION))).toMatchObject({
      ok: true,
      value: { tone: "danger", title: "Widersprochen am 20. November 2026" },
    });
    answeredAs("confirmed");
    expect(await answerKontakt(posted({ act: "secondary", token: TOKEN }))).toMatchObject({
      ok: true,
      value: { tone: "info", title: "Eintrag bestätigt am 20. November 2026" },
    });

    expect(forgottenLinks()).toStrictEqual(FORGOTTEN);
  });
});
