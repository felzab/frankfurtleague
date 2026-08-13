/**
 * SPIELER · squad editor banner tests
 *
 * The two `supersedes` edges on this editor both point at a rail banner whose panel twin carries
 * strictly more — the remedy, or the date. Asserting them against the resolved list is what keeps a
 * broken edge from surfacing as two banners saying one thing rather than as a failure.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveRailBanners } from "@/shared/components/ui/railBanner.ts";

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
    ...overrides,
  });

const ids = (banners: readonly SpielerBanner[]): string[] => banners.map((banner) => banner.id);

describe("buildSpielerBanners", () => {
  it("raises nothing for a settled squad row with no pending edit", () => {
    assert.deepEqual(ids(build()), []);
  });

  it("drops the general no-squad banner from the rail once the entry panel's twin is present", () => {
    // Red without `resolveRailBanners`.
    const built = build({ isMember: false });

    assert.ok(ids(built).includes("spieler.not-in-kader"));
    assert.ok(!ids(resolveRailBanners(built)).includes("spieler.not-in-kader"));
  });

  it("drops the undated retirement banner from the rail once the dated one is present", () => {
    // Red without `resolveRailBanners`.
    const built = build({ rowInactiveSince: "2026-03-12" });

    assert.ok(ids(built).includes("spieler.row-retired"));
    assert.ok(!ids(resolveRailBanners(built)).includes("spieler.row-retired"));
    assert.match(resolveRailBanners(built)[0]?.title ?? "", /12\.03\.2026/);
  });

  it("announces the derived nachgetragen flag only where there is no row to enter into yet", () => {
    assert.ok(ids(build({ isMember: false, saisonStatus: "active" })).includes("spieler.entry-nachgetragen"));
    assert.ok(!ids(build({ isMember: false, saisonStatus: "future" })).includes("spieler.entry-nachgetragen"));
    assert.ok(!ids(build({ saisonStatus: "active" })).includes("spieler.entry-nachgetragen"));
  });

  it("grades a transfer as the one warning on this editor", () => {
    const [banner] = build({ isTeamChanged: true });

    assert.equal(banner?.id, "spieler.team-changed");
    assert.equal(banner?.severity, "warning");
  });
});
