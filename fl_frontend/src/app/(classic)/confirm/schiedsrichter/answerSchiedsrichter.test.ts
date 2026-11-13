import { serveBackend } from "@/test-support/backend";
import { doubleNextRequest } from "@/test-support/nextRequest";
import { describe, expect, it } from "vitest";

import { SCHIEDSRICHTER_TEXT_VERSIONS } from "@/core/consentWordings";

import { END } from "./ends";

import type { FLSchiedsrichterConfirmationResponse } from "@/core/generated/client/types";

// The two writes an answer makes, each answered as the backend does; any other request goes unanswered and fails its
// case.
const backend = serveBackend(({ method, path }) => {
  if (method !== "POST") return undefined;
  if (path === "/schiedsrichter/confirmation") {
    return { confirmed_at: "2026-11-13", media: false, scope: "internal" } satisfies FLSchiedsrichterConfirmationResponse;
  }
  return path === "/schiedsrichter/confirmation/decline" ? new Response(null, { status: 204 }) : undefined;
});
doubleNextRequest();

const { answerSchiedsrichter } = await import("./answerSchiedsrichter");

const TOKEN = "not-a-real-token";

/** The question's form as the browser posts it, the act pressed among its entries. */
const posted = (entries: Readonly<Record<string, string>>) => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(entries)) formData.set(name, value);
  return formData;
};

const confirmation = (media?: "on") =>
  posted({ act: "primary", token: TOKEN, birth_date: "2000-01-01", scope: "internal", ...(media === undefined ? {} : { media }) });

describe("the referee's answer", () => {
  // The harm: a ticked media consent stored as refused, or an unticked one as given, nothing on the page saying so.
  it("confirms with the media consent the box's tick posts, under the wordings the page showed", async () => {
    expect(await answerSchiedsrichter(confirmation("on"))).toStrictEqual({ ok: true, value: END.confirmed });
    expect(await answerSchiedsrichter(confirmation())).toStrictEqual({ ok: true, value: END.confirmed });

    expect(backend.sent.map(({ path, body }) => ({ path, body }))).toStrictEqual(
      [true, false].map((media) => ({
        path: "/schiedsrichter/confirmation",
        body: { token: TOKEN, birth_date: "2000-01-01", scope: "internal", media, text_versions: SCHIEDSRICHTER_TEXT_VERSIONS },
      })),
    );
  });

  // The harm: an objection handing over a birthdate or a consent the person filled in before deciding against it.
  it("objects by the token alone, whatever the fields hold", async () => {
    const objection = posted({ act: "secondary", token: TOKEN, birth_date: "2000-01-01", scope: "internal", media: "on" });

    expect(await answerSchiedsrichter(objection)).toStrictEqual({ ok: true, value: END.objected });
    expect(backend.sent.map(({ method, path, body }) => ({ method, path, body }))).toStrictEqual([
      { method: "POST", path: "/schiedsrichter/confirmation/decline", body: { token: TOKEN } },
    ]);
  });
});
