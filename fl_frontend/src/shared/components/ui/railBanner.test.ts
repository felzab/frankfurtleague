import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inlineBannersAt, resolveBlockingBanners, resolveRailBanners } from "./railBanner.ts";

import type { RailBanner } from "./railBanner.ts";

const banner = (
  id: string,
  severity: RailBanner["severity"],
  supersedes?: readonly string[],
  // Defaulted here alone, so the ordering cases stay about ordering. `RailBanner` keeps it required.
  raisedBy: RailBanner["raisedBy"] = "change",
): RailBanner => ({
  id,
  severity,
  title: id,
  body: id,
  inline: null,
  raisedBy,
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
    // An equal-severity edge is the shape with no severity gap to order it, so one that worked only
    // when the narrower banner was pushed first would do nothing and report nothing.
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
  /** Fails the test rather than the type check, so a `null` here reports as the assertion it is. */
  const blockingOf = (banners: readonly RailBanner[]): readonly RailBanner[] => {
    const blocking = resolveBlockingBanners(banners);

    assert.notEqual(blocking, null, "expected these banners to stop a save");
    return blocking ?? [];
  };

  it("answers null for a draft raising only info, so a clean save is never confirmed", () => {
    const clean = resolveBlockingBanners([banner("standing-fact", "info"), banner("another-standing-fact", "info")]);

    // Null rather than an empty list is what makes "open the dialog" and "there is something to show"
    // one answer — the modal takes this value and cannot be handed a list with nothing in it.
    assert.equal(clean, null);
  });

  it("returns the warning itself, so the dialog lists what it is asking about", () => {
    const blocking = blockingOf([banner("standing-fact", "info"), banner("name-changed", "warning")]);

    assert.deepEqual(ids(blocking), ["name-changed"]);
    assert.equal(blocking[0]?.title, "name-changed");
  });

  it("keeps a danger ahead of a warning, as the rail shows them", () => {
    assert.deepEqual(ids(blockingOf([banner("w", "warning"), banner("d", "danger")])), ["d", "w"]);
  });

  it("drops a warning a surviving banner supersedes, so one situation is never asked about twice", () => {
    assert.deepEqual(ids(blockingOf([banner("general", "warning"), banner("specific", "warning", ["general"])])), ["specific"]);
  });

  it("never confirms a situation the save did not cause, however grave it is", () => {
    // The rule this gate exists for: a slot an admin has already lived with would otherwise re-ask on
    // every unrelated edit, forever. Severity is what it looks like; `raisedBy` is what it asks.
    const standing = resolveBlockingBanners([banner("hand-set-slot", "danger", undefined, "state")]);

    assert.equal(standing, null);
  });

  it("asks about the consequence and not the company it keeps", () => {
    const blocking = blockingOf([banner("hand-set-slot", "danger", undefined, "state"), banner("kickoff-moved", "warning")]);

    // The danger outranks the warning on the rail and still says nothing here, so the dialog names
    // the one thing this save does rather than leading with the loudest thing on the page.
    assert.deepEqual(ids(blocking), ["kickoff-moved"]);
  });

  it("leaves a standing banner its severity, which is what the rail paints", () => {
    const [first] = resolveRailBanners([banner("hand-set-slot", "danger", undefined, "state")]);

    assert.equal(first?.severity, "danger");
  });

  it("leaves the input untouched", () => {
    const input = [banner("i", "info"), banner("d", "danger")];

    resolveBlockingBanners(input);

    assert.deepEqual(ids(input), ["i", "d"]);
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
