/**
 * SCHIEDSRICHTER · referee editor banner tests
 *
 * The rename is the one banner on this editor that stops a save (ADR-0070), and the gate behind it is
 * a single boolean the form derives from the draft status — so the grade is asserted here rather than
 * clicked, where a warning quietly demoted to `info` would look identical.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSchiedsrichterBanners } from "./banners.ts";

import type { SchiedsrichterBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildSchiedsrichterBanners>[0]> = {}): readonly SchiedsrichterBanner[] =>
  buildSchiedsrichterBanners({
    isNameChanged: false,
    isPaymentChanged: false,
    hasKontakt: true,
    ...overrides,
  });

const ids = (banners: readonly SchiedsrichterBanner[]): string[] => banners.map((banner) => banner.id);

describe("buildSchiedsrichterBanners", () => {
  it("raises nothing for a settled referee with no pending edit", () => {
    assert.deepEqual(ids(build()), []);
  });

  it("grades the rename as the one banner that stops a save", () => {
    const [banner] = build({ isNameChanged: true });

    assert.equal(banner?.id, "schiedsrichter.name-changed");
    assert.equal(banner?.severity, "warning");
  });

  it("keeps the fee change out of the confirmation, because nothing already agreed is rewritten", () => {
    const [banner] = build({ isPaymentChanged: true });

    assert.equal(banner?.id, "schiedsrichter.honorar-changed");
    assert.equal(banner?.severity, "info");
    assert.equal(banner?.inline, "honorar");
  });

  it("reports a missing contact from the DRAFT, so filling one in clears it before the save", () => {
    assert.ok(ids(build({ hasKontakt: false })).includes("schiedsrichter.no-kontakt"));
    assert.ok(!ids(build({ hasKontakt: true })).includes("schiedsrichter.no-kontakt"));
  });
});
