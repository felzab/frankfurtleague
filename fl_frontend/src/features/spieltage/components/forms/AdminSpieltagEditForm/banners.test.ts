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

  /* The banner states outright what a save needs, so it reaches both refusals a moved span draws:
     the fixtures inside the new span, and the beginn in step with the DATED matchdays of its phase,
     which the body must name or it claims the neighbours. */
  it("names both save conditions a moved span is held to", () => {
    const body = build({ isZeitraumChanged: true }).find((banner) => banner.id === "spieltag.zeitraum-changed")?.body ?? "";

    assert.match(body, /alle Spiele/);
    assert.match(body, /Beginn/);
    assert.match(body, /schon einen Zeitraum haben/);
  });

  /* `Zeitraum` is a matchday's span and `Termin` a fixture's date and time, and this banner is about
     the span alone. One word per concept (`docs/frontend/spec.md` §1.12). */
  it("calls the span a Zeitraum on the banner that reports it moving", () => {
    const banner = build({ isZeitraumChanged: true }).find((entry) => entry.id === "spieltag.zeitraum-changed");

    assert.match(banner?.title ?? "", /Zeitraum/);
    assert.ok(!`${banner?.title ?? ""} ${banner?.body ?? ""}`.includes("Termin"));
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

  /* The repair is a redraw on the season page, so a save stopped here would hold the matchday's dates
     hostage to a state its own write path neither caused nor reads. */
  it("keeps the count report out of the confirmation, because nothing on this page repairs it", () => {
    const banner = build({ spieleAngelegt: 2 }).find((entry) => entry.id === "spieltag.anzahl-offen");

    assert.equal(banner?.severity, "info");
  });
});
