import { assert, describe, expect, it } from "vitest";

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
    expect(ids(build())).toStrictEqual([]);
  });

  it("reports a retirement without stopping a save, because the fields stay editable", () => {
    const [banner] = build({ isRetired: true });

    expect(banner?.id).toBe("spielort.retired");
    expect(banner?.severity).toBe("info");
    // Rail-only: the retirement belongs to no panel's field.
    expect(banner?.inline).toBe(null);
    expect(banner?.raisedBy).toBe("state");
  });

  /* The title names the exclusion, the body what survives, and neither points at a control. */
  it("states the retirement as the exclusion plus what survives, and points at no control", () => {
    const [banner] = build({ isRetired: true });

    expect(banner?.title ?? "").toMatch(/erscheint in keiner Auswahlliste/);
    expect(banner?.body ?? "", "the body stopped naming what survives").toMatch(/Spiele bleiben erhalten/);
    assert.ok(!/reaktivieren|Kopf der Seite/i.test(banner?.body ?? ""));
  });

  it("leads with the retirement, which is what the rest of the page has to be read against", () => {
    expect(ids(build({ isRetired: true, isNameChanged: true }))[0]).toBe("spielort.retired");
  });

  it("treats a moved address as the same fan-out a rename is", () => {
    // Both halves are written by one patch, so either one alone must raise the pair.
    expect(ids(build({ isNameChanged: true }))).toStrictEqual(ids(build({ isAddressChanged: true })));
  });

  it("states the fan-out exactly once, however many identity fields were touched", () => {
    // One write, so two entries would be the same consequence read twice.
    for (const touched of [{ isNameChanged: true }, { isAddressChanged: true }, { isNameChanged: true, isAddressChanged: true }]) {
      expect(ids(build(touched))).toStrictEqual(["spielort.name-adresse-changed"]);
    }
  });

  it("grades the fan-out as a warning, so a save stops on it", () => {
    const [banner] = resolveRailBanners(build({ isAddressChanged: true }));

    expect(banner?.severity).toBe("warning");
    expect(banner?.raisedBy).toBe("change");
  });

  /* Pinned per editor because `raisedBy` is authored here rather than derived: a retirement is on
     screen before the admin types, so it keeps its rail entry and asks nothing when they save. */
  it("confirms the save the draft causes and never the situation it inherited", () => {
    expect(resolveBlockingBanners(build({ isRetired: true }))).toBe(null);
    expect(ids(resolveBlockingBanners(build({ isRetired: true, isNameChanged: true })) ?? [])).toStrictEqual(["spielort.name-adresse-changed"]);
  });
});
