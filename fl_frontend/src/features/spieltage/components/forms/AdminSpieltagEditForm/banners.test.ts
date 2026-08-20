import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSpieltagBanners } from "./banners.ts";

import type { SpieltagBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildSpieltagBanners>[0]> = {}): readonly SpieltagBanner[] =>
  buildSpieltagBanners({
    label: "2. Spieltag",
    storedPhase: "gruppenphase",
    draftPhase: "gruppenphase",
    isPositionChanged: false,
    isZeitraumChanged: false,
    isEndeVorBeginn: false,
    spieleAngelegt: 4,
    anzahlSpiele: 4,
    ...overrides,
  });

const ids = (banners: readonly SpieltagBanner[]): string[] => banners.map((banner) => banner.id);

describe("buildSpieltagBanners", () => {
  it("always states where the derived name came from, because nothing on the page is a field for it", () => {
    assert.deepEqual(ids(build()), ["spieltag.name-abgeleitet"]);
  });

  it("raises no phase banner while the picker still holds the stored phase", () => {
    assert.ok(!ids(build()).includes("spieltag.phase-changed"));
    assert.ok(ids(build({ draftPhase: "halbfinale" })).includes("spieltag.phase-changed"));
  });

  it("grades a phase change and a moved span as warnings, so a save stops on either", () => {
    const phaseChange = build({ draftPhase: "finale" }).find((banner) => banner.id === "spieltag.phase-changed");
    const spanChange = build({ isZeitraumChanged: true }).find((banner) => banner.id === "spieltag.zeitraum-changed");

    assert.equal(phaseChange?.severity, "warning");
    assert.equal(spanChange?.severity, "warning");
  });

  it("reports a moved position, which renames the matchday and reorders the Spielplan", () => {
    const banner = build({ isPositionChanged: true }).find((entry) => entry.id === "spieltag.position-changed");

    assert.equal(banner?.severity, "warning");
    assert.equal(banner?.inline, "phase");
  });

  // The phase banner already says the matchday took the round's first free slot, so a second banner
  // would report the same move twice.
  it("leaves the position banner off when the phase moved as well", () => {
    assert.ok(!ids(build({ isPositionChanged: true, draftPhase: "finale" })).includes("spieltag.position-changed"));
  });

  it("grades a reversed span as the one danger this editor can raise", () => {
    const banner = build({ isEndeVorBeginn: true }).find((entry) => entry.id === "spieltag.ende-vor-beginn");

    assert.equal(banner?.severity, "danger");
    assert.equal(banner?.inline, "zeitraum");
  });

  it("reports a fixture count that disagrees with the derived expectation, in both directions", () => {
    assert.ok(!ids(build()).includes("spieltag.anzahl-offen"));
    assert.ok(ids(build({ spieleAngelegt: 2 })).includes("spieltag.anzahl-offen"));
    assert.ok(ids(build({ spieleAngelegt: 6 })).includes("spieltag.anzahl-offen"));
  });

  it("keeps the count report out of the confirmation, because an incomplete season is the normal state", () => {
    const banner = build({ spieleAngelegt: 2 }).find((entry) => entry.id === "spieltag.anzahl-offen");

    assert.equal(banner?.severity, "info");
  });
});
