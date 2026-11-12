import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CONSENT_WORDINGS } from "./consentWordings.ts";

/** Each label's words as they were when its label was minted. A changed wording is a new label with a digest of its own. */
const DIGESTS: Readonly<Record<string, string>> = {
  "2026-11-whatsapp-1": "dc19926de23634f43af34e7f33af5431f186619f0b37f6883155ffd6a50eefbf",
  "2026-11-media-1": "c662077965205756696bf0abef79e1e02a29400e1868f367daf9da723a6ec2e5",
  "2026-11-name-kader-1": "f46c89b901c5590e540102d13526d69f1d50b09f7a80721e610b4b4d7f7803d5",
  "2026-11-name-spielplan-1": "36ee61a73b1f53c77b1c2300d0002cfc76bde70fd559fd846608cb220aec1968",
};

// Keys sorted, so moving a key inside an entry leaves its digest alone, and a link's address left out, which a route
// moves without changing a word the person read. Every other key is hashed beside its words, so renaming one moves the
// digest with no word changed.
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
