import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CONSENT_WORDINGS } from "./consentWordings.ts";

/** Each label's words as they were when its label was minted. A changed wording is a new label with a digest of its own. */
const DIGESTS: Readonly<Record<string, string>> = {
  "2026-11-whatsapp-1": "7665639f8c2c0c8da1e3cd351683385e5058d4a84623845aeba6686918362120",
  "2026-11-medien-1": "048502afcdce8e3c41c9c51bf6a285c7b11650c4a3da25121140abd6ae657bf3",
  "2026-11-name-kader-1": "7eb4002cc138c13609667c4cd38a3a075a0215a81b5f184a2765449c017861de",
  "2026-11-name-spielplan-1": "7718111ae5a071a7f0f7390e6d6abd0450df66623adbd50523801f6a4a775b2f",
};

// Keys sorted, so moving a key inside an entry leaves its digest alone, and a link's address left out, which a route
// moves without changing a word the person read: only the words count.
const canonical = (value: unknown): string =>
  JSON.stringify(value, (key, inner: unknown) =>
    key === "href"
      ? undefined
      : inner !== null && typeof inner === "object" && !Array.isArray(inner)
        ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1)))
        : inner,
  );

const digest = (wording: unknown): string => createHash("sha256").update(canonical(wording), "utf8").digest("hex");

describe("the consent wordings", () => {
  // Both directions: a new label fails until its digest is minted here, and a digest whose label is gone fails.
  it("keeps every label's words as its digest was minted over", () => {
    expect(Object.fromEntries(Object.entries(CONSENT_WORDINGS).map(([label, wording]) => [label, digest(wording)]))).toEqual(DIGESTS);
  });
});
