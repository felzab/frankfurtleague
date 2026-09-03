import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveBlockingBanners, resolveRailBanners } from "@/shared/components/ui/railBanner.ts";

import { buildSpielortBanners } from "./banners.ts";

import type { SpielortBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildSpielortBanners>[0]> = {}): readonly SpielortBanner[] =>
  buildSpielortBanners({
    isRetired: false,
    isNameChanged: false,
    isAddressChanged: false,
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
    assert.equal(banner?.raisedBy, "state");
  });

  /* The title names the exclusion, the body what survives, and neither points at a control. */
  it("states the retirement as the exclusion plus what survives, and points at no control", () => {
    const [banner] = build({ isRetired: true });

    assert.match(banner?.title ?? "", /erscheint in keiner Auswahlliste/);
    assert.match(banner?.body ?? "", /Spiele bleiben erhalten/, "the body stopped naming what survives");
    assert.ok(!/reaktivieren|Kopf der Seite/i.test(banner?.body ?? ""));
  });

  it("leads with the retirement, which is what the rest of the page has to be read against", () => {
    assert.equal(ids(build({ isRetired: true, isNameChanged: true }))[0], "spielort.retired");
  });

  it("treats a moved address as the same fan-out a rename is", () => {
    // Both halves are written by one patch, so either one alone must raise the pair.
    assert.deepEqual(ids(build({ isNameChanged: true })), ids(build({ isAddressChanged: true })));
  });

  it("states the fan-out exactly once, however many identity fields were touched", () => {
    // One write, so two entries would be the same consequence read twice.
    for (const touched of [{ isNameChanged: true }, { isAddressChanged: true }, { isNameChanged: true, isAddressChanged: true }]) {
      assert.deepEqual(ids(build(touched)), ["spielort.name-adresse-changed"]);
    }
  });

  it("grades the fan-out as a warning, so a save stops on it", () => {
    const [banner] = resolveRailBanners(build({ isAddressChanged: true }));

    assert.equal(banner?.severity, "warning");
    assert.equal(banner?.raisedBy, "change");
  });

  /* Pinned per editor because `raisedBy` is authored here rather than derived: a retirement is on
     screen before the admin types, so it keeps its rail entry and asks nothing when they save. */
  it("confirms the save the draft causes and never the situation it inherited", () => {
    assert.equal(resolveBlockingBanners(build({ isRetired: true })), null);
    assert.deepEqual(ids(resolveBlockingBanners(build({ isRetired: true, isNameChanged: true })) ?? []), ["spielort.name-adresse-changed"]);
  });
});
