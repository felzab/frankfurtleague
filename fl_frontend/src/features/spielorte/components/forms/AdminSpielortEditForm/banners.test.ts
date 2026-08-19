/**
 * SPIELORTE · venue editor banner tests
 *
 * The fan-out entry is the one an admin acts on, and both identity fields raise it. Asserting the two
 * fields against each other is what keeps a rename and a moved address from drifting into two
 * different warnings about one write.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveRailBanners } from "@/shared/components/ui/railBanner.ts";

import { buildSpielortBanners } from "./banners.ts";

import type { SpielortBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildSpielortBanners>[0]> = {}): readonly SpielortBanner[] =>
  buildSpielortBanners({
    isRetired: false,
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

  it("reports a retirement without stopping a save, because the fields stay editable", () => {
    const [banner] = build({ isRetired: true });

    assert.equal(banner?.id, "spielort.retired");
    assert.equal(banner?.severity, "info");
    // Rail-only: the retirement belongs to no panel's field, and the header carries the date and the
    // control that reverses it.
    assert.equal(banner?.inline, null);
  });

  it("leads with the retirement, which is what the rest of the page has to be read against", () => {
    assert.equal(ids(build({ isRetired: true, isNameChanged: true, hasStadtteil: false }))[0], "spielort.retired");
  });

  it("treats a moved address as the same fan-out a rename is", () => {
    // Both halves are written by one patch, so either one alone must raise the pair.
    assert.deepEqual(ids(build({ isNameChanged: true })), ids(build({ isAddressChanged: true })));
  });

  it("states the fan-out exactly once, however many identity fields were touched", () => {
    // An admin who changed both the name and the address is looking at one write, so two entries
    // would be the same consequence read twice.
    for (const touched of [{ isNameChanged: true }, { isAddressChanged: true }, { isNameChanged: true, isAddressChanged: true }]) {
      assert.deepEqual(ids(build(touched)), ["spielort.maps-link-derived"]);
    }
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
