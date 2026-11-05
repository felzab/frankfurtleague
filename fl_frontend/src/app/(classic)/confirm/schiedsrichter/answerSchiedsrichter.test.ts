import { doubleApiClient } from "@/test-support/apiClientDouble";
import { bodyField } from "@/test-support/refusedPayload";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";
import { dayOf } from "@/core/format";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));

// The confirmation as the backend refuses an age outside its range on its own day: on the birthdate, with the range
// as the refusal's bounds.
doubleApiClient(() => {
  throw new APIBadStatusError({
    message: "refused",
    url: "http://backend/api/v0/schiedsrichter/confirmation",
    statusCode: 422,
    serverErrorCode: "confirmation_age",
    refusedFields: [bodyField(["geburtsdatum"], "confirmation_age", { min: 18, max: 120 })],
    endpoint: "/schiedsrichter/confirmation",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });
});

const { answerSchiedsrichter } = await import("./answerSchiedsrichter");

const answer = () => {
  const formData = new FormData();
  for (const [name, value] of Object.entries({ act: "primary", token: "kein-echtes-token", geburtsdatum: "2009-01-01", scope: "intern" })) {
    formData.set(name, value);
  }
  return formData;
};

describe("the referee's confirmation", () => {
  // The harm: the server moves its age floor, and the birthdate's line names a day the write no longer admits.
  it("words a refused age on the birthdate from the range the refusal carries", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-05T10:00:00Z"), toFake: ["Date"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });

    expect(await answerSchiedsrichter(answer())).toStrictEqual({
      ok: false,
      errorCode: "confirmation_age",
      fieldErrors: { geburtsdatum: COPY.shared.field.latest(dayOf("2008-11-05")) },
    });
  });
});
