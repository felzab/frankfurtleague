import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CONSENT_WORDINGS } from "./consentWordings.ts";

/** Each label's words as they were when its label was minted. A changed wording is a new label with a digest of its own. */
const DIGESTS: Readonly<Record<string, string>> = {
  "2026-11-whatsapp-1": "0cc3024ba32f406bf7fc9f962918ab68ea78359e8b321d3b440ad07abaa33da6",
  "2026-11-medien-1": "03104b930c21137b7350fbf1240ee697b0bc5d5da4005520921e398678d4144e",
  "2026-11-name-kader-1": "79d1286db7e35c140d4948278f6c30a3a1ec6f0230e5047a6d0d46404964931e",
  "2026-11-name-spielplan-1": "6432083f10d42329fb7969a2e443a896be0147d668e3661e927cfa6cc119662d",
};

// Keys sorted, so moving a key inside an entry leaves its digest alone: only its words count.
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
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
