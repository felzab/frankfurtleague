import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTeamBanners } from "./banners.ts";

import type { TeamBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildTeamBanners>[0]> = {}): readonly TeamBanner[] =>
  buildTeamBanners({
    isRetired: false,
    saisonId: "2026",
    saisonStatus: "future",
    isMember: true,
    storedDisqualifikation: null,
    isDisqualified: false,
    isGruppeLocked: false,
    isGruppeChanged: false,
    ...overrides,
  });

const ids = (banners: readonly TeamBanner[]): string[] => banners.map((banner) => banner.id);

describe("buildTeamBanners", () => {
  it("raises nothing for a settled membership with no pending edit", () => {
    assert.deepEqual(ids(build()), []);
  });

  it("names the season the club is missing from, in the title", () => {
    const [banner] = build({ isMember: false });

    // Pinned by id, so the title below is asserted against a named banner rather than whichever one
    // the builder happens to push first.
    assert.equal(banner?.id, "team.not-in-saison-future");
    assert.match(banner?.title ?? "", /Saison 2026/);
  });

  it("splits the entry case from the closed one on the season's status", () => {
    assert.ok(ids(build({ isMember: false })).includes("team.not-in-saison-future"));
    assert.ok(ids(build({ isMember: false, saisonStatus: "active" })).includes("team.not-in-saison-closed"));
    assert.ok(ids(build({ isMember: false, saisonStatus: "past" })).includes("team.not-in-saison-closed"));
  });

  it("says which of the two closed statuses is in the way", () => {
    const closed = (status: "active" | "past") =>
      build({ isMember: false, saisonStatus: status }).find((banner) => banner.id === "team.not-in-saison-closed")?.body ?? "";

    assert.match(closed("active"), /läuft bereits/);
    assert.match(closed("past"), /beendet/);
  });

  it("tells entering a disqualification apart from lifting one", () => {
    const record = { grund: "Nicht angetreten", datum: "2026-03-12" };

    assert.deepEqual(ids(build({ isDisqualified: true })), ["team.dq-entering"]);
    assert.deepEqual(ids(build({ storedDisqualifikation: record })), ["team.dq-lifting"]);
  });

  it("renders the stored reason verbatim, with its date in the title", () => {
    const record = { grund: "Wiederholt nicht angetreten", datum: "2026-03-12" };
    const [banner] = build({ isDisqualified: true, storedDisqualifikation: record });

    assert.equal(banner?.body, record.grund);
    assert.match(banner?.title ?? "", /12\.03\.2026/);
  });

  it("keeps the group warning off a locked group, whatever the draft says", () => {
    assert.deepEqual(ids(build({ isGruppeChanged: true })), ["team.gruppe-changed"]);
    assert.deepEqual(ids(build({ isGruppeChanged: true, isGruppeLocked: true })), []);
  });
});
