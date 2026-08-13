/**
 * SHARED · rail banner resolution tests
 *
 * Every clause of `resolveRailBanners`'s docblock is asserted here, because each of them is a claim
 * about an ordering nobody can see on the page: a banner that is wrongly dropped leaves no trace,
 * and a banner that wrongly survives looks exactly like the duplication the helper exists to remove.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inlineBannersAt, resolveBlockingBanners, resolveRailBanners } from "./railBanner.ts";

import type { RailBanner } from "./railBanner.ts";

const banner = (id: string, severity: RailBanner["severity"], supersedes?: readonly string[]): RailBanner => ({
  id,
  severity,
  title: id,
  body: id,
  inline: null,
  ...(supersedes === undefined ? {} : { supersedes }),
});

const ids = (banners: readonly RailBanner[]): string[] => banners.map((entry) => entry.id);

describe("resolveRailBanners", () => {
  it("sorts danger before warning before info", () => {
    const resolved = resolveRailBanners([banner("i", "info"), banner("w", "warning"), banner("d", "danger")]);

    assert.deepEqual(ids(resolved), ["d", "w", "i"]);
  });

  it("keeps the authoring order within one severity", () => {
    const resolved = resolveRailBanners([banner("first", "info"), banner("second", "info"), banner("third", "info")]);

    assert.deepEqual(ids(resolved), ["first", "second", "third"]);
  });

  it("drops a banner a survivor supersedes", () => {
    const resolved = resolveRailBanners([banner("general", "info"), banner("specific", "warning", ["general"])]);

    assert.deepEqual(ids(resolved), ["specific"]);
  });

  it("fires an equal-severity edge whichever way round the editor authored the pair", () => {
    // Four of this app's six edges are info-to-info, so an edge that only worked when the narrower
    // banner happened to be pushed first would silently do nothing on most of them.
    const generalFirst = resolveRailBanners([banner("general", "info"), banner("specific", "info", ["general"])]);
    const specificFirst = resolveRailBanners([banner("specific", "info", ["general"]), banner("general", "info")]);

    assert.deepEqual(ids(generalFirst), ["specific"]);
    assert.deepEqual(ids(specificFirst), ["specific"]);
  });

  it("does not let a milder banner silence a more severe one", () => {
    const resolved = resolveRailBanners([banner("loud", "danger"), banner("quiet", "info", ["loud"])]);

    assert.deepEqual(ids(resolved), ["loud", "quiet"]);
  });

  it("does not reorder a self-naming banner ahead of its equals", () => {
    const resolved = resolveRailBanners([banner("first", "info"), banner("second", "info", ["second"])]);

    assert.deepEqual(ids(resolved), ["first", "second"]);
  });

  it("keeps a superseded banner when its suppressor is absent", () => {
    const resolved = resolveRailBanners([banner("general", "info")]);

    assert.deepEqual(ids(resolved), ["general"]);
  });

  it("is not transitive through a dropped banner", () => {
    // B is gone, so C is not redundant: only what is on screen can make something else redundant.
    const resolved = resolveRailBanners([banner("a", "danger", ["b"]), banner("b", "warning", ["c"]), banner("c", "info")]);

    assert.deepEqual(ids(resolved), ["a", "c"]);
  });

  it("resolves a two-member cycle to the more severe member, dropping neither pair silently", () => {
    const resolved = resolveRailBanners([banner("mild", "info", ["severe"]), banner("severe", "danger", ["mild"])]);

    assert.deepEqual(ids(resolved), ["severe"]);
  });

  it("resolves a same-severity cycle to the earlier-authored member", () => {
    const resolved = resolveRailBanners([banner("earlier", "info", ["later"]), banner("later", "info", ["earlier"])]);

    assert.deepEqual(ids(resolved), ["earlier"]);
  });

  it("lets a banner name itself without dropping itself", () => {
    const resolved = resolveRailBanners([banner("self", "warning", ["self"])]);

    assert.deepEqual(ids(resolved), ["self"]);
  });

  it("treats an id no banner carries as a no-op", () => {
    const resolved = resolveRailBanners([banner("only", "info", ["a-banner-from-another-editor"])]);

    assert.deepEqual(ids(resolved), ["only"]);
  });

  it("leaves the input untouched", () => {
    const input = [banner("i", "info"), banner("d", "danger")];

    resolveRailBanners(input);

    assert.deepEqual(ids(input), ["i", "d"]);
  });
});

describe("resolveBlockingBanners", () => {
  it("returns nothing for a draft raising only info, so a clean save is never confirmed", () => {
    const clean = resolveBlockingBanners([banner("standing-fact", "info"), banner("another-standing-fact", "info")]);

    assert.equal(clean.length, 0);
  });

  it("returns the warning itself, so the dialog lists what it is asking about", () => {
    const blocking = resolveBlockingBanners([banner("standing-fact", "info"), banner("name-changed", "warning")]);

    assert.deepEqual(ids(blocking), ["name-changed"]);
    assert.equal(blocking[0]?.title, "name-changed");
  });

  it("keeps a danger ahead of a warning, as the rail shows them", () => {
    assert.deepEqual(ids(resolveBlockingBanners([banner("w", "warning"), banner("d", "danger")])), ["d", "w"]);
  });

  it("drops a warning a surviving banner supersedes, so one situation is never asked about twice", () => {
    const blocking = resolveBlockingBanners([banner("general", "warning"), banner("specific", "warning", ["general"])]);

    assert.deepEqual(ids(blocking), ["specific"]);
  });
});

describe("inlineBannersAt", () => {
  it("returns only the banners anchored at one spot, in authoring order", () => {
    const at = (id: string, spot: string | null): RailBanner => ({ ...banner(id, "info"), inline: spot });
    const banners = [at("one", "absage"), at("two", null), at("three", "absage")];

    assert.deepEqual(ids(inlineBannersAt(banners, "absage")), ["one", "three"]);
  });

  it("does not suppress a banner the rail's list would drop", () => {
    // The rail asks "what still needs saying"; a callout at the control that causes it is not
    // competing for that space, so a superseded banner keeps its own panel spot.
    const general: RailBanner = { ...banner("general", "info"), inline: "saison" };
    const specific: RailBanner = { ...banner("specific", "warning", ["general"]), inline: "saison" };

    assert.deepEqual(ids(inlineBannersAt([general, specific], "saison")), ["general", "specific"]);
  });
});
