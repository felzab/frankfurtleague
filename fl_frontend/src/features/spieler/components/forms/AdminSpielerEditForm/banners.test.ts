import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSpielerBanners } from "./banners.ts";

import type { SpielerBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildSpielerBanners>[0]> = {}): readonly SpielerBanner[] =>
  buildSpielerBanners({
    isRetired: false,
    saisonId: "2026",
    saisonStatus: "future",
    isMember: true,
    rowInactiveSince: null,
    isNachgetragen: false,
    isTeamChanged: false,
    newlySharedNummer: null,
    ...overrides,
  });

const ids = (banners: readonly SpielerBanner[]): string[] => banners.map((banner) => banner.id);

describe("buildSpielerBanners", () => {
  it("raises nothing for a settled squad row with no pending edit", () => {
    assert.deepEqual(ids(build()), []);
  });

  it("offers the entry remedy for a player no squad holds", () => {
    const [banner] = build({ isMember: false });

    assert.equal(banner?.id, "spieler.not-in-kader-entry");
    assert.match(banner?.title ?? "", /Saison 2026/);
  });

  it("dates the retirement of the squad row in its title", () => {
    const [banner] = build({ rowInactiveSince: "2026-03-12" });

    assert.equal(banner?.id, "spieler.row-retired-since");
    assert.match(banner?.title ?? "", /12\.03\.2026/);
  });

  it("announces the derived nachgetragen flag only where there is no row to enter into yet", () => {
    assert.ok(ids(build({ isMember: false, saisonStatus: "active" })).includes("spieler.entry-nachgetragen"));
    assert.ok(!ids(build({ isMember: false, saisonStatus: "future" })).includes("spieler.entry-nachgetragen"));
    assert.ok(!ids(build({ saisonStatus: "active" })).includes("spieler.entry-nachgetragen"));
  });

  it("grades a transfer as a warning", () => {
    const [banner] = build({ isTeamChanged: true });

    assert.equal(banner?.id, "spieler.team-changed");
    assert.equal(banner?.severity, "warning");
  });

  // `warning` is what routes it through the confirmation; `info` would let the save pass in silence.
  it("grades a newly shared shirt as a warning naming the number", () => {
    const [banner] = build({ newlySharedNummer: "1" });

    assert.equal(banner?.id, "spieler.nummer-geteilt");
    assert.equal(banner?.severity, "warning");
    assert.match(banner?.body ?? "", /Nummer 1\b/);
  });

  it("raises nothing for a duplicate the row already stands in", () => {
    assert.deepEqual(ids(build({ newlySharedNummer: null })), []);
  });
});
