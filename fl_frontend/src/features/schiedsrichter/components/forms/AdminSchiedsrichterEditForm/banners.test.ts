import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveBlockingBanners } from "@/shared/components/ui/railBanner.ts";

import { buildSchiedsrichterBanners } from "./banners.ts";

import type { SchiedsrichterBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildSchiedsrichterBanners>[0]> = {}): readonly SchiedsrichterBanner[] =>
  buildSchiedsrichterBanners({
    isRetired: false,
    isNameChanged: false,
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
    assert.equal(banner?.raisedBy, "state");
  });

  /* One shape across the four retirable editors: the title names the exclusion, the body names what
     survives, and the way back is the header's own control rather than a sentence pointing at it. */
  it("states the retirement as the exclusion plus what survives, and points at no control", () => {
    const [banner] = build({ isRetired: true });

    assert.match(banner?.title ?? "", /erscheint in keiner Auswahlliste/);
    assert.match(banner?.body ?? "", /Einsätze bleiben erhalten/, "the body stopped naming what survives");
    assert.ok(!/reaktivieren|Kopf der Seite/i.test(banner?.body ?? ""));
  });

  it("leads with the retirement, which is what the rest of the page has to be read against", () => {
    assert.equal(ids(build({ isRetired: true, isNameChanged: true }))[0], "schiedsrichter.retired");
  });

  it("grades the rename as the one banner that stops a save", () => {
    const [banner] = build({ isNameChanged: true });

    assert.equal(banner?.id, "schiedsrichter.name-changed");
    assert.equal(banner?.severity, "warning");
    assert.equal(banner?.raisedBy, "change");
  });

  /* Pinned per editor because `raisedBy` is authored here rather than derived: a retirement is on
     screen before the admin types, so it keeps its rail entry and asks nothing when they save. */
  it("confirms the save the draft causes and never the situation it inherited", () => {
    assert.equal(resolveBlockingBanners(build({ isRetired: true })), null);
    assert.deepEqual(ids(resolveBlockingBanners(build({ isRetired: true, isNameChanged: true })) ?? []), ["schiedsrichter.name-changed"]);
  });
});
