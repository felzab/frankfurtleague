import { doubleApiClient } from "@/test-support/apiClientDouble";
import { bodyField } from "@/test-support/refusedPayload";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

// The create as the backend refuses a name another referee holds, a retired one's included: on the name.
doubleApiClient(() => {
  throw new APIBadStatusError({
    message: "refused",
    url: "http://backend/api/v0/schiedsrichter",
    statusCode: 409,
    serverErrorCode: "duplicate_key",
    refusedFields: [bodyField(["name"], "duplicate_key")],
    endpoint: "/schiedsrichter",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });
});

const { createSchiedsrichter } = await import("./createSchiedsrichter");

const entered = () => {
  const formData = new FormData();
  for (const [name, value] of Object.entries({ name: "Erika Muster", email: "erika@example.com", telefon: "", schule: "", honorar: "25" })) {
    formData.set(name, value);
  }
  return formData;
};

describe("a new referee", () => {
  // The harm: a referee entered again rather than brought back answering the shared failure, every retry the same.
  it("answers a name another referee holds on the name's box", async () => {
    expect(await createSchiedsrichter(entered())).toStrictEqual({
      ok: false,
      errorCode: "duplicate_key",
      fieldErrors: { name: COPY.shared.field.taken },
    });
  });
});
