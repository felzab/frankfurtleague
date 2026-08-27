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
    // Rail-only: the retirement belongs to no panel's field.
    assert.equal(banner?.inline, null);
  });

  /* One shape across the four retirable editors: the title names the exclusion, the body names what
     survives, and the way back is the header's own control rather than a sentence pointing at it. */
  it("states the retirement as the exclusion plus what survives, and points at no control", () => {
    const [banner] = build({ isRetired: true });

    assert.match(banner?.title ?? "", /erscheint in keiner Auswahlliste/);
    assert.ok(!/reaktivieren|Kopf der Seite/i.test(banner?.body ?? ""));
  });

  it("leads with the retirement, which is what the rest of the page has to be read against", () => {
    assert.equal(ids(build({ isRetired: true, isNameChanged: true, hasStadtteil: false }))[0], "spielort.retired");
  });

  it("treats a moved address as the same fan-out a rename is", () => {
    // Both halves are written by one patch, so either one alone must raise the pair.
    assert.deepEqual(ids(build({ isNameChanged: true })), ids(build({ isAddressChanged: true })));
  });

  it("states the fan-out exactly once, however many identity fields were touched", () => {
    // One write, so two entries would be the same consequence read twice.
    for (const touched of [{ isNameChanged: true }, { isAddressChanged: true }, { isNameChanged: true, isAddressChanged: true }]) {
      assert.deepEqual(ids(build(touched)), ["spielort.maps-link-derived"]);
    }
  });

  it("grades the fan-out as a warning, so a save stops on it", () => {
    const [banner] = resolveRailBanners(build({ isAddressChanged: true }));

    assert.equal(banner?.severity, "warning");
  });

  it("reports a missing district from the DRAFT, so typing one in clears it before the save", () => {
    assert.ok(ids(build({ hasStadtteil: false })).includes("spielort.kein-stadtteil"));
    assert.ok(!ids(build({ hasStadtteil: true })).includes("spielort.kein-stadtteil"));
  });

  /* The title is the whole banner. A body would have to say the field is optional, which the absent
     required marker says, or where the district is searched, which the panel's own hint says. */
  it("states the missing district in its title and writes no body under it", () => {
    const [banner] = build({ hasStadtteil: false });

    assert.equal(banner?.body, undefined);
    assert.match(banner?.title ?? "", /kein Stadtteil/);
  });
});
