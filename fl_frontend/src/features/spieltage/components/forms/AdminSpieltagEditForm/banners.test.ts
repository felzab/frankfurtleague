import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSpieltagBanners } from "./banners.ts";

import type { SpieltagBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildSpieltagBanners>[0]> = {}): readonly SpieltagBanner[] =>
  buildSpieltagBanners({
    label: "2. Spieltag",
    isZeitraumChanged: false,
    isEndeVorBeginn: false,
    spieleAngelegt: 4,
    anzahlSpiele: 4,
    ...overrides,
  });

const ids = (banners: readonly SpieltagBanner[]): string[] => banners.map((banner) => banner.id);

describe("buildSpieltagBanners", () => {
  it("always states that the name is fixed, because nothing on the page is a field for it", () => {
    assert.deepEqual(ids(build()), ["spieltag.name-abgeleitet"]);
  });

  it("grades a moved span as a warning, so a save stops on it", () => {
    const spanChange = build({ isZeitraumChanged: true }).find((banner) => banner.id === "spieltag.zeitraum-changed");

    assert.equal(spanChange?.severity, "warning");
    assert.equal(spanChange?.inline, "zeitraum");
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
