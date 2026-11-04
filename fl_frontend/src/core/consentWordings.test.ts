import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CONSENT_WORDINGS } from "./consentWordings.ts";

/** Each label's words as they were when its label was minted. A changed wording is a new label with a digest of its own. */
const DIGESTS: Readonly<Record<string, string>> = {
  "2026-11-whatsapp-1": "dc19926de23634f43af34e7f33af5431f186619f0b37f6883155ffd6a50eefbf",
  "2026-11-medien-1": "c662077965205756696bf0abef79e1e02a29400e1868f367daf9da723a6ec2e5",
  "2026-11-name-kader-1": "c255d1fab58fc09adf6a709c1aff9e94c330461a905f76d1dd683756c89d9b46",
  "2026-11-name-spielplan-1": "463223fd2015198e27ebf79fa5ad27fef0272b320f34ede35bc77197459ebe48",
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
