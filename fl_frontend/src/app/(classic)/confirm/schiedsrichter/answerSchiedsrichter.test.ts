import { describe, expect, it } from "vitest";

import { SCHIEDSRICHTER_TEXT_VERSIONS } from "@/core/consentWordings";
import { ROUTES } from "@/core/routes";
import { refusal, serveBackend } from "@/test-support/backend";
import { doubleNextRequest, forgottenLinks } from "@/test-support/nextRequest";
import { posted } from "@/test-support/posted";
import { thrownRedirect } from "@/test-support/thrownRedirect";

// The two writes an answer makes, each answered with the empty body the backend sends; any other request goes
// unanswered and fails its case.
const backend = serveBackend(({ method, path }) =>
  method === "POST" && (path === "/schiedsrichter/confirmation" || path === "/schiedsrichter/confirmation/decline")
    ? new Response(null, { status: 204 })
    : undefined,
);
doubleNextRequest();

const { answerSchiedsrichter } = await import("./answerSchiedsrichter");

const TOKEN = "not-a-real-token";

const DONE = ROUTES.schiedsrichterConfirmationDone.path();

/** Where a press led, Next's redirect thrown past the action naming the done page. */
const ledTo = async (press: Promise<unknown>) => (await thrownRedirect(press)).address;

/** The confirmation's press, with the labels the page carries beside its boxes. */
const confirmation = (media?: "on") =>
  posted({
    act: "primary",
    token: TOKEN,
    birth_date: "2000-01-01",
    scope: "internal",
    "text_versions.scope": SCHIEDSRICHTER_TEXT_VERSIONS.scope,
    "text_versions.media": SCHIEDSRICHTER_TEXT_VERSIONS.media,
    ...(media === undefined ? {} : { media }),
  });

describe("the referee's answer", () => {
  // The harm: a ticked media consent stored as refused, or an unticked one as given, nothing on the page saying so.
  it("confirms with the media consent the box's tick posts, under the wordings the page showed", async () => {
    expect(await ledTo(answerSchiedsrichter(confirmation("on")))).toBe(DONE);
    expect(await ledTo(answerSchiedsrichter(confirmation()))).toBe(DONE);

    expect(backend.sent.map(({ path, body }) => ({ path, body }))).toStrictEqual(
      [true, false].map((media) => ({
        path: "/schiedsrichter/confirmation",
        body: { token: TOKEN, birth_date: "2000-01-01", scope: "internal", media, text_versions: SCHIEDSRICHTER_TEXT_VERSIONS },
      })),
    );
    // The next person at a shared browser opening the plain address meets no earlier link: its cookie is deleted on the
    // page's own path, the path it was set on.
    expect(forgottenLinks()).toStrictEqual([{ value: undefined, path: ROUTES.schiedsrichterConfirmation.path() }]);
  });

  // The harm: an objection handing over a birthdate or a consent the person filled in before deciding against it.
  it("objects by the token alone, whatever the fields hold", async () => {
    const objection = posted({ act: "secondary", token: TOKEN, birth_date: "2000-01-01", scope: "internal", media: "on" });

    expect(await ledTo(answerSchiedsrichter(objection))).toBe(`${DONE}?end=objected`);
    expect(backend.sent.map(({ method, path, body }) => ({ method, path, body }))).toStrictEqual([
      { method: "POST", path: "/schiedsrichter/confirmation/decline", body: { token: TOKEN } },
    ]);
  });
});

// The harm: a referee whose confirmation another tab saved reads a dead link, and doubts that the answer counted.
describe("the referee's press on an entry confirmed since the page opened", () => {
  // Both writes refuse as a confirmed entry does, and the link's view names the day; an objection erases the entry, so
  // no other answer can stand.
  const confirmedAlready = () =>
    backend.answerWith(({ method, path }) => {
      if (method !== "POST") return undefined;
      if (path === "/schiedsrichter/confirmation" || path === "/schiedsrichter/confirmation/decline") return refusal("confirmation_exists");
      return path === "/schiedsrichter/confirmation/view" ? { state: "confirmed", answered_at: "2026-11-20" } : undefined;
    });

  it("reaches the done page after a confirmation", async () => {
    confirmedAlready();
    expect(await ledTo(answerSchiedsrichter(confirmation()))).toBe(DONE);

    expect(backend.sent.map(({ path }) => path)).toStrictEqual(["/schiedsrichter/confirmation"]);
    expect(forgottenLinks()).toStrictEqual([{ value: undefined, path: ROUTES.schiedsrichterConfirmation.path() }]);
  });

  it("names the confirmation and its day after an objection", async () => {
    confirmedAlready();
    expect(await answerSchiedsrichter(posted({ act: "secondary", token: TOKEN }))).toMatchObject({
      ok: true,
      value: { tone: "info", title: "Eintrag bestätigt am 20. November 2026" },
    });

    expect(forgottenLinks()).toStrictEqual([{ value: undefined, path: ROUTES.schiedsrichterConfirmation.path() }]);
  });
});
