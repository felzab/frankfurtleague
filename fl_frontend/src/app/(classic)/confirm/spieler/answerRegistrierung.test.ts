import { describe, expect, it } from "vitest";

import { SPIELER_TEXT_VERSIONS } from "@/core/consentWordings";
import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { refusal, serveBackend } from "@/test-support/backend";
import { doubleNextRequest, forgottenLinks } from "@/test-support/nextRequest";
import { posted } from "@/test-support/posted";
import { thrownRedirect } from "@/test-support/thrownRedirect";

// The answer's one write, answered with the empty body the backend sends; any other request goes unanswered and fails its case.
const backend = serveBackend(({ method, path }) =>
  method === "POST" && path === "/registrierungen/confirmation" ? new Response(null, { status: 204 }) : undefined,
);
doubleNextRequest();

const { answerRegistrierung } = await import("./answerRegistrierung");

const TOKEN = "not-a-real-token";

/** Where a press led, Next's redirect thrown past the action naming the done page. */
const ledTo = async (press: Promise<unknown>) => (await thrownRedirect(press)).address;

/** The confirmation's press, with the labels the page carries beside its boxes. */
const confirmation = (media?: "on") =>
  posted({
    act: "primary",
    token: TOKEN,
    birth_date: "2008-03-14",
    scope: "internal",
    "text_versions.scope": SPIELER_TEXT_VERSIONS.scope,
    "text_versions.media": SPIELER_TEXT_VERSIONS.media,
    ...(media === undefined ? {} : { media }),
  });

describe("the pupil's answer", () => {
  // The harm: an answer the page refuses before it is sent, or a ticked media consent stored as refused, or an unticked
  // one as given, nothing on the page saying so.
  it("confirms with the choice and the media tick under the payload's names and the wordings the page showed", async () => {
    expect(await ledTo(answerRegistrierung(confirmation("on")))).toBe(ROUTES.registrierungConfirmationDone.path());
    expect(await ledTo(answerRegistrierung(confirmation()))).toBe(ROUTES.registrierungConfirmationDone.path());

    expect(backend.sent.map(({ path, body }) => ({ path, body }))).toStrictEqual(
      [true, false].map((media) => ({
        path: "/registrierungen/confirmation",
        body: { token: TOKEN, birth_date: "2008-03-14", scope: "internal", media, text_versions: SPIELER_TEXT_VERSIONS },
      })),
    );
    // The next person at a shared browser opening the plain address meets no earlier pupil's link: its cookie is deleted
    // on the page's own path, the path it was set on.
    expect(forgottenLinks()).toStrictEqual([{ value: undefined, path: ROUTES.registrierungConfirmation.path() }]);
  });

  // The harm: a pupil whose confirmation another tab saved reads a dead link, and doubts that the answer counted.
  it("reaches the done page where another tab confirmed since the page opened, saying the earlier choices stand", async () => {
    backend.answerWith(({ method, path }) =>
      method === "POST" && path === "/registrierungen/confirmation" ? refusal("confirmation_exists") : undefined,
    );

    expect(await ledTo(answerRegistrierung(confirmation()))).toBe(`${ROUTES.registrierungConfirmationDone.path()}?end=kept`);
    expect(forgottenLinks()).toStrictEqual([{ value: undefined, path: ROUTES.registrierungConfirmation.path() }]);
  });
});

describe("a media consent the write refuses for the age it holds to", () => {
  // The harm: the switch unmarked and the stale-page line read in place of the age the consent needs.
  it("stands on the media switch in its phrase, naming that age", async () => {
    backend.answerWith(({ method, path }) =>
      method === "POST" && path === "/registrierungen/confirmation"
        ? refusal("media_age", { fields: [{ kind: "media_age", path: ["media"], ctx: { min: 16 }, in: "body" }] })
        : undefined,
    );

    expect(await answerRegistrierung(confirmation("on"))).toStrictEqual({
      ok: false,
      errorCode: "media_age",
      fieldErrors: { media: COPY.shared.mediaFrom(16) },
      kinds: { media: "media_age" },
    });
  });
});
