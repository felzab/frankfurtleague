import { assert, describe, expect, it } from "vitest";

import { resolveBlockingBanners } from "@/shared/components/ui/railBanner.ts";

import { buildSchiedsrichterBanners } from "./banners.ts";

import type { SchiedsrichterBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildSchiedsrichterBanners>[0]> = {}): readonly SchiedsrichterBanner[] =>
  buildSchiedsrichterBanners({
    isRetired: false,
    isNameless: false,
    isNameChanged: false,
    ...overrides,
  });

const ids = (banners: readonly SchiedsrichterBanner[]): string[] => banners.map((banner) => banner.id);

describe("buildSchiedsrichterBanners", () => {
  it("raises nothing for a settled referee with no pending edit", () => {
    expect(ids(build())).toStrictEqual([]);
  });

  it("reports a retirement without stopping a save, because the fields stay editable", () => {
    const [banner] = build({ isRetired: true });

    expect(banner?.id).toBe("schiedsrichter.retired");
    expect(banner?.severity).toBe("info");
    // Rail-only: the retirement belongs to no panel's field.
    expect(banner?.inline).toBe(null);
    expect(banner?.raisedBy).toBe("state");
  });

  /* The title names the exclusion, the body what survives, and neither points at a control. */
  it("states the retirement as the exclusion plus what survives, and points at no control", () => {
    const [banner] = build({ isRetired: true });

    expect(banner?.title ?? "").toMatch(/erscheint in keiner Auswahlliste/);
    expect(banner?.body ?? "", "the body stopped naming what survives").toMatch(/Einsätze[^.]*bleiben erhalten/);
    assert.ok(!/reaktivieren|Kopf der Seite/i.test(banner?.body ?? ""));
  });

  /* A referee can be a woman and the published notice writes both forms, so a masculine word here
     names the wrong person for half the collection. Both lines, because one recast leaves the entry
     disagreeing with itself. */
  it("names the retired referee neutrally in its title and in its body", () => {
    const [banner] = build({ isRetired: true });

    expect(banner?.title ?? "", "the title stopped naming the person neutrally").toMatch(/Diese Person/);
    expect(banner?.body ?? "", "the body stopped naming the person neutrally").toMatch(/dieser Person/);
    assert.ok(!/\b[Dd]ieser Schiedsrichter\b/.test(banner?.title ?? ""), "the title is back to a masculine demonstrative");
    assert.ok(!/\bSein(e|em|en|er)?\b/.test(banner?.body ?? ""), "the body is back to a masculine possessive");
  });

  it("leads with the retirement, which is what the rest of the page has to be read against", () => {
    expect(ids(build({ isRetired: true, isNameChanged: true }))[0]).toBe("schiedsrichter.retired");
  });

  /* The row reached this editor because no erasure stamp routed it away, so the one thing the empty
     name box must not read as is a deletion. */
  it("says a nameless row was not deleted, and asks nothing at the save", () => {
    const [banner] = build({ isNameless: true });

    expect(banner?.id).toBe("schiedsrichter.nameless");
    expect(banner?.severity).toBe("warning");
    expect(banner?.raisedBy).toBe("state");
    expect(banner?.body ?? "", "the banner stopped denying a deletion").toMatch(/Gelöscht wurde hier nichts/);
    expect(resolveBlockingBanners(build({ isNameless: true }))).toBe(null);
  });

  /* The fan-out is the same write either way, and a row holding no name has no old one to replace:
     the warning has to keep the consequence without claiming a name that was never there. */
  it("words the rename against a row that never had a name, without dropping the fan-out", () => {
    const [, banner] = build({ isNameless: true, isNameChanged: true });

    expect(banner?.id).toBe("schiedsrichter.name-changed");
    expect(banner?.title ?? "", "the warning still replaces a name this row never held").not.toMatch(/den alten|neue[nr]? Name/);
    expect(banner?.title ?? "", "the warning stopped saying the name reaches every match").toMatch(/in jedem Spiel/);
    expect(banner?.body ?? "", "the warning stopped naming the matches already played").toMatch(/längst gespielt/);
  });

  it("grades the rename as the one banner that stops a save", () => {
    const [banner] = build({ isNameChanged: true });

    expect(banner?.id).toBe("schiedsrichter.name-changed");
    expect(banner?.severity).toBe("warning");
    expect(banner?.raisedBy).toBe("change");
  });

  /* Pinned per editor because `raisedBy` is authored here rather than derived: a retirement is on
     screen before the admin types, so it keeps its rail entry and asks nothing when they save. */
  it("confirms the save the draft causes and never the situation it inherited", () => {
    expect(resolveBlockingBanners(build({ isRetired: true }))).toBe(null);
    expect(ids(resolveBlockingBanners(build({ isRetired: true, isNameChanged: true })) ?? [])).toStrictEqual(["schiedsrichter.name-changed"]);
  });
});
