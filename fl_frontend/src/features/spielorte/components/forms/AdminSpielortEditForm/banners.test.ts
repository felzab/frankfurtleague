/**
 * SPIELORTE · venue editor banner tests
 *
 * The one `supersedes` edge on this editor points at a rail banner whose panel twin carries strictly
 * more — the derivation behind the maps link. Asserting it against the resolved list is what keeps a
 * broken edge from surfacing as two banners saying one thing rather than as a failure.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveRailBanners } from "@/shared/components/ui/railBanner.ts";

import { buildSpielortBanners } from "./banners.ts";

import type { SpielortBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildSpielortBanners>[0]> = {}): readonly SpielortBanner[] =>
  buildSpielortBanners({
    isNameChanged: false,
    isAddressChanged: false,
    isMietpreisChanged: false,
    hasStadtteil: true,
    ...overrides,
  });

const ids = (banners: readonly SpielortBanner[]): string[] => banners.map((banner) => banner.id);

describe("buildSpielortBanners", () => {
  it("raises nothing for a settled venue with no pending edit", () => {
    assert.deepEqual(ids(build()), []);
  });

  it("treats a moved address as the same fan-out a rename is", () => {
    // Both halves are written by one patch, so either one alone must raise the pair.
    assert.deepEqual(ids(build({ isNameChanged: true })), ids(build({ isAddressChanged: true })));
  });

  it("drops the general fan-out banner from the rail once the derivation's twin is present", () => {
    // Red without `resolveRailBanners`.
    const built = build({ isNameChanged: true });

    assert.ok(ids(built).includes("spielort.identity-changed"));
    assert.ok(!ids(resolveRailBanners(built)).includes("spielort.identity-changed"));
  });

  it("grades the fan-out as a warning, so a save stops on it", () => {
    const [banner] = resolveRailBanners(build({ isAddressChanged: true }));

    assert.equal(banner?.severity, "warning");
  });

  it("keeps the rent change out of the confirmation, because nothing already agreed is rewritten", () => {
    const [banner] = build({ isMietpreisChanged: true });

    assert.equal(banner?.id, "spielort.miete-changed");
    assert.equal(banner?.severity, "info");
  });

  it("reports a missing district from the DRAFT, so typing one in clears it before the save", () => {
    assert.ok(ids(build({ hasStadtteil: false })).includes("spielort.kein-stadtteil"));
    assert.ok(!ids(build({ hasStadtteil: true })).includes("spielort.kein-stadtteil"));
  });
});
