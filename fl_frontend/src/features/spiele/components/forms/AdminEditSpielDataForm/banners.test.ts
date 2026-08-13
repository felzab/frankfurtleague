/**
 * SPIELE · match editor banner tests
 *
 * The cancellation cluster is the one place in the app where three banners fire on one switch flip,
 * so the two edges that thin it out are asserted against the resolved list rather than the authored
 * one. The per-side entries are asserted for distinct ids, which is what the React key rests on now
 * that the titles interpolate a club name.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveRailBanners } from "@/shared/components/ui/railBanner.ts";

import { buildSpielBanners } from "./banners.ts";

import type { SpielBanner, SpielBannerSide } from "./banners.ts";

const side = (fieldName: "team1" | "team2", overrides: Partial<SpielBannerSide> = {}): SpielBannerSide => ({
  fieldName,
  label: fieldName === "team1" ? "Team 1" : "Team 2",
  quelle: null,
  team: null,
  ...overrides,
});

const team = (teamId: string, name: string) => ({ team_id: teamId, name, shorthand: name.slice(0, 3), tore: null, disqualifikation: null });

const build = (overrides: Partial<Parameters<typeof buildSpielBanners>[0]> = {}): readonly SpielBanner[] =>
  buildSpielBanners({
    isKnockout: true,
    sides: [],
    knockoutTeamIds: new Set<string>(),
    isBeingCalledOff: false,
    isCanceled: false,
    dependentSpielNummern: [],
    hasDecidedErgebnis: false,
    voidedSpielNummern: [],
    releasedSpielNummern: [],
    ...overrides,
  });

const ids = (banners: readonly SpielBanner[]): string[] => banners.map((banner) => banner.id);

describe("buildSpielBanners", () => {
  it("raises nothing for an untouched knockout fixture with both sides wired", () => {
    assert.deepEqual(ids(build({ sides: [side("team1", { quelle: { type: "gruppe", gruppe: "A", platz: 1 } })] })), []);
  });

  it("says nothing about a manual side in the group phase, where there is no wiring to lose", () => {
    assert.deepEqual(ids(build({ isKnockout: false, sides: [side("team1"), side("team2")] })), []);
  });

  it("gives the two sides distinct ids, which is what the React key now rests on", () => {
    const built = build({ sides: [side("team1"), side("team2")] });

    assert.deepEqual(ids(built), ["spiel.team1-manual", "spiel.team2-manual"]);
  });

  it("adds the qualification warning only for a hand-picked team the bracket does not already field", () => {
    const picked = side("team1", { team: team("t1", "Adler") });

    assert.ok(ids(build({ sides: [picked] })).includes("spiel.team1-unqualified"));
    assert.ok(!ids(build({ sides: [picked], knockoutTeamIds: new Set(["t1"]) })).includes("spiel.team1-unqualified"));
  });

  it("thins the cancellation cluster down: the standing note goes while either specific banner stands", () => {
    // Red without `resolveRailBanners` — and the whole reason O1 showed six callouts for one flip.
    const beingCalledOff = build({ isBeingCalledOff: true, isCanceled: true });
    assert.ok(ids(beingCalledOff).includes("spiel.is-canceled"));
    assert.ok(!ids(resolveRailBanners(beingCalledOff)).includes("spiel.is-canceled"));

    const decided = build({ isCanceled: true, hasDecidedErgebnis: true });
    assert.ok(!ids(resolveRailBanners(decided)).includes("spiel.is-canceled"));
  });

  it("keeps the standing note on a fixture cancelled in an earlier session with no decided score", () => {
    assert.deepEqual(ids(resolveRailBanners(build({ isCanceled: true }))), ["spiel.is-canceled"]);
  });

  it("names the fixtures a cancellation leaves unoccupied, singular and plural", () => {
    const one = build({ isBeingCalledOff: true, isCanceled: true, dependentSpielNummern: [29] });
    const many = build({ isBeingCalledOff: true, isCanceled: true, dependentSpielNummern: [29, 30, 31] });

    assert.match(one.find((banner) => banner.id === "spiel.knockout-feeds")?.title ?? "", /Spiel 29 unbesetzt/);
    assert.match(many.find((banner) => banner.id === "spiel.knockout-feeds")?.title ?? "", /Spiele 29, 30 und 31 unbesetzt/);
  });

  it("leaves the bracket banner off a group-phase cancellation, which feeds nothing", () => {
    const built = build({ isKnockout: false, isBeingCalledOff: true, isCanceled: true, dependentSpielNummern: [29] });

    assert.ok(!ids(built).includes("spiel.knockout-feeds"));
  });

  it("puts the void preview's fixture numbers in the title, where the consequence is", () => {
    const built = build({ voidedSpielNummern: [29, 30], releasedSpielNummern: [31] });

    assert.match(built.find((banner) => banner.id === "spiel.void-preview")?.title ?? "", /Spielen 29 und 30/);
    assert.match(built.find((banner) => banner.id === "spiel.release-preview")?.title ?? "", /Spiel 31 entfernt/);
  });

  it("sorts danger over warning over info on the rail", () => {
    const built = resolveRailBanners(build({ isCanceled: true, releasedSpielNummern: [31], voidedSpielNummern: [29] }));

    assert.deepEqual(
      built.map((banner) => banner.severity),
      ["danger", "warning", "info"],
    );
  });
});
