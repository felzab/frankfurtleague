/**
 * SPIELTAGE · matchday editor banner tests
 *
 * This list is the evidence ADR-0072 rests on — the enumeration of what a three-field form has to say
 * — so the gates are asserted here rather than clicked. Two of them mirror a backend refusal
 * arithmetically (`REQ-RETIRE-002`, `REQ-RETIRE-005`), and a mirror that drifts would disable a
 * control the endpoint would have accepted, or offer one it will refuse.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveRailBanners } from "@/shared/components/ui/railBanner.ts";

import { buildSpieltagBanners } from "./banners.ts";

import type { SpieltagBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildSpieltagBanners>[0]> = {}): readonly SpieltagBanner[] =>
  buildSpieltagBanners({
    label: "2. Spieltag",
    inactiveSince: null,
    storedPhase: "gruppenphase",
    draftPhase: "gruppenphase",
    isZeitraumChanged: false,
    isEndeVorBeginn: false,
    spieleAngelegt: 4,
    anzahlSpiele: 4,
    spieleGespielt: 0,
    livePhaseCount: 4,
    impliedPhaseCount: 3,
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

  it("names a played fixture as the reason a retirement cannot succeed (REQ-RETIRE-002)", () => {
    assert.ok(ids(build({ spieleGespielt: 1 })).includes("spieltag.retire-blockiert-ergebnis"));
    assert.ok(!ids(build({ spieleGespielt: 0 })).includes("spieltag.retire-blockiert-ergebnis"));
  });

  it("mirrors the phase floor exactly as the endpoint computes it (REQ-RETIRE-005)", () => {
    // The backend refuses when `live_in_phase - 1 < implied_in_phase`, with `live_in_phase` including
    // this matchday — so four live against a floor of three retires, and three against three does not.
    assert.ok(!ids(build({ livePhaseCount: 4, impliedPhaseCount: 3 })).includes("spieltag.retire-blockiert-untergrenze"));
    assert.ok(ids(build({ livePhaseCount: 3, impliedPhaseCount: 3 })).includes("spieltag.retire-blockiert-untergrenze"));
  });

  it("lets a phase the season never plays retire down to nothing, which is the floor of zero", () => {
    assert.ok(!ids(build({ livePhaseCount: 1, impliedPhaseCount: 0 })).includes("spieltag.retire-blockiert-untergrenze"));
  });

  it("states only the blocking reason that applies, never both at once", () => {
    // A played fixture is the earlier refusal at the endpoint too, so the floor is not also reported.
    const both = ids(build({ spieleGespielt: 2, livePhaseCount: 3, impliedPhaseCount: 3 }));

    assert.ok(both.includes("spieltag.retire-blockiert-ergebnis"));
    assert.ok(!both.includes("spieltag.retire-blockiert-untergrenze"));
  });

  it("says nothing about retiring one that is already retired", () => {
    const retired = ids(build({ inactiveSince: "2026-04-02", spieleGespielt: 2, livePhaseCount: 3, impliedPhaseCount: 3 }));

    assert.ok(!retired.includes("spieltag.retire-blockiert-ergebnis"));
    assert.ok(!retired.includes("spieltag.retire-blockiert-untergrenze"));
  });

  it("drops the undated retirement banner from the rail once the dated one is present", () => {
    // Red without `resolveRailBanners`.
    const built = build({ inactiveSince: "2026-04-02" });

    assert.ok(ids(built).includes("spieltag.retired"));
    assert.ok(!ids(resolveRailBanners(built)).includes("spieltag.retired"));
    assert.ok(resolveRailBanners(built).some((banner) => /02\.04\.2026/.test(banner.title)));
  });
});
