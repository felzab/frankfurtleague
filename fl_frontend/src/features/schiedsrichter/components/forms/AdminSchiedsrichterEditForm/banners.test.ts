import assert from "node:assert/strict";
import { describe, it } from "node:test";

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

  /* The title names the exclusion, the body what survives, and neither points at a control. */
  it("states the retirement as the exclusion plus what survives, and points at no control", () => {
    const [banner] = build({ isRetired: true });

    assert.match(banner?.title ?? "", /erscheint in keiner Auswahlliste/);
    assert.match(banner?.body ?? "", /Einsätze[^.]*bleiben erhalten/, "the body stopped naming what survives");
    assert.ok(!/reaktivieren|Kopf der Seite/i.test(banner?.body ?? ""));
  });

  /* A referee can be a woman and the published notice writes both forms, so a masculine word here
     names the wrong person for half the collection. Both lines, because one recast leaves the entry
     disagreeing with itself. */
  it("names the retired referee neutrally in its title and in its body", () => {
    const [banner] = build({ isRetired: true });

    assert.match(banner?.title ?? "", /Diese Person/, "the title stopped naming the person neutrally");
    assert.match(banner?.body ?? "", /dieser Person/, "the body stopped naming the person neutrally");
    assert.ok(!/\b[Dd]ieser Schiedsrichter\b/.test(banner?.title ?? ""), "the title is back to a masculine demonstrative");
    assert.ok(!/\bSein(e|em|en|er)?\b/.test(banner?.body ?? ""), "the body is back to a masculine possessive");
  });

  it("leads with the retirement, which is what the rest of the page has to be read against", () => {
    assert.equal(ids(build({ isRetired: true, isNameChanged: true }))[0], "schiedsrichter.retired");
  });

  /* The row reached this editor because no erasure stamp routed it away, so the one thing the empty
     name box must not read as is a deletion. */
  it("says a nameless row was not deleted, and asks nothing at the save", () => {
    const [banner] = build({ isNameless: true });

    assert.equal(banner?.id, "schiedsrichter.nameless");
    assert.equal(banner?.severity, "warning");
    assert.equal(banner?.raisedBy, "state");
    assert.match(banner?.body ?? "", /Gelöscht wurde hier nichts/, "the banner stopped denying a deletion");
    assert.equal(resolveBlockingBanners(build({ isNameless: true })), null);
  });

  /* The fan-out is the same write either way, and a row holding no name has no old one to replace:
     the warning has to keep the consequence without claiming a name that was never there. */
  it("words the rename against a row that never had a name, without dropping the fan-out", () => {
    const [, banner] = build({ isNameless: true, isNameChanged: true });

    assert.equal(banner?.id, "schiedsrichter.name-changed");
    assert.doesNotMatch(banner?.title ?? "", /den alten|neue[nr]? Name/, "the warning still replaces a name this row never held");
    assert.match(banner?.title ?? "", /in jedem Spiel/, "the warning stopped saying the name reaches every match");
    assert.match(banner?.body ?? "", /längst gespielt/, "the warning stopped naming the matches already played");
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
