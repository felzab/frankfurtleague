import { doubleApiClient } from "@/test-support/apiClientDouble";
import { bodyField } from "@/test-support/refusedPayload";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";

import type { FLSchiedsrichter } from "@/core/generated/client/types";

const ID = "64b000000000000000000006";

const STORED: FLSchiedsrichter = {
  id: ID,
  name: "Lena Brandt",
  schule: null,
  kontakt: { email: "lena@example.com", telefon: null },
  default_payment: 25,
  geburtsdatum: null,
  einwilligung: null,
  confirmation: null,
  inactive_since: null,
  version: 3,
};

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));
vi.mock("@/features/schiedsrichter/queries", () => ({ getSchiedsrichterById: async () => ({ schiedsrichter: STORED }) }));

// The save as the backend refuses a name another referee holds, a retired one's included: on the name.
doubleApiClient(() => {
  throw new APIBadStatusError({
    message: "refused",
    url: `http://backend/api/v0/schiedsrichter/${ID}`,
    statusCode: 409,
    serverErrorCode: "duplicate_key",
    refusedFields: [bodyField(["name"], "duplicate_key")],
    endpoint: `/schiedsrichter/${ID}`,
    method: "PATCH",
    readOnly: false,
    traceId: "0",
  });
});

const { saveSchiedsrichter } = await import("./saveSchiedsrichter");

describe("a referee's save", () => {
  // The harm: a rename onto another referee's name answering the shared failure, the editor's name box saying nothing
  // and every retry the same; the create holds the same refusal on its own box.
  it("answers a name another referee holds on the name's box", async () => {
    expect(await saveSchiedsrichter({ id: ID, version: STORED.version, changes: { name: "Erika Muster" } })).toStrictEqual({
      ok: false,
      errorCode: "duplicate_key",
      fieldErrors: { "changes.name": COPY.shared.field.taken },
    });
  });
});
