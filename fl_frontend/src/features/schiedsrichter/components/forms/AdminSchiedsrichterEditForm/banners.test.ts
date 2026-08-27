import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSchiedsrichterBanners } from "./banners.ts";

import type { SchiedsrichterBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildSchiedsrichterBanners>[0]> = {}): readonly SchiedsrichterBanner[] =>
  buildSchiedsrichterBanners({
    isRetired: false,
    isNameChanged: false,
    hasKontakt: true,
    ...overrides,
  });

const ids = (banners: readonly SchiedsrichterBanner[]): string[] => banners.map((banner) => banner.id);

describe("buildSchiedsrichterBanners", () => {
  it("raises nothing for a settled referee with no pending edit", () => {
    assert.deepEqual(ids(build()), []);
  });

  it("reports a retirement without stopping a save, because the fields stay editable", () => {
    const [banner] = build({ isRetired: true });

    assert.equal(banner?.id, "schiedsrichter.retired");
    assert.equal(banner?.severity, "info");
    // Rail-only: the retirement belongs to no panel's field.
    assert.equal(banner?.inline, null);
  });

  it("leads with the retirement, which is what the rest of the page has to be read against", () => {
    assert.equal(ids(build({ isRetired: true, isNameChanged: true, hasKontakt: false }))[0], "schiedsrichter.retired");
  });

  it("grades the rename as the one banner that stops a save", () => {
    const [banner] = build({ isNameChanged: true });

    assert.equal(banner?.id, "schiedsrichter.name-changed");
    assert.equal(banner?.severity, "warning");
  });

  it("reports a missing contact from the DRAFT, so filling one in clears it before the save", () => {
    assert.ok(ids(build({ hasKontakt: false })).includes("schiedsrichter.no-kontakt"));
    assert.ok(!ids(build({ hasKontakt: true })).includes("schiedsrichter.no-kontakt"));
  });

  /* The title is the whole banner. A body saying the gap stops nothing is reassurance, which tells
     the reader the banner did not need writing (`docs/frontend/spec.md` §1.12). */
  it("states the missing contact in its title and writes no body under it", () => {
    const banner = build({ hasKontakt: false }).find(({ id }) => id === "schiedsrichter.no-kontakt");

    assert.equal(banner?.body, undefined);
  });
});
