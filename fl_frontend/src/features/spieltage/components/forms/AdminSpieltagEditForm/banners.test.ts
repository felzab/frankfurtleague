import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSpieltagBanners } from "./banners.ts";

import type { SpieltagBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildSpieltagBanners>[0]> = {}): readonly SpieltagBanner[] =>
  buildSpieltagBanners({
    isZeitraumChanged: false,
    isEndeVorBeginn: false,
    spieleAngelegt: 4,
    anzahlSpiele: 4,
    ...overrides,
  });

const ids = (banners: readonly SpieltagBanner[]): string[] => banners.map((banner) => banner.id);

describe("buildSpieltagBanners", () => {
  /* Nothing stands unconditionally. The name has no field to be refused at, so a reader never asks
     why it cannot be changed, and a banner nothing raised is deleted rather than shortened. */
  it("raises nothing for a settled matchday with no pending edit", () => {
    assert.deepEqual(ids(build()), []);
  });

  it("grades a moved span as a warning, so a save stops on it", () => {
    const spanChange = build({ isZeitraumChanged: true }).find((banner) => banner.id === "spieltag.zeitraum-changed");

    assert.equal(spanChange?.severity, "warning");
    assert.equal(spanChange?.inline, "zeitraum");
  });

  /* Both refusals a moved span draws, one per slot: the fixtures inside the new span in the title,
     and the beginn in step with the DATED matchdays of its phase in the body, which has to name
     them or it claims the neighbours. */
  it("names both save conditions a moved span is held to", () => {
    const banner = build({ isZeitraumChanged: true }).find((entry) => entry.id === "spieltag.zeitraum-changed");

    assert.match(banner?.title ?? "", /zu den Spielen passen/);
    assert.match(banner?.body ?? "", /Beginn/);
    assert.match(banner?.body ?? "", /schon einen Zeitraum haben/);
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
