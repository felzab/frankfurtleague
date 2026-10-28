import { describe, expect, it } from "vitest";

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

    expect(ids(resolved)).toStrictEqual(["d", "w", "i"]);
  });

  it("keeps the authoring order within one severity", () => {
    const resolved = resolveRailBanners([banner("first", "info"), banner("second", "info"), banner("third", "info")]);

    expect(ids(resolved)).toStrictEqual(["first", "second", "third"]);
  });

  it("drops a banner a survivor supersedes", () => {
    const resolved = resolveRailBanners([banner("general", "info"), banner("specific", "warning", ["general"])]);

    expect(ids(resolved)).toStrictEqual(["specific"]);
  });

  it("fires an equal-severity edge whichever way round the editor authored the pair", () => {
    // An equal-severity edge is the shape with no severity gap to order it, so one that worked only
    // when the narrower banner was pushed first would do nothing and report nothing.
    const generalFirst = resolveRailBanners([banner("general", "info"), banner("specific", "info", ["general"])]);
    const specificFirst = resolveRailBanners([banner("specific", "info", ["general"]), banner("general", "info")]);

    expect(ids(generalFirst)).toStrictEqual(["specific"]);
    expect(ids(specificFirst)).toStrictEqual(["specific"]);
  });

  it("does not let a milder banner silence a more severe one", () => {
    const resolved = resolveRailBanners([banner("loud", "danger"), banner("quiet", "info", ["loud"])]);

    expect(ids(resolved)).toStrictEqual(["loud", "quiet"]);
  });

  it("does not reorder a self-naming banner ahead of its equals", () => {
    const resolved = resolveRailBanners([banner("first", "info"), banner("second", "info", ["second"])]);

    expect(ids(resolved)).toStrictEqual(["first", "second"]);
  });

  it("keeps a superseded banner when its suppressor is absent", () => {
    const resolved = resolveRailBanners([banner("general", "info")]);

    expect(ids(resolved)).toStrictEqual(["general"]);
  });

  it("is not transitive through a dropped banner", () => {
    // B is gone, so C is not redundant: only what is on screen can make something else redundant.
    const resolved = resolveRailBanners([banner("a", "danger", ["b"]), banner("b", "warning", ["c"]), banner("c", "info")]);

    expect(ids(resolved)).toStrictEqual(["a", "c"]);
  });

  it("resolves a two-member cycle to the more severe member, dropping neither pair silently", () => {
    const resolved = resolveRailBanners([banner("mild", "info", ["severe"]), banner("severe", "danger", ["mild"])]);

    expect(ids(resolved)).toStrictEqual(["severe"]);
  });

  it("resolves a same-severity cycle to the earlier-authored member", () => {
    const resolved = resolveRailBanners([banner("earlier", "info", ["later"]), banner("later", "info", ["earlier"])]);

    expect(ids(resolved)).toStrictEqual(["earlier"]);
  });

  it("lets a banner name itself without dropping itself", () => {
    const resolved = resolveRailBanners([banner("self", "warning", ["self"])]);

    expect(ids(resolved)).toStrictEqual(["self"]);
  });

  it("treats an id no banner carries as a no-op", () => {
    const resolved = resolveRailBanners([banner("only", "info", ["a-banner-from-another-editor"])]);

    expect(ids(resolved)).toStrictEqual(["only"]);
  });

  it("leaves the input untouched", () => {
    const input = [banner("i", "info"), banner("d", "danger")];

    resolveRailBanners(input);

    expect(ids(input)).toStrictEqual(["i", "d"]);
  });
});

describe("resolveBlockingBanners", () => {
  /** Fails the test rather than the type check, so a `null` here reports as the assertion it is. */
  const blockingOf = (banners: readonly RailBanner[]): readonly RailBanner[] => {
    const blocking = resolveBlockingBanners(banners);

    expect(blocking, "expected these banners to stop a save").not.toBe(null);
    return blocking ?? [];
  };

  it("answers null for a draft raising only info, so a clean save is never confirmed", () => {
    const clean = resolveBlockingBanners([banner("standing-fact", "info"), banner("another-standing-fact", "info")]);

    // Null rather than an empty list is what makes "open the dialog" and "there is something to show"
    // one answer — the modal takes this value and cannot be handed a list with nothing in it.
    expect(clean).toBe(null);
  });

  it("returns the warning itself, so the dialog lists what it is asking about", () => {
    const blocking = blockingOf([banner("standing-fact", "info"), banner("name-changed", "warning")]);

    expect(ids(blocking)).toStrictEqual(["name-changed"]);
    expect(blocking[0]?.title).toBe("name-changed");
  });

  it("keeps a danger ahead of a warning, as the rail shows them", () => {
    expect(ids(blockingOf([banner("w", "warning"), banner("d", "danger")]))).toStrictEqual(["d", "w"]);
  });

  it("drops a warning a surviving banner supersedes, so one situation is never asked about twice", () => {
    expect(ids(blockingOf([banner("general", "warning"), banner("specific", "warning", ["general"])]))).toStrictEqual(["specific"]);
  });

  it("never confirms a situation the save did not cause, however grave it is", () => {
    // The rule this gate exists for: a slot an admin has already lived with would otherwise re-ask on
    // every unrelated edit, forever. Severity is what it looks like; `raisedBy` is what it asks.
    const standing = resolveBlockingBanners([banner("hand-set-slot", "danger", undefined, "state")]);

    expect(standing).toBe(null);
  });

  it("asks about the consequence and not the company it keeps", () => {
    const blocking = blockingOf([banner("hand-set-slot", "danger", undefined, "state"), banner("kickoff-moved", "warning")]);

    // The danger outranks the warning on the rail and still says nothing here, so the dialog names
    // the one thing this save does rather than leading with the loudest thing on the page.
    expect(ids(blocking)).toStrictEqual(["kickoff-moved"]);
  });

  it("leaves a standing banner its severity, which is what the rail paints", () => {
    const [first] = resolveRailBanners([banner("hand-set-slot", "danger", undefined, "state")]);

    expect(first?.severity).toBe("danger");
  });

  it("leaves the input untouched", () => {
    const input = [banner("i", "info"), banner("d", "danger")];

    resolveBlockingBanners(input);

    expect(ids(input)).toStrictEqual(["i", "d"]);
  });
});

describe("inlineBannersAt", () => {
  it("returns only the banners anchored at one spot, in authoring order", () => {
    const at = (id: string, spot: string | null): RailBanner => ({ ...banner(id, "info"), inline: spot });
    const banners = [at("one", "absage"), at("two", null), at("three", "absage")];

    expect(ids(inlineBannersAt(banners, "absage"))).toStrictEqual(["one", "three"]);
  });

  it("does not suppress a banner the rail's list would drop", () => {
    // The rail asks "what still needs saying"; a callout at the control that causes it is not
    // competing for that space, so a superseded banner keeps its own panel spot.
    const general: RailBanner = { ...banner("general", "info"), inline: "saison" };
    const specific: RailBanner = { ...banner("specific", "warning", ["general"]), inline: "saison" };

    expect(ids(inlineBannersAt([general, specific], "saison"))).toStrictEqual(["general", "specific"]);
  });
});
